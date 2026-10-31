/**
 * Аудит сборщика маршрута: проверка обещаний, а не «красиво ли собрано».
 *
 * Схема сборщика (как она есть в коде):
 *   1. пул грузов района базы (оба конца: погрузка ИЛИ выгрузка у базы);
 *   2. для каждой машины — жадная цепочка: из текущего города берём самый
 *      выгодный груз (в городе или в пределах детура), переезжаем в город
 *      выгрузки, повторяем до 8 плеч;
 *   3. плечо берём, только если оно: влезает в машину, окупает топливо,
 *      даёт не меньше порога ₽/км и вместе с дорогой домой влезает в лимит
 *      часов (с ожиданием даты загрузки и отдыхом водителя);
 *   4. в конце — обратка домой; если её нет, считается порожний возврат;
 *   5. итоги: выручка − топливо = прибыль; километры и часы — с возвратом.
 *
 * Тест проверяет на синтетических данных ровно то, что сборщик обещает
 * логисту на экране, и падает, если обещание перестало быть правдой.
 * Живой прогон этого же набора проверок на снимке прода (180 конфигураций:
 * 4 машины × 5 лимитов × 3 радиуса × 3 состава пула) нарушений не нашёл —
 * а вот состав пула был неверным (обратки выбрасывались), это отдельный
 * тест tests/route-pool.test.mjs.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { buildRoute, buildRouteVariants, loadFitsVehicle, loadHasRoute, haversineKm } = require(
  "../.test-build/lib/logist-mobile/route-builder.js",
)

const BASE = "Ярославль"
const BASE_POINT = { lat: 57.6508, lng: 39.8718 }
const FUEL = 70
const NOW = new Date("2026-10-31T06:00:00.000Z")

const LOAD_DATE = "2026-11-01T00:00:00.000Z"

const CLOSE = { lat: 57.7, lng: 39.9 } // условный город рядом
const FAR1 = { lat: 55.75, lng: 37.62 } // Москва
const FAR2 = { lat: 56.32, lng: 44.0 } // Нижний Новгород

const load = (over = {}) => ({
  id: "l1",
  loadId: "ati1",
  fromCity: BASE,
  toCity: "Москва",
  weightKg: 5000,
  volumeM3: null,
  cargoType: "ТНП",
  truckType: null,
  priceRub: 60000,
  priceWithNds: null,
  distanceKm: 270,
  firmName: "Фирма",
  firmUrl: null,
  contactPhone: null,
  loadingDate: LOAD_DATE,
  status: "new",
  fromPoint: BASE_POINT,
  toPoint: FAR1,
  ...over,
})

const vehicle = (over = {}) => ({
  id: "v1",
  plate: "К215СТ790",
  type: "Тент",
  capacity: 5000,
  volume: 32,
  status: "available",
  fuelConsumptionPer100: 30,
  ...over,
})

const baseOptions = (loads, over = {}) => ({
  startCity: BASE,
  loads,
  vehicles: [vehicle()],
  fuelPriceRubPerL: FUEL,
  keepIds: [],
  excludeIds: [],
  detourKm: 150,
  startRadiusKm: 300,
  maxHours: 72,
  startPoint: BASE_POINT,
  now: NOW,
  ...over,
})

/** Инварианты, которые обязаны выполняться на любом собранном маршруте. */
function assertRouteIsHonest(route, vehicleUsed, maxHours) {
  assert.ok(route.legs.length > 0, "маршрут без плеч")
  assert.ok(route.totalHours <= maxHours + 0.05, `часы ${route.totalHours} > лимита ${maxHours}`)

  const ids = new Set()
  const pickups = new Set()
  for (const leg of route.legs) {
    assert.ok(!ids.has(leg.load.id), `груз ${leg.load.id} взят дважды`)
    ids.add(leg.load.id)
    const city = leg.load.fromCity.toLowerCase()
    assert.ok(!pickups.has(city), `город погрузки «${leg.load.fromCity}» повторён`)
    pickups.add(city)
    assert.ok(loadFitsVehicle(leg.load, vehicleUsed), "груз не влезает в машину")
    assert.ok(leg.loadedKm > 0, "плечо без гружёных километров")
    assert.ok(leg.revenue > 0, "плечо без выручки")
  }
  for (let i = 1; i < route.legs.length; i += 1) {
    const prev = route.legs[i - 1]
    const cur = route.legs[i]
    const sameCity = prev.load.toCity.toLowerCase() === cur.load.fromCity.toLowerCase()
    assert.ok(sameCity || cur.deadheadKm > 0, "разрыв между плечами без километров подъезда")
  }
  const revenue = route.legs.reduce((sum, leg) => sum + leg.revenue, 0)
  assert.ok(Math.abs(revenue - route.totalRevenue) <= 1, "выручка не равна сумме ставок")
  if (route.totalProfitRub !== null && route.totalFuelCostRub !== null) {
    assert.ok(
      Math.abs(route.totalRevenue - route.totalFuelCostRub - route.totalProfitRub) <= 2,
      "прибыль не равна «выручка минус топливо»",
    )
  }
}

