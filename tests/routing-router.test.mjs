// tests/routing-router.test.mjs
//
// Этап 6: откуда берутся километры и что об этом известно результату.
//
// Проверяется:
//   1. своя точка входа главнее запасной;
//   2. упавшая своя — переход на бесплатную запасную, а не тихая оценка;
//   3. упали все — оценка, ЧЕСТНО помеченная (не «измерено»);
//   4. постоянный кэш: измеренное не запрашивается повторно и помечается;
//   5. бюджет запросов соблюдается (публичные серверы не резиновые);
//   6. в записи кэша есть источник, провайдер и дата измерения.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const D = require("../.test-build/lib/routing/distance.js")

const place = (id, city, lat, lng) => ({
  id,
  city,
  region: null,
  point: { lat, lng },
  timeZone: null,
})

const A = place("yar", "Ярославль", 57.6261, 39.8845)
const B = place("msk", "Москва", 55.7558, 37.6173)
const C = place("kzn", "Казань", 55.7963, 49.1088)

/** Ответ OSRM-таблицы: расстояния в метрах, время в секундах. */
function tableResponse(km) {
  return {
    ok: true,
    json: async () => ({
      code: "Ok",
      distances: [
        [0, km * 1000, km * 1200],
        [km * 1000, 0, km * 700],
        [km * 1200, km * 700, 0],
      ],
      durations: [
        [0, 10000, 20000],
        [10000, 0, 9000],
        [20000, 9000, 0],
      ],
    }),
  }
}

/** Ответ OSRM-маршрута: один маршрут с расстоянием и временем. */
function routeResponse(km) {
  return {
    ok: true,
    json: async () => ({
      code: "Ok",
      routes: [{ distance: km * 1000, duration: 11000 }],
    }),
  }
}

/** Фиктивный fetch: считает обращения по хосту, умеет падать. */
function fakeFetch({ fail = [], km = 265 } = {}) {
  const calls = []
  const impl = async (url) => {
    const host = new URL(url).host
    calls.push(url)
    if (fail.includes(host)) throw new Error(`network down: ${host}`)
    // Матричный запрос и одиночный маршрут отвечают разной формой — как OSRM.
    return url.includes("/table/") ? tableResponse(km) : routeResponse(km)
  }
  impl.calls = calls
  return impl
}

test("этап 6: своя точка входа главнее запасной", async () => {
  const fetchImpl = fakeFetch()
  const engine = new D.DistanceEngine({
    osrmUrl: "http://osrm-own:5000",
    fallbackEndpoints: [{ name: "osrm-public", url: "https://public.example" }],
    regions: [],
    fetchImpl,
  })
  await engine.prefetch([
    { a: A, b: B, mode: "deadhead" },
    { a: A, b: C, mode: "deadhead" },
    { a: B, b: C, mode: "loaded" },
    { a: B, b: A, mode: "loaded" },
  ])
  assert.ok(fetchImpl.calls.length > 0, "запрос ушёл")
  assert.ok(
    fetchImpl.calls.every((url) => url.includes("osrm-own")),
    `запросы ушли не на свой сервер: ${fetchImpl.calls[0]}`,
  )
  const segment = engine.segment(A, B, "deadhead")
  assert.equal(segment.source, "osrm")
  assert.equal(segment.confidence, "measured")
  assert.equal(segment.provider, "osrm-own")
})

test("этап 6: своя упала — переход на запасную, а не тихая оценка", async () => {
  const fetchImpl = fakeFetch({ fail: ["osrm-own:5000"] })
  const engine = new D.DistanceEngine({
    osrmUrl: "http://osrm-own:5000",
    fallbackEndpoints: [{ name: "osrm-public", url: "https://public.example" }],
    regions: [],
    fetchImpl,
  })
  await engine.prefetch([
    { a: A, b: B, mode: "deadhead" },
    { a: A, b: C, mode: "deadhead" },
    { a: B, b: C, mode: "loaded" },
    { a: B, b: A, mode: "loaded" },
  ])
  const segment = engine.segment(A, B, "deadhead")
  assert.equal(segment.source, "osrm", "участок всё равно измерен — запасной ответил")
  assert.equal(segment.provider, "osrm-public", "видно, ЧЕЙ это ответ")
  const stats = engine.routerStats.find((item) => item.name === "osrm-own")
  assert.ok(stats.failures > 0, "падение своей точки входа учтено")
})

