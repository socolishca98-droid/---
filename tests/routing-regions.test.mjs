// tests/routing-regions.test.mjs
//
// Мультирегиональность и вес: ядро не знает «главного» города.
//
// Три базы в разных часовых поясах (Ярославль, Краснодар, Красноярск) и две
// машины разного веса. Проверяется не «маршрут нашёлся», а правила:
//   • база машины — единственная точка отсчёта, а не координаты из кода;
//   • маршрут из любой базы проходит независимый валидатор;
//   • вес груза на каждом участке не больше вместимости выбранной машины;
//   • календарное время не короче чистой езды, а смена часового пояса не
//     превращается в отрицательное время;
//   • маленькая машина и большая получают разные маршруты, а не один и тот же.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const R = require("../.test-build/lib/routing/index.js")

const NOW = new Date("2026-11-02T05:00:00.000Z")

const place = (city, lat, lng, region, timeZone) => ({
  id: city.toLowerCase(),
  city,
  region,
  point: { lat, lng },
  timeZone,
})

const BASES = [
  place("Ярославль", 57.6261, 39.8845, "Ярославская область", "Europe/Moscow"),
  place("Краснодар", 45.0355, 38.9753, "Краснодарский край", "Europe/Moscow"),
  place("Красноярск", 56.0095, 92.8732, "Красноярский край", "Asia/Krasnoyarsk"),
]

const DESTINATIONS = [
  place("Тула", 54.1961, 37.6182, "Тульская область", "Europe/Moscow"),
  place("Нижний Новгород", 56.3269, 44.0059, "Нижегородская область", "Europe/Moscow"),
  place("Казань", 55.7963, 49.1088, "Татарстан", "Europe/Moscow"),
  place("Самара", 53.1959, 50.1002, "Самарская область", "Europe/Samara"),
  place("Челябинск", 55.1644, 61.4368, "Челябинская область", "Asia/Yekaterinburg"),
  place("Новосибирск", 55.0084, 82.9357, "Новосибирская область", "Asia/Novosibirsk"),
  place("Ростов-на-Дону", 47.2357, 39.7015, "Ростовская область", "Europe/Moscow"),
  place("Воронеж", 51.672, 39.1843, "Воронежская область", "Europe/Moscow"),
]

