// tests/routing-distance.test.mjs
//
// Тесты движка расстояний (lib/routing/distance.ts) — того места, где километры
// превращаются в деньги. Здесь доказывается:
//   · маршрутизатор спрашивают ТАБЛИЦЕЙ, а не по паре: пул из 120 грузов иначе
//     порождает 14 000 запросов и минуты ожидания;
//   · полученные из OSRM километры помечены как измеренные, а оценка — как
//     оценка (никакой «точности» у догадки);
//   · упавший маршрутизатор не роняет расчёт, а понижает точность;
//   · километраж биржи главнее маршрутизатора для гружёного плеча;
//   · расстояние симметрично: A→B равно B→A, иначе экономика «туда» и «обратно»
//     посчитана по разным правилам.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const D = require("../.test-build/lib/routing/distance.js")

const place = (city, lat, lng) => ({
  id: city.toLowerCase(),
  city,
  region: "Московская область",
  point: { lat, lng },
  timeZone: "Europe/Moscow",
})

const DOMODEDOVO = place("Домодедово", 55.4207, 37.7376)
const TULA = place("Тула", 54.1961, 37.6182)
const VORONEZH = place("Воронеж", 51.672, 39.1843)
const LIPETSK = place("Липецк", 52.6031, 39.5708)
const RYAZAN = place("Рязань", 54.6269, 39.6916)

/** Ответ OSRM /table: расстояния в метрах, время в секундах. */
function tableResponse(places, km) {
  const n = places.length
  const distances = places.map((a, i) => places.map((b, j) => (i === j ? 0 : km(a, b) * 1000)))
  const durations = places.map((a, i) => places.map((b, j) => (i === j ? 0 : (km(a, b) / 60) * 3600)))
  assert.equal(distances.length, n)
  return { code: "Ok", distances, durations }
}

function kmBetween(a, b) {
  // «Дорога» в тесте: прямая × 1,4 — чтобы отличать её от оценки ×1,2.
  return Math.round(D.straightKm(a.point, b.point) * 1.4)
}

test("расстояния: пул спрашивается таблицей, а не по одной паре", async () => {
  const places = [DOMODEDOVO, TULA, VORONEZH, LIPETSK, RYAZAN]
  const urls = []
  const fakeFetch = async (url) => {
    urls.push(String(url))
    assert.ok(String(url).includes("/table/v1/driving/"), `ожидалась таблица, получено ${url}`)
    return { ok: true, json: async () => tableResponse(places, kmBetween) }
  }

  const engine = new D.DistanceEngine({ osrmUrl: "http://osrm:5000", regions: [], fetchImpl: fakeFetch })
  const pairs = []
  for (const a of places) for (const b of places) if (a.id !== b.id) pairs.push({ a, b, mode: "deadhead" })
  await engine.prefetch(pairs)

  assert.equal(urls.length, 1, `на 5 городов нужен один запрос, сделано ${urls.length}`)
  assert.equal(engine.tableRequests, 1)

  const info = engine.segment(DOMODEDOVO, TULA, "deadhead")
  assert.equal(info.source, "osrm", "километры из маршрутизатора должны быть помечены measured-источником")
  assert.equal(info.confidence, "measured")
  assert.equal(info.km, kmBetween(DOMODEDOVO, TULA))
  // Оценка без маршрутизатора по тому же городу заметно другая — иначе тест
  // ничего не доказывает.
  const estimate = engine.estimate(DOMODEDOVO, TULA, "deadhead")
  assert.notEqual(estimate.km, info.km)
  assert.equal(estimate.source, "estimate")
  assert.equal(estimate.confidence, "estimated")
})

test("расстояния: упавший маршрутизатор понижает точность, а не роняет расчёт", async () => {
  const failing = async () => {
    throw new Error("OSRM лежит")
  }
  const engine = new D.DistanceEngine({ osrmUrl: "http://osrm:5000", regions: [], fetchImpl: failing })
  const pairs = [DOMODEDOVO, TULA, VORONEZH, LIPETSK, RYAZAN].flatMap((a) =>
    [DOMODEDOVO, TULA, VORONEZH, LIPETSK, RYAZAN]
      .filter((b) => b.id !== a.id)
      .map((b) => ({ a, b, mode: "loaded" })),
  )
  await engine.prefetch(pairs)

  const info = engine.segment(DOMODEDOVO, TULA, "loaded")
  assert.equal(info.source, "estimate", "без маршрутизатора остаётся оценка")
  assert.ok(info.km > 0, "оценка всё равно даёт расстояние, а не ноль")
  assert.equal(info.confidence, "estimated")
})

test("расстояния: километраж биржи главнее маршрутизатора на гружёном плече", async () => {
  const places = [DOMODEDOVO, TULA, VORONEZH, LIPETSK, RYAZAN]
  const fakeFetch = async () => ({ ok: true, json: async () => tableResponse(places, kmBetween) })
  const engine = new D.DistanceEngine({ osrmUrl: "http://osrm:5000", regions: [], fetchImpl: fakeFetch })
  await engine.prefetch([{ a: DOMODEDOVO, b: TULA, mode: "loaded" }])

  const info = engine.segment(DOMODEDOVO, TULA, "loaded", { exchangeKm: 999 })
  assert.equal(info.km, 999, "по ставке фрахтователя спорят не с маршрутизатором")
  assert.equal(info.source, "exchange")
  assert.equal(info.confidence, "measured")
})

test("расстояния: порожним быстрее, чем с грузом", () => {
  const engine = new D.DistanceEngine({ regions: [] })
  const loaded = engine.segment(DOMODEDOVO, TULA, "loaded")
  const deadhead = engine.segment(DOMODEDOVO, TULA, "deadhead")
  assert.equal(loaded.km, deadhead.km, "километры одинаковые — дорога одна")
  assert.ok(deadhead.hours < loaded.hours, "порожним едем быстрее")
})

test("расстояния: туда и обратно — одинаково", () => {
  const engine = new D.DistanceEngine({ regions: [] })
  const there = engine.segment(DOMODEDOVO, TULA, "loaded").km
  const back = engine.segment(TULA, DOMODEDOVO, "loaded").km
  assert.equal(there, back, "асимметрия расстояний ломает экономику возврата")
})

test("расстояния: регион участка берётся строже, а не по месту старта", () => {
  const engine = new D.DistanceEngine({
    regions: [
      { key: "Московская область", speedLoadedKmh: 60, speedEmptyKmh: 65, roadFactor: 1.15 },
      { key: "Свердловская область", speedLoadedKmh: 45, speedEmptyKmh: 50, roadFactor: 1.35 },
    ],
  })
  const ekb = { ...place("Екатеринбург", 56.8389, 60.6057), region: "Свердловская область" }
  const forward = engine.estimate(DOMODEDOVO, ekb, "loaded")
  const backward = engine.estimate(ekb, DOMODEDOVO, "loaded")
  assert.equal(forward.km, backward.km, "участок через два региона не должен зависеть от направления")
  assert.equal(forward.hours, backward.hours)
  // Более строгий из двух регионов: скорость 45, коэффициент 1,35.
  assert.ok(
    Math.abs(forward.hours - forward.km / 45) < 0.001,
    `скорость участка должна быть 45 км/ч (строже из двух регионов), получено ${forward.hours} ч на ${forward.km} км`,
  )
})