test("с обраткой в пуле маршрут закрывается домой и приносит больше", () => {
  const out = load({ id: "out", fromCity: BASE, toCity: "Москва", priceRub: 60000, distanceKm: 270 })
  const back = load({
    id: "back",
    fromCity: "Москва",
    toCity: BASE,
    priceRub: 55000,
    distanceKm: 270,
    fromPoint: FAR1,
    toPoint: BASE_POINT,
  })
  const withBack = buildRoute(baseOptions([out, back], { maxHours: 96 }))
  const withoutBack = buildRoute(baseOptions([out], { maxHours: 96 }))
  assert.ok(withBack && withoutBack)
  assert.equal(withBack.legs.length, 2, "обратка не встала вторым плечом")
  assert.ok(
    withBack.totalProfitRub > withoutBack.totalProfitRub,
    "с обраткой прибыль должна быть выше, чем с порожним возвратом",
  )
  assertRouteIsHonest(withBack, vehicle(), 96)
})

test("без обратки порожний возврат входит и в километры, и в прибыль", () => {
  const out = load({ id: "out", priceRub: 60000, distanceKm: 270 })
  const route = buildRoute(baseOptions([out], { maxHours: 96 }))
  assert.ok(route)
  assert.equal(route.legs.length, 1)
  // 270 гружёным туда + ~252 пустым домой (геодезия Москва → Ярославль)
  const homeKm = haversineKm(BASE_POINT, FAR1)
  assert.ok(
    route.totalDistanceKm >= 270 + homeKm - 1,
    `километры без возврата: ${route.totalDistanceKm} при ${270 + homeKm}`,
  )
  assert.ok(route.totalFuelCostRub > 0)
  assertRouteIsHonest(route, vehicle(), 96)
})

test("лимит часов соблюдается на всех разумных настройках", () => {
  const loads = [
    load({ id: "a", truckType: "Тент", distanceKm: 270 }),
    load({
      id: "b",
      fromCity: "Москва",
      toCity: "Нижний Новгород",
      fromPoint: FAR1,
      toPoint: FAR2,
      distanceKm: 400,
      priceRub: 90000,
      loadingDate: "2026-11-02T00:00:00.000Z",
    }),
    load({
      id: "c",
      fromCity: "Нижний Новгород",
      toCity: BASE,
      fromPoint: FAR2,
      toPoint: BASE_POINT,
      distanceKm: 400,
      priceRub: 80000,
      loadingDate: "2026-11-03T00:00:00.000Z",
    }),
  ]
  for (const maxHours of [24, 48, 72, 120, 168]) {
    for (const detourKm of [50, 150, 400]) {
      const route = buildRoute(baseOptions(loads, { maxHours, detourKm }))
      if (!route) continue
      assertRouteIsHonest(route, vehicle(), maxHours)
    }
  }
})

