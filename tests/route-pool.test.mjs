/**
 * Тесты пула грузов помощника (lib/logist-mobile/pool.ts).
 *
 * Повод — живой промах: помощник не видел обраток. Экран фильтровал пул по
 * городу ПОГРУЗКИ, и грузы «в регион» отбрасывались ещё до сборщика. Сборщик
 * честно писал «обратки нет» и считал порожний возврат, а на бирже в это же
 * время лежали десятки грузов домой (снимок прода: 57 свежих грузов со ставкой
 * везли В Ярославскую область — ни один не дошёл до сборщика).
 *
 * Проверяем:
 *  1) погрузка в регионе — груз в пуле;
 *  2) выгрузка в регионе (обратка) — тоже в пуле;
 *  3) оба конца вне региона и вне радиуса — мимо;
 *  4) радиус вокруг базы работает по координатам, а не по названию региона;
 *  5) склейка двух выборок биржи не даёт дублей;
 *  6) пустой регион/нет точки — пул не ломается.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { cityInBaseArea, loadInBaseArea, baseAreaPool, mergeLoads, regionRootOf } = require(
  "../.test-build/lib/logist-mobile/pool.js",
)

const BASE = { lat: 57.6508, lng: 39.8718 } // Ярославль
const MOSCOW = { lat: 55.7558, lng: 37.6173 }
const KOSTROMA = { lat: 57.7679, lng: 40.9269 }
const NOVOSIBIRSK = { lat: 55.0084, lng: 82.9357 }

const AREA = { regionRoot: "Ярославская", basePoint: BASE, radiusKm: 300 }

const load = (over = {}) => ({
  id: "l1",
  fromCity: "Ярославль",
  toCity: "Москва",
  weightKg: 5000,
  volumeM3: null,
  priceRub: 30000,
  loadingDate: null,
  status: "new",
  fromPoint: null,
  toPoint: null,
  ...over,
})

test("регион без хвоста «область»", () => {
  assert.equal(regionRootOf("Ярославская область"), "Ярославская")
  assert.equal(regionRootOf("Краснодарский край"), "Краснодарский")
  assert.equal(regionRootOf(""), null)
  assert.equal(regionRootOf(null), null)
})

test("погрузка в регионе — груз в пуле", () => {
  const l = load({ fromCity: "Ярославль, Ярославская область", toCity: "Брянск" })
  assert.equal(loadInBaseArea(l, AREA), true)
})

test("выгрузка в регионе (обратка) — тоже в пуле", () => {
  // Именно этот случай отбрасывался раньше: обратка домой не попадала в сборку
  const back = load({ fromCity: "Химки, Московская область", toCity: "Ярославль, Ярославская область" })
  assert.equal(loadInBaseArea(back, AREA), true)
})

test("оба конца вне региона и вне радиуса — мимо", () => {
  const far = load({ fromCity: "Омск, Омская область", toCity: "Новосибирск, Новосибирская область" })
  assert.equal(loadInBaseArea(far, AREA), false)
})

test("радиус вокруг базы работает по координатам, а не по названию региона", () => {
  // Москва в 270 км от Ярославля — в радиусе 300, но не в Ярославской области
  const moscow = load({
    fromCity: "Москва, Москва (регион)",
    toCity: "Тверь, Тверская область",
    fromPoint: MOSCOW,
  })
  assert.equal(cityInBaseArea(moscow.fromCity, moscow.fromPoint, AREA), true)
  assert.equal(cityInBaseArea(moscow.fromCity, moscow.fromPoint, { ...AREA, radiusKm: 200 }), false)
  // Новосибирск — вне радиуса при любом разумном значении
  const novosib = load({ fromCity: "Новосибирск", fromPoint: NOVOSIBIRSK })
  assert.equal(cityInBaseArea(novosib.fromCity, novosib.fromPoint, AREA), false)
})

test("Кострома (64 км) берётся при радиусе 100, Владимир (~250 км) — только при 300", () => {
  const kostroma = load({ fromCity: "Кострома", toCity: "Иваново", fromPoint: KOSTROMA })
  assert.equal(loadInBaseArea(kostroma, { ...AREA, radiusKm: 100 }), true)
  // Владимир — 250 км от Ярославля: ближний радиус его не берёт, широкий берёт
  const vladimir = load({ fromCity: "Владимир", toCity: "Тверь", fromPoint: { lat: 56.1290, lng: 40.4070 } })
  assert.equal(loadInBaseArea(vladimir, { ...AREA, radiusKm: 300 }), true)
  assert.equal(loadInBaseArea(vladimir, { ...AREA, radiusKm: 100 }), false)
})

test("без точки и без региона пул не ломается", () => {
  const areaNoRegion = { regionRoot: null, basePoint: BASE, radiusKm: 300 }
  const areaNoPoint = { regionRoot: "Ярославская", basePoint: null, radiusKm: 300 }
  const l = load({ fromCity: "Ярославль, Ярославская область" })
  assert.equal(loadInBaseArea(l, areaNoRegion), false) // координат города нет — судить нечем
  assert.equal(loadInBaseArea(l, areaNoPoint), true) // регион совпал — этого достаточно
})

test("пул: погрузки и обратки вместе, дальние мимо", () => {
  const loads = [
    load({ id: "a", fromCity: "Ярославль, Ярославская область", toCity: "Брянск" }),
    load({ id: "b", fromCity: "Химки, Московская область", toCity: "Ярославль, Ярославская область" }),
    load({ id: "c", fromCity: "Омск", toCity: "Новосибирск" }),
  ]
  assert.deepEqual(
    baseAreaPool(loads, AREA).map((l) => l.id),
    ["a", "b"],
  )
})

test("склейка двух выборок биржи не даёт дублей", () => {
  const region = [load({ id: "a" }), load({ id: "b" })]
  const wide = [load({ id: "b" }), load({ id: "c" })]
  assert.deepEqual(
    mergeLoads(region, wide).map((l) => l.id),
    ["a", "b", "c"],
  )
})