const kmBetween = (a, b) => {
  const rad = (value) => (value * Math.PI) / 180
  const dLat = rad(b.point.lat - a.point.lat)
  const dLng = rad(b.point.lng - a.point.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.point.lat)) * Math.cos(rad(b.point.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.25
}

/** Пул под базу: ближние направления, ставка от расстояния (как на бирже). */
function poolFor(base) {
  const nearest = [...DESTINATIONS]
    .filter((item) => item.city !== base.city)
    .sort((a, b) => kmBetween(base, a) - kmBetween(base, b))
    .slice(0, 5)
  return nearest.map((destination, index) => ({
    id: `${base.city}-${index}`,
    organisationId: "org-1",
    pickup: index < 3 ? base : nearest[(index + 1) % nearest.length],
    delivery: destination,
    weightKg: 600 + index * 700,
    volumeM3: 4 + index * 2,
    bodyRequired: ["tent"],
    window: { pickup: {}, delivery: {} },
    rate: { amount: Math.round(Math.max(25000, kmBetween(base, destination) * 95)), vatIncluded: true },
    exchangeKm: null,
  }))
}

const regionsOf = (places) =>
  [...new Set(places.map((item) => item.region))].map((key) => ({
    key,
    speedLoadedKmh: 55,
    speedEmptyKmh: 60,
    roadFactor: 1.2,
  }))

function vehicleFor(base, kg, m3, consumption) {
  return {
    id: `veh-${kg}`,
    organisationId: "org-1",
    plate: `ПРОВЕРКА-${kg}`,
    homeBase: base,
    capacityKg: kg,
    capacityM3: m3,
    body: ["tent"],
    consumptionLPer100: consumption,
    consumptionEstimated: false,
    cost: {
      fuelPricePerL: 70,
      driverPay: { kind: "perShift", perShift: 8000 },
      maintenancePerKm: 9,
      tiresPerKm: 2.5,
      tollsPerKm: 0,
      otherPerKm: 2,
      fixedPerDay: 4000,
    },
    status: "available",
  }
}

const SETTINGS = {
  ...R.DEFAULT_SETTINGS,
  maxRouteHours: 240,
  drivingLimitHours: 9,
  restHours: 11,
  openingHour: 8,
  startRadiusKm: 100_000,
  maxLegs: 6,
  consolidationEnabled: true,
  maxConcurrentOrders: 3,
  handlingHoursPerTon: 0.15,
}

const WEIGHTS = [
  { kg: 1500, m3: 12, consumption: 12 },
  { kg: 20000, m3: 82, consumption: 30 },
]

test("с разных баз строятся маршруты, и все они проходят независимый валидатор", async () => {
  for (const base of BASES) {
    const orders = poolFor(base)
    const regions = regionsOf([base, ...DESTINATIONS])
    for (const weight of WEIGHTS) {
      const vehicle = vehicleFor(base, weight.kg, weight.m3, weight.consumption)
      const result = await R.planVehicle(
        { orders, vehicle, settings: SETTINGS, regions, now: NOW },
        vehicle,
      )
      assert.ok(
        result.recommended,
        `${base.city} / ${weight.kg} кг: маршрут не построен, отказы: ${JSON.stringify(result.rejected.slice(0, 3))}`,
      )
      const check = R.validatePlan(result.recommended, orders, vehicle, SETTINGS)
      assert.ok(
        check.ok,
        `${base.city} / ${weight.kg} кг: валидатор нашёл нарушения: ${JSON.stringify(check.issues)}`,
      )
    }
  }
})

test("база машины — точка отсчёта: другой город базы даёт другой первый участок", async () => {
  const firstLegKm = async (base) => {
    const orders = poolFor(base)
    const vehicle = vehicleFor(base, 20000, 82, 30)
    const result = await R.planVehicle(
      { orders, vehicle, settings: SETTINGS, regions: regionsOf([base, ...DESTINATIONS]), now: NOW },
      vehicle,
    )
    const segment = result.recommended?.segments?.[0]
    return segment ? Math.round(segment.km) : null
  }
  const fromYar = await firstLegKm(BASES[0])
  const fromKrd = await firstLegKm(BASES[1])
  assert.ok(fromYar !== null && fromKrd !== null)
  assert.notEqual(fromYar, fromKrd, "первый участок одинаков для разных баз — база не учитывается")
})

test("вес на каждом участке не больше вместимости выбранной машины", async () => {
  const base = BASES[0]
  const orders = poolFor(base)
  const vehicle = vehicleFor(base, 1500, 12, 12)
  const result = await R.planVehicle(
    { orders, vehicle, settings: SETTINGS, regions: regionsOf([base, ...DESTINATIONS]), now: NOW },
    vehicle,
  )
  const plan = result.recommended
  assert.ok(plan)
  // Вместимость — предел на КАЖДОМ участке, а не «в среднем по рейсу».
  for (const use of plan.capacity) {
    assert.ok(
      use.kg <= 1500 + 1e-6,
      `на участке ${use.index} в кузове ${use.kg} кг при вместимости 1500`,
    )
    assert.ok(use.m3 <= 12 + 1e-6, `на участке ${use.index} в кузове ${use.m3} м³ при объёме 12`)
  }
  // Конец рейса — кузов пуст: всё, что погрузили, выгрузили.
  const last = plan.capacity[plan.capacity.length - 1]
  assert.equal(last.kg, 0, `в конце рейса в кузове осталось ${last.kg} кг`)
  // И ни один заказ не «пропал»: все погруженные грузы есть в плане.
  const loaded = new Set(plan.capacity.flatMap((use) => use.items))
  for (const id of plan.orderIds) {
    assert.ok(loaded.has(id), `груз ${id} есть в плане, но ни разу не погружен`)
  }
})

test("смена часового пояса не делает календарь короче езды", async () => {
  // Красноярск → Новосибирск — разные пояса; обратный рейс через них же.
  const base = BASES[2]
  const orders = poolFor(base)
  const vehicle = vehicleFor(base, 20000, 82, 30)
  const result = await R.planVehicle(
    { orders, vehicle, settings: SETTINGS, regions: regionsOf([base, ...DESTINATIONS]), now: NOW },
    vehicle,
  )
  const plan = result.recommended
  assert.ok(plan)
  const calendarHours = (new Date(plan.schedule.endAt) - new Date(plan.schedule.startAt)) / 3_600_000
  assert.ok(
    calendarHours + 1e-6 >= plan.schedule.drivingHours,
    `календарь ${calendarHours.toFixed(1)} ч короче езды ${plan.schedule.drivingHours.toFixed(1)} ч`,
  )
  assert.ok(plan.schedule.drivingHours > 0)
})

test("машины разного веса получают разные маршруты, а не один и тот же", async () => {
  const base = BASES[0]
  const orders = poolFor(base)
  const regions = regionsOf([base, ...DESTINATIONS])
  const small = await R.planVehicle(
    { orders, vehicle: vehicleFor(base, 1500, 12, 12), settings: SETTINGS, regions, now: NOW },
    vehicleFor(base, 1500, 12, 12),
  )
  const big = await R.planVehicle(
    { orders, vehicle: vehicleFor(base, 20000, 82, 30), settings: SETTINGS, regions, now: NOW },
    vehicleFor(base, 20000, 82, 30),
  )
  assert.ok(small.recommended && big.recommended)
  const smallSignature = `${small.recommended.orderIds.join(">")}|${Math.round(small.recommended.economics.totalKm)}`
  const bigSignature = `${big.recommended.orderIds.join(">")}|${Math.round(big.recommended.economics.totalKm)}`
  assert.notEqual(smallSignature, bigSignature, "маршрут не зависит от машины — вес не учитывается")
})