test("этап 6: упали все — оценка, честно помеченная", async () => {
  const fetchImpl = fakeFetch({ fail: ["osrm-own:5000", "public.example"] })
  const engine = new D.DistanceEngine({
    osrmUrl: "http://osrm-own:5000",
    fallbackEndpoints: [{ name: "osrm-public", url: "https://public.example" }],
    regions: [],
    fetchImpl,
  })
  await engine.prefetch([{ a: A, b: B, mode: "deadhead" }])
  const segment = engine.segment(A, B, "deadhead")
  assert.equal(segment.source, "estimate")
  assert.equal(segment.confidence, "estimated", "оценка не выдаётся за измерение")
  assert.equal(segment.provider, null)
  assert.equal(segment.measuredAt, null)
  assert.ok(segment.km > 0, "оценка всё равно даёт километры — иначе маршрут не построить")
})

test("этап 6: постоянный кэш — измеренное не запрашивается повторно", async () => {
  const saved = []
  const store = {
    load: async (keys) =>
      keys.map((key) => ({
        from: key.from,
        to: key.to,
        mode: key.mode,
        km: 264.4,
        source: "osrm",
        provider: "osrm-own",
        measuredAt: new Date("2026-11-01T10:00:00Z"),
      })),
    save: async (rows) => saved.push(...rows),
  }
  const fetchImpl = fakeFetch()
  const engine = new D.DistanceEngine({
    osrmUrl: "http://osrm-own:5000",
    regions: [],
    fetchImpl,
    store,
  })
  await engine.prefetch([{ a: A, b: B, mode: "deadhead" }])
  assert.equal(fetchImpl.calls.length, 0, "сеть не тронута: всё уже измерено")
  const segment = engine.segment(A, B, "deadhead")
  assert.equal(segment.fromCache, true)
  assert.equal(segment.source, "osrm")
  assert.equal(segment.provider, "osrm-own")
  assert.equal(engine.storeHits, 1)
  assert.equal(saved.length, 0, "повторно не записывается")
})

test("этап 6: измеренное записывается с источником, провайдером и датой", async () => {
  const saved = []
  const store = { load: async () => [], save: async (rows) => saved.push(...rows) }
  const engine = new D.DistanceEngine({
    osrmUrl: "http://osrm-own:5000",
    regions: [],
    fetchImpl: fakeFetch({ km: 834 }),
    store,
  })
  await engine.prefetch([
    { a: A, b: B, mode: "deadhead" },
    { a: A, b: C, mode: "deadhead" },
    { a: B, b: C, mode: "loaded" },
  ])
  assert.ok(saved.length > 0, "измеренное ушло в постоянный кэш")
  for (const row of saved) {
    assert.equal(row.source, "osrm")
    assert.equal(row.provider, "osrm-own")
    assert.ok(row.measuredAt instanceof Date)
    assert.ok(row.from && row.to && row.mode, "ключ участка заполнен")
    assert.ok(row.km > 0)
  }
})

test("этап 6: бюджет запросов соблюдается — публичные серверы не резиновые", async () => {
  const fetchImpl = fakeFetch()
  const engine = new D.DistanceEngine({
    osrmUrl: "http://osrm-own:5000",
    regions: [],
    fetchImpl,
    requestBudget: 0,
  })
  await engine.prefetch([
    { a: A, b: B, mode: "deadhead" },
    { a: A, b: C, mode: "deadhead" },
    { a: B, b: C, mode: "loaded" },
  ])
  assert.equal(fetchImpl.calls.length, 0, "при нулевом бюджете сети нет")
  assert.equal(engine.segment(A, B, "deadhead").confidence, "estimated")
})

test("этап 6: километраж биржи помечен своим источником", () => {
  const engine = new D.DistanceEngine({ osrmUrl: null, regions: [] })
  const segment = engine.segment(A, B, "loaded", { exchangeKm: 250 })
  assert.equal(segment.source, "exchange")
  assert.equal(segment.confidence, "measured")
  assert.equal(segment.km, 250)
  assert.equal(segment.provider, "exchange")
})