test("варианты маршрута не обещают больше, чем позволяет их собственный лимит", () => {
  const loads = [
    load({ id: "a", distanceKm: 270 }),
    load({
      id: "b",
      fromCity: "Москва",
      toCity: "Нижний Новгород",
      fromPoint: FAR1,
      toPoint: FAR2,
      distanceKm: 400,
      priceRub: 90000,
    }),
  ]
  const variants = buildRouteVariants(baseOptions(loads, { maxHours: 72 }))
  assert.ok(variants.length > 0)
  for (const variant of variants) {
    assert.ok(
      variant.route.totalHours <= variant.hours + 0.05,
      `вариант «${variant.label}»: ${variant.route.totalHours} ч при лимите ${variant.hours}`,
    )
    assertRouteIsHonest(variant.route, vehicle(), variant.hours)
  }
})

test("груз тяжелее машины не берётся, даже если ставка огромная", () => {
  const heavy = load({ id: "heavy", weightKg: 20000, priceRub: 500000 })
  const route = buildRoute(baseOptions([heavy], { vehicles: [vehicle()] }))
  assert.equal(route, null)
})

test("если в лимит не влезает даже одно плечо — маршрут не выдумывается", () => {
  const long = load({ id: "long", toCity: "Нижний Новгород", toPoint: FAR2, distanceKm: 1600, priceRub: 200000 })
  const route = buildRoute(baseOptions([long], { maxHours: 12 }))
  assert.equal(route, null)
})

test("груз готов позже — ждём, и ожидание входит в часы маршрута", () => {
  const late = load({ id: "late", loadingDate: "2026-11-04T00:00:00.000Z", distanceKm: 270 })
  const route = buildRoute(baseOptions([late], { maxHours: 168 }))
  assert.ok(route)
  const wait = route.legs.reduce((sum, leg) => sum + leg.waitHours, 0)
  assert.ok(wait > 40, `ожидание даты загрузки не учтено: ${wait} ч`)
  assertRouteIsHonest(route, vehicle(), 168)
})

test("«по пути» не превращается в крюк: детур соблюдается", () => {
  // Груз из Казани (700+ км от базы) не должен вставать первым плечом при
  // радиусе 200 — он не «рядом с базой»
  const kazan = load({
    id: "kazan",
    fromCity: "Казань",
    toCity: "Москва",
    fromPoint: { lat: 55.79, lng: 49.12 },
    toPoint: FAR1,
    distanceKm: 800,
    priceRub: 150000,
  })
  const route = buildRoute(baseOptions([kazan], { startRadiusKm: 200 }))
  if (route) {
    const first = route.legs[0]
    assert.ok(
      haversineKm(BASE_POINT, first.load.fromPoint) <= 200,
      "первое плечо взято дальше радиуса от базы",
    )
  }
})

test("близкий город (в радиусе) берётся первым плечом", () => {
  const near = load({
    id: "near",
    fromCity: "Тутаев",
    toCity: "Москва",
    fromPoint: CLOSE,
    toPoint: FAR1,
    distanceKm: 300,
    priceRub: 70000,
  })
  const route = buildRoute(baseOptions([near], { startRadiusKm: 100 }))
  assert.ok(route, "груз в 15 км от базы не взялся")
  assertRouteIsHonest(route, vehicle(), 72)
})

test("груз «город → тот же город» в маршрут не попадает", () => {
  // Живой замер биржи: 7 объявлений «Раменское → Раменское», у двух distance=0.
  // Сборщик показывал «Раменское → Раменское, 0 км, прибыль 14 923 ₽».
  const self1 = load({
    id: "self",
    fromCity: "Раменское",
    toCity: "Раменское",
    fromPoint: FAR1,
    toPoint: FAR1,
    distanceKm: 0,
    priceRub: 26100,
  })
  assert.equal(loadHasRoute(self1), false, "объявление без хода признано грузом")
  const route = buildRoute(baseOptions([self1], { startRadiusKm: 1200 }))
  assert.equal(route, null, "маршрут «из города в тот же город» всё ещё строится")

  // Тот же город, но километраж посчитан (бывает у внутригородских перевозок):
  // это не наш маршрут — машина не переезжает, плеча нет.
  const self2 = load({ ...self1, id: "self2", distanceKm: 12 })
  assert.equal(loadHasRoute(self2), false)

  // Нормальный груз проверку проходит
  assert.equal(loadHasRoute(load({ id: "ok" })), true)
})
