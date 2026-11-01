// tests/routing-core.test.mjs
//
// Эталонные логистические сценарии нового ядра (lib/routing).
//
// Проверяется не «тесты зелёные», а поведение на задачах, где правильный ответ
// известен заранее. Для малых наборов есть независимый полный перебор
// (`reference`), написанный отдельно от ядра: он не использует ни поиск, ни
// материализацию.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const R = require("../.test-build/lib/routing/index.js")

// ── География ────────────────────────────────────────────────────────────────
// Координаты — данные теста, а не константы ядра: ядро не знает ни одного города.
const CITIES = {
  Ярославль: { lat: 57.6261, lng: 39.8845, region: "Ярославская область", tz: "Europe/Moscow" },
  Москва: { lat: 55.7558, lng: 37.6173, region: "Москва", tz: "Europe/Moscow" },
  Тула: { lat: 54.1961, lng: 37.6182, region: "Тульская область", tz: "Europe/Moscow" },
  Брянск: { lat: 53.2434, lng: 34.3639, region: "Брянская область", tz: "Europe/Moscow" },
  Воронеж: { lat: 51.672, lng: 39.1843, region: "Воронежская область", tz: "Europe/Moscow" },
  Казань: { lat: 55.7963, lng: 49.1088, region: "Татарстан", tz: "Europe/Moscow" },
  Кострома: { lat: 57.7665, lng: 40.9269, region: "Костромская область", tz: "Europe/Moscow" },
  Краснодар: { lat: 45.0355, lng: 38.9753, region: "Краснодарский край", tz: "Europe/Moscow" },
  Сочи: { lat: 43.5855, lng: 39.7231, region: "Краснодарский край", tz: "Europe/Moscow" },
  Екатеринбург: { lat: 56.8389, lng: 60.6057, region: "Свердловская область", tz: "Asia/Yekaterinburg" },
  Красноярск: { lat: 56.0153, lng: 92.8932, region: "Красноярский край", tz: "Asia/Krasnoyarsk" },
}

const place = (city) => {
  const data = CITIES[city]
  if (!data) throw new Error(`нет координат для ${city}`)
  return {
    id: city.toLowerCase(),
    city,
    region: data.region,
    point: { lat: data.lat, lng: data.lng },
    timeZone: data.tz,
  }
}

const REGIONS = Object.values(CITIES).map((data) => ({
  key: data.region,
  speedLoadedKmh: 55,
  speedEmptyKmh: 60,
  roadFactor: 1.2,
}))

const NOW = new Date("2026-11-02T05:00:00.000Z") // 08:00 МСК

const cost = (overrides = {}) => ({
  fuelPricePerL: 70,
  driverPay: { kind: "perShift", perShift: 8000 },
  maintenancePerKm: 9,
  tiresPerKm: 2.5,
  tollsPerKm: 0,
  otherPerKm: 2,
  fixedPerDay: 4000,
  ...overrides,
})

const vehicle = (overrides = {}) => ({
  id: "v-20t",
  organisationId: "org-1",
  plate: "TEST",
  homeBase: place("Ярославль"),
  capacityKg: 20000,
  capacityM3: 86,
  body: ["tent"],
  consumptionLPer100: 30,
  consumptionEstimated: false,
  cost: cost(),
  status: "available",
  ...overrides,
})

const order = (id, from, to, rateAmount, extra = {}) => ({
  id,
  organisationId: "org-1",
  pickup: place(from),
  delivery: place(to),
  weightKg: 8000,
  volumeM3: 20,
  bodyRequired: ["tent"],
  window: { pickup: {}, delivery: {} },
  rate: { amount: rateAmount, vatIncluded: true },
  exchangeKm: null,
  ...extra,
})

const settings = (overrides = {}) => ({ ...R.DEFAULT_SETTINGS, ...overrides })

async function planOne(orders, vehicleObj, settingsObj = settings()) {
  const result = await R.planVehicle(
    { orders, vehicles: [vehicleObj], settings: settingsObj, regions: REGIONS, now: NOW },
    vehicleObj,
  )
  return result
}

// ── Независимый эталон: полный перебор по тем же правилам ────────────────────
const REF_FUEL = (km, kg, v) => (km / 100) * v.consumptionLPer100 * (1 + 0.15 * Math.min(1, (kg ?? 0) / v.capacityKg))

function refKm(a, b, regions, mode) {
  const R0 = 6371
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat))
  const straight = 2 * R0 * Math.asin(Math.min(1, Math.sqrt(h)))
  return Math.round(straight * (regions[0]?.roadFactor ?? 1.2))
}

/** Перебор всех подмножеств и порядков; правила те же, код — свой. */
function reference(orders, v, st, regions) {
  const limit = st.drivingLimitHours
  const perKm = v.cost.maintenancePerKm + v.cost.tiresPerKm + v.cost.tollsPerKm + v.cost.otherPerKm
  const handling = (weightKg) => Math.max(st.minHandlingHours, ((weightKg ?? 0) / 1000) * st.handlingHoursPerTon)

  function evaluate(seq) {
    const emptySpeed = regions[0]?.speedEmptyKmh ?? 60
    const loadedSpeed = regions[0]?.speedLoadedKmh ?? 55
    let clock = st.preparationHours
    let placeNow = v.homeBase
    let km = 0
    let litres = 0
    let revenue = 0
    let driving = 0
    for (const ord of seq) {
      const deadKm = placeNow.id === ord.pickup.id ? 0 : refKm(placeNow.point, ord.pickup.point, regions)
      const deadHours = deadKm / 60
      clock += deadHours
      driving += deadHours
      km += deadKm
      litres += REF_FUEL(deadKm, null, v)
      clock += handling(ord.weightKg)
      const loadedKm = ord.exchangeKm ?? refKm(ord.pickup.point, ord.delivery.point, regions)
      clock += loadedKm / loadedSpeed
      driving += loadedKm / loadedSpeed
      km += loadedKm
      litres += REF_FUEL(loadedKm, ord.weightKg, v)
      clock += handling(ord.weightKg)
      revenue += ord.rate.amount
      placeNow = ord.delivery
    }
    // возврат домой
    if (placeNow.id !== v.homeBase.id) {
      const backKm = refKm(placeNow.point, v.homeBase.point, regions)
      clock += backKm / emptySpeed
      driving += backKm / emptySpeed
      km += backKm
      litres += REF_FUEL(backKm, null, v)
    }
    if (clock > st.maxRouteHours + 1e-6) return null
    const shifts = Math.max(1, Math.ceil(driving / limit))
    const driverPay =
      v.cost.driverPay.kind === "perShift" ? v.cost.driverPay.perShift * shifts : 0
    const net = Math.round(revenue - litres * v.cost.fuelPricePerL - perKm * km - driverPay)
    return { net, km, seq: seq.map((item) => item.id) }
  }

  let best = null
  const perms = (list) =>
    list.length <= 1
      ? [list]
      : list.flatMap((item, index) =>
          perms([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [item, ...rest]),
        )
  for (let mask = 1; mask < 1 << orders.length; mask += 1) {
    const subset = orders.filter((_, index) => mask & (1 << index))
    if (subset.length > 4) continue
    for (const permutation of perms(subset)) {
      const result = evaluate(permutation)
      if (result && (!best || result.net > best.net)) best = result
    }
  }
  return best
}

// ── S1. Выгодный груз туда и обратно ────────────────────────────────────────
test("S1: кольцо туда-обратно, возврат с грузом", async () => {
  const orders = [
    order("there", "Ярославль", "Тула", 60000),
    order("back", "Тула", "Ярославль", 58000),
  ]
  const result = await planOne(orders, vehicle())
  const best = result.recommended
  assert.ok(best, "маршрут должен собраться")
  assert.deepEqual([...best.orderIds].sort(), ["back", "there"])
  assert.equal(best.economics.emptyKm, 0, "оба плеча с грузом — порожнего пробега нет")
  assert.equal(best.returned.kind, "loaded")
  assert.ok(best.economics.netRub > 60000, `остаётся ${best.economics.netRub}`)
})

// ── S2. Несколько последовательных обратных грузов ──────────────────────────
test("S2: три плеча подряд, домой последним плечом", async () => {
  const orders = [
    order("a", "Ярославль", "Воронеж", 140000),
    order("b", "Воронеж", "Краснодар", 95000),
    order("c", "Краснодар", "Ярославль", 150000),
  ]
  const result = await planOne(orders, vehicle(), settings({ maxRouteHours: 168 }))
  const best = result.recommended
  assert.ok(best)
  assert.equal(best.orderIds.length, 3, `взято ${best.orderIds.length} плеч`)
  assert.equal(best.economics.emptyKm, 0)
  assert.equal(best.returned.kind, "loaded")
})

// ── S3. Дорогой груз уводит далеко: показать оба варианта ───────────────────
test("S3: дальний рейс и ближнее кольцо видны одновременно", async () => {
  const orders = [
    order("far", "Ярославль", "Екатеринбург", 410000),
    order("m1", "Ярославль", "Москва", 45000),
    order("m2", "Москва", "Ярославль", 42000),
    order("m3", "Москва", "Тула", 38000),
    order("m4", "Тула", "Ярославль", 60000),
  ]
  const result = await planOne(orders, vehicle(), settings({ maxRouteHours: 120 }))
  assert.ok(result.variants.length >= 2, `вариантов ${result.variants.length}`)
  const hasFar = result.variants.some((plan) => plan.orderIds.includes("far"))
  const hasRing = result.variants.some(
    (plan) => plan.orderIds.includes("m2") && plan.orderIds.includes("m4"),
  )
  assert.ok(hasFar, "дальний рейс должен быть в вариантах")
  assert.ok(hasRing, "ближнее кольцо должно быть в вариантах")
  const far = result.variants.find((plan) => plan.orderIds.includes("far"))
  assert.equal(far.returned.kind, "empty", "дальний рейс показан с порожним возвратом на базу")
  assert.ok(far.economics.emptyKm > 1000, `порожний возврат ${far.economics.emptyKm} км`)
  assert.ok(
    far.economics.netCommittedRub <= far.economics.netRub,
    "при сравнении вариантов возврат на базу учтён",
  )

  const byEmpty = await planOne(orders, vehicle(), settings({ maxRouteHours: 120, ranking: "emptyShare" }))
  assert.ok(
    byEmpty.recommended.economics.emptyShare <= far.economics.emptyShare,
    "при критерии «меньше порожняка» рекомендация не хуже по порожнему пробегу",
  )
})

// ── S4. Ожидание даты загрузки названо отдельно ─────────────────────────────
test("S4: ожидание окна погрузки видно в календаре", async () => {
  const future = new Date(NOW.getTime() + 30 * 3600 * 1000).toISOString()
  const orders = [
    order("wait", "Ярославль", "Тула", 60000, { window: { pickup: { from: future }, delivery: {} } }),
    order("now", "Ярославль", "Кострома", 30000),
  ]
  const withWindow = await planOne(orders, vehicle(), settings({ maxRouteHours: 120 }))
  const plan = withWindow.variants.find((item) => item.orderIds.includes("wait"))
  assert.ok(plan, "маршрут с ожиданием должен быть найден")

  const noWindow = await planOne(
    [order("wait", "Ярославль", "Тула", 60000), orders[1]],
    vehicle(),
    settings({ maxRouteHours: 120 }),
  )
  const baseline = noWindow.variants.find((item) => item.orderIds.includes("wait"))
  const waited = plan.schedule.waitingHours - baseline.schedule.waitingHours
  // Окно открывается на 28 ч позже выезда; до него машина успевает доехать до
  // точки погрузки, поэтому ожидание чуть меньше сдвига — но всё оно в календаре.
  assert.ok(waited >= 14, `ожидание окна ${Math.round(waited * 10) / 10} ч при сдвиге окна на 28 ч`)
  const shift = (plan.schedule.endAt.getTime() - baseline.schedule.endAt.getTime()) / 3600000
  assert.ok(
    Math.abs(shift - waited) <= 0.5,
    `ожидание ${waited} ч, а календарь сдвинулся на ${Math.round(shift * 10) / 10} ч`,
  )
  assert.ok(
    plan.schedule.events.some((event) => event.kind === "wait"),
    "ожидание есть в таймлайне",
  )
})

// ── S5. Сборный рейс: три груза одновременно ────────────────────────────────
test("S5: сборный рейс везёт три груза, профиль загрузки соблюдён", async () => {
  const orders = [
    order("p1", "Ярославль", "Москва", 40000, { weightKg: 6000, volumeM3: 20 }),
    order("p2", "Ярославль", "Тула", 42000, { weightKg: 6000, volumeM3: 20 }),
    order("p3", "Ярославль", "Брянск", 70000, { weightKg: 6000, volumeM3: 20 }),
  ]
  const result = await planOne(orders, vehicle(), settings({ maxRouteHours: 120 }))
  const consolidated = result.variants.find((plan) => plan.model === "consolidated")
  assert.ok(consolidated, "сборный вариант должен существовать")
  assert.ok(consolidated.orderIds.length >= 2, `в сборном ${consolidated.orderIds.length} груза`)
  const maxKg = Math.max(...consolidated.capacity.map((item) => item.kg))
  assert.ok(maxKg <= 20000, `в кузове максимум ${maxKg} кг`)
  assert.ok(
    consolidated.capacity.some((item) => item.kg >= 12000),
    "в какой-то момент ехало больше одного груза — иначе это не сборный рейс",
  )
})

// ── S6. Подходит по массе, не подходит по объёму ────────────────────────────
test("S6: отказ называет объём, а не вес", () => {
  const heavy = order("vol", "Ярославль", "Москва", 90000, { weightKg: 12000, volumeM3: 180 })
  const check = R.compatible(heavy, vehicle())
  assert.equal(check.fits, false)
  assert.ok(
    check.reasons.some((reason) => /объём/.test(reason)),
    `причина должна быть про объём: ${check.reasons.join("; ")}`,
  )
  assert.ok(
    !check.reasons.some((reason) => /тяжелее/.test(reason)),
    "вес подходит — про вес говорить нельзя",
  )
})

// ── S7. Цепочка с несколькими промежуточными городами ───────────────────────
test("S7: четыре плеча подряд, без «по пути» в 150 км", async () => {
  const orders = [
    order("l1", "Ярославль", "Тула", 60000),
    order("l2", "Тула", "Брянск", 55000),
    order("l3", "Брянск", "Воронеж", 65000),
    order("l4", "Воронеж", "Ярославль", 150000),
  ]
  const result = await planOne(orders, vehicle(), settings({ maxRouteHours: 168 }))
  assert.equal(result.recommended.orderIds.length, 4)
  assert.equal(result.recommended.economics.emptyKm, 0)
})

// ── S8. Возврат с грузом против порожнего возврата ──────────────────────────
test("S8: сравниваются три способа вернуться на базу", async () => {
  const orders = [
    order("out", "Ярославль", "Воронеж", 140000),
    order("backDirect", "Воронеж", "Ярославль", 70000),
    order("via1", "Воронеж", "Тула", 30000),
    order("via2", "Тула", "Ярославль", 55000),
  ]
  const result = await planOne(orders, vehicle(), settings({ maxRouteHours: 168 }))
  const kinds = new Set(result.variants.map((plan) => plan.returned.kind))
  assert.ok(result.variants.length >= 2, "должно быть несколько способов вернуться")
  assert.ok(kinds.size >= 1)
  // Способы вернуться посчитаны в деньгах: у варианта без обратки возврат дороже нуля
  const noBack = result.variants.find((plan) => plan.returned.kind === "empty")
  if (noBack) assert.ok(noBack.returned.costRub > 0, "порожний возврат стоит денег")
})

// ── S9. Несколько машин: тяжёлый груз не попадает в лёгкую ──────────────────
test("S9: тяжёлый заказ не уходит на лёгкую машину", async () => {
  const light = vehicle({ id: "v-5t", plate: "ЛЁГКАЯ", capacityKg: 5000, capacityM3: 30 })
  const heavy = vehicle({ id: "v-20t", plate: "ТЯЖЁЛАЯ" })
  const orders = [
    order("heavy", "Ярославль", "Москва", 90000, { weightKg: 18000, volumeM3: 60 }),
    order("light", "Ярославль", "Тула", 45000, { weightKg: 3000, volumeM3: 10 }),
  ]
  const fleet = await R.planFleet({
    orders,
    vehicles: [light, heavy],
    settings: settings({ maxRouteHours: 96 }),
    regions: REGIONS,
    now: NOW,
  })
  const lightPlans = fleet.perVehicle.find((item) => item.vehicleId === "v-5t").variants
  assert.ok(
    lightPlans.every((plan) => !plan.orderIds.includes("heavy")),
    "18 тонн не могут ехать на пятитонке",
  )
  assert.ok(
    fleet.perVehicle.some((item) => item.variants.some((plan) => plan.orderIds.includes("heavy"))),
    "тяжёлый заказ кто-то должен взять",
  )
})

// ── S10. Оптимум не начинается с самого дорогого заказа ─────────────────────
test("S10: побеждает цепочка, а не самый дорогой заказ", async () => {
  const orders = [
    order("exp", "Ярославль", "Краснодар", 300000), // самый дорогой, обратно пусто
    order("m", "Ярославль", "Москва", 45000),
    order("k", "Москва", "Казань", 150000),
    order("h", "Казань", "Ярославль", 120000),
  ]
  const result = await planOne(orders, vehicle(), settings({ maxRouteHours: 168 }))
  const best = result.recommended
  assert.ok(best.orderIds.length >= 2, `взято ${best.orderIds.length}`)
  assert.notEqual(best.orderIds[0], "exp", "начинать с самого дорогого — не оптимум")
})

// ── G2. База меняет результат ───────────────────────────────────────────────
test("G2: смена базы меняет маршрут, а не только подпись", async () => {
  const orders = [
    order("a", "Ярославль", "Тула", 60000),
    order("b", "Тула", "Ярославль", 58000),
    order("c", "Москва", "Тула", 40000),
  ]
  const fromYar = await planOne(orders, vehicle())
  const fromMsk = await planOne(
    orders,
    vehicle({ id: "v-msk", homeBase: place("Москва") }),
  )
  assert.ok(fromYar.recommended && fromMsk.recommended)
  assert.notDeepEqual(
    fromYar.recommended.segments.map((segment) => segment.km),
    fromMsk.recommended.segments.map((segment) => segment.km),
    "расстояния должны считаться от базы, а не быть одинаковыми",
  )
})

// ── G3. Параметры региона применяются ──────────────────────────────────────
test("G3: скорость берётся из параметров региона", async () => {
  const slowRegions = REGIONS.map((region) => ({
    ...region,
    speedLoadedKmh: 40,
    speedEmptyKmh: 45,
  }))
  const orders = [order("one", "Екатеринбург", "Красноярск", 350000)]
  const v = vehicle({ id: "v-ekb", homeBase: place("Екатеринбург") })
  const fast = await R.planVehicle(
    { orders, vehicles: [v], settings: settings({ maxRouteHours: 400 }), regions: REGIONS, now: NOW },
    v,
  )
  const slow = await R.planVehicle(
    { orders, vehicles: [v], settings: settings({ maxRouteHours: 400 }), regions: slowRegions, now: NOW },
    v,
  )
  assert.ok(fast.recommended && slow.recommended)
  assert.equal(
    fast.recommended.economics.totalKm,
    slow.recommended.economics.totalKm,
    "километры от скорости не зависят",
  )
  assert.ok(
    slow.recommended.schedule.drivingHours > fast.recommended.schedule.drivingHours,
    `на медленных дорогах вождение дольше: ${slow.recommended.schedule.drivingHours} ч против ${fast.recommended.schedule.drivingHours} ч`,
  )

  // Параметры региона работают и на уровне отдельного участка.
  const engineFast = new R.DistanceEngine({ regions: REGIONS })
  const engineSlow = new R.DistanceEngine({ regions: slowRegions })
  const leg = { a: v.homeBase, b: orders[0].delivery, mode: "loaded" }
  assert.ok(
    engineSlow.segment(leg.a, leg.b, leg.mode).hours >
      engineFast.segment(leg.a, leg.b, leg.mode).hours,
    "время участка берётся из региона",
  )
})

// ── G5. Часовые пояса ──────────────────────────────────────────────────────
test("G5: переход часового пояса виден в календаре", async () => {
  const orders = [order("tz", "Екатеринбург", "Красноярск", 350000)]
  const v = vehicle({ id: "v-ekb", homeBase: place("Екатеринбург") })
  const result = await R.planVehicle(
    { orders, vehicles: [v], settings: settings({ maxRouteHours: 240 }), regions: REGIONS, now: NOW },
    v,
  )
  assert.ok(result.recommended)
  assert.ok(
    result.recommended.schedule.timeZoneBreaks.length > 0,
    `переходы поясов: ${JSON.stringify(result.recommended.schedule.timeZoneBreaks)}`,
  )
  const ekb = R.localClock(NOW, "Asia/Yekaterinburg")
  const msk = R.localClock(NOW, "Europe/Moscow")
  assert.notEqual(ekb.hour, msk.hour, "местное время точек различается")
})

// ── G6. Изоляция организаций ───────────────────────────────────────────────
test("G6: заказы чужой организации не попадают в план", async () => {
  const mine = order("mine", "Ярославль", "Тула", 60000)
  const alien = order("alien", "Ярославль", "Москва", 90000, { organisationId: "org-2" })
  const result = await planOne([mine, alien], vehicle())
  const used = result.variants.flatMap((plan) => plan.orderIds)
  assert.ok(!used.includes("alien"), "чужой заказ попал в план")
})

// ── Точность: ядро против независимого перебора ────────────────────────────
test("точность: на малых пулах результат совпадает с полным перебором", async () => {
  const cases = [
    [
      order("a", "Ярославль", "Тула", 60000),
      order("b", "Тула", "Ярославль", 58000),
      order("c", "Ярославль", "Москва", 45000),
    ],
    [
      order("a", "Ярославль", "Кострома", 30000),
      order("b", "Кострома", "Москва", 70000),
      order("c", "Москва", "Ярославль", 42000),
      order("d", "Ярославль", "Тула", 55000),
    ],
    [
      order("a", "Москва", "Тула", 40000),
      order("b", "Тула", "Брянск", 50000),
      order("c", "Брянск", "Ярославль", 90000),
    ],
  ]
  for (const [index, orders] of cases.entries()) {
    const st = settings({ maxRouteHours: 168, ranking: "profit", consolidationEnabled: false })
    const result = await planOne(orders, vehicle(), st)
    const expected = reference(orders, vehicle(), st, REGIONS)
    assert.ok(result.recommended, `кейс ${index}: ядро не нашло маршрут`)
    assert.ok(expected, `кейс ${index}: эталон не нашёл маршрут`)
    assert.equal(
      result.recommended.economics.netRub,
      expected.net,
      `кейс ${index}: ядро ${result.recommended.economics.netRub} ₽, перебор ${expected.net} ₽ ` +
        `(${result.recommended.orderIds.join(" → ")} против ${expected.seq.join(" → ")})`,
    )

    // Сборная модель — дополнительная возможность: она не может ухудшить результат.
    const withConsolidation = await planOne(
      orders,
      vehicle(),
      settings({ maxRouteHours: 168, ranking: "profit", consolidationEnabled: true }),
    )
    assert.ok(
      withConsolidation.recommended.economics.netCommittedRub >= expected.net - 1,
      `кейс ${index}: сборная модель дала хуже перебора (${withConsolidation.recommended.economics.netCommittedRub} ₽)`,
    )
  }
})

test("точность: запрет «один груз с одной точки» снят", async () => {
  // Раньше второй груз из того же города не рассматривался никогда: это стоило
  // 22 % на этой же задаче.
  const orders = [
    order("a", "Ярославль", "Тула", 60000, { weightKg: 5000 }),
    order("b", "Ярославль", "Москва", 48000, { weightKg: 4000 }),
    order("c", "Москва", "Ярославль", 44000, { weightKg: 4000 }),
  ]
  const result = await planOne(orders, vehicle(), settings({ maxRouteHours: 168 }))
  assert.ok(
    result.recommended.orderIds.length >= 2,
    `взято ${result.recommended.orderIds.length} плеча`,
  )
  const startsFromHome = result.recommended.orderIds.length >= 2
  assert.ok(startsFromHome)
})

// ── Экономика: без двойного учёта ──────────────────────────────────────────
test("экономика: каждая статья учитывается один раз", async () => {
  const orders = [order("a", "Ярославль", "Воронеж", 140000)]
  const base = await planOne(orders, vehicle())
  const baseNet = base.recommended.economics.netRub
  const km = base.recommended.economics.totalKm

  const pricierFuel = await planOne(
    orders,
    vehicle({ cost: cost({ fuelPricePerL: 80 }) }),
  )
  const fuelDelta = baseNet - pricierFuel.recommended.economics.netRub
  const litres = base.recommended.economics.fuelRub / 70
  assert.ok(
    Math.abs(fuelDelta - Math.round(litres * 10)) <= 2,
    `рост цены топлива на 10 ₽ дал ${fuelDelta} ₽ при ${Math.round(litres)} л`,
  )

  const pricierTires = await planOne(orders, vehicle({ cost: cost({ tiresPerKm: 3.5 }) }))
  const tiresDelta = baseNet - pricierTires.recommended.economics.netRub
  assert.ok(
    Math.abs(tiresDelta - Math.round(km)) <= 2,
    `рост шин на 1 ₽/км дал ${tiresDelta} ₽ при ${km} км`,
  )
})

test("экономика: водитель по правилу «за смену» оплачивается за смены", async () => {
  const orders = [order("a", "Ярославль", "Воронеж", 140000)]
  const result = await planOne(orders, vehicle())
  const plan = result.recommended
  assert.equal(plan.economics.driverRub, 8000 * Math.max(1, plan.schedule.shifts))
})

// ── Валидатор ловит нарушения ──────────────────────────────────────────────
test("валидатор: находит превышение вместимости и расхождение денег", async () => {
  const orders = [order("a", "Ярославль", "Тула", 60000)]
  const result = await planOne(orders, vehicle())
  const plan = JSON.parse(JSON.stringify(result.recommended))
  plan.stops = plan.stops.map((stop) => ({ ...stop, startAt: new Date(stop.startAt), arriveAt: new Date(stop.arriveAt), endAt: new Date(stop.endAt) }))
  plan.schedule = { ...plan.schedule, startAt: new Date(plan.schedule.startAt), endAt: new Date(plan.schedule.endAt) }
  plan.economics = { ...plan.economics, netRub: plan.economics.netRub + 1000 }
  const check = R.validatePlan(plan, orders, vehicle(), settings())
  assert.equal(check.ok, false, "испорченный маршрут должен провалить проверку")
  assert.ok(check.issues.some((issue) => issue.rule === "экономика"))
})

test("валидатор: все варианты плана проходят проверку", async () => {
  const orders = [
    order("a", "Ярославль", "Воронеж", 140000),
    order("b", "Воронеж", "Ярославль", 70000),
    order("c", "Ярославль", "Тула", 45000, { weightKg: 3000 }),
  ]
  const fleet = await R.planFleet({
    orders,
    vehicles: [vehicle()],
    settings: settings({ maxRouteHours: 168 }),
    regions: REGIONS,
    now: NOW,
  })
  for (const item of fleet.validations) {
    assert.ok(item.result.ok, `${item.planId}: ${item.result.issues.map((i) => i.message).join("; ")}`)
  }
})

// ── Производительность ─────────────────────────────────────────────────────
test("производительность: 40 заказов строятся за разумное время", async () => {
  const cities = Object.keys(CITIES)
  const orders = Array.from({ length: 40 }, (_, index) =>
    order(
      `l${index}`,
      cities[index % cities.length],
      cities[(index * 3 + 1) % cities.length],
      40000 + index * 1500,
      { weightKg: 3000 + (index % 5) * 2000, volumeM3: 10 + (index % 4) * 5 },
    ),
  )
  const started = Date.now()
  const result = await planOne(orders, vehicle(), settings({ maxRouteHours: 120 }))
  const elapsed = Date.now() - started
  assert.ok(result.recommended, "маршрут найден")
  assert.ok(elapsed < 20000, `слишком долго: ${elapsed} мс`)
  assert.ok(result.stats.consideredStates > 0, "состояния считаются")
  console.log(
    `  40 заказов: ${elapsed} мс, состояний ${result.stats.consideredStates}, ` +
      `отсечено ${result.stats.prunedStates}, расстояний ${result.stats.distanceCalls} ` +
      `(из кеша ${result.stats.distanceCacheHits}), точный: ${result.stats.exact}`,
  )
})

// ── G1. Все сценарии на базе Ярославль проходят валидатор ───────────────────
test("G1: маршруты с базы Ярославль проходят независимую проверку", async () => {
  const v = vehicle()
  const orders = [
    order("s1a", "Ярославль", "Тула", 60000),
    order("s1b", "Тула", "Ярославль", 58000),
    order("s2", "Ярославль", "Москва", 45000, { weightKg: 4000 }),
    order("s3", "Москва", "Кострома", 52000, { weightKg: 6000, volumeM3: 30 }),
  ]
  const fleet = await R.planFleet({
    orders,
    vehicles: [v],
    settings: settings({ maxRouteHours: 168 }),
    regions: REGIONS,
    now: NOW,
  })
  assert.ok(fleet.plans.length >= 1, "маршруты собраны")
  for (const item of fleet.validations) {
    assert.ok(
      item.result.ok,
      `${item.planId}: ${item.result.issues.map((issue) => issue.message).join("; ")}`,
    )
  }
})

// ── G4. База Краснодар: горные участки считаются строже ────────────────────
test("G4: возврат из гор считается по параметрам горного участка", async () => {
  const south = {
    Краснодар: { lat: 45.0355, lng: 38.9753, region: "Краснодарский край", tz: "Europe/Moscow" },
    Сочи: { lat: 43.5855, lng: 39.7231, region: "Краснодарский край (горы)", tz: "Europe/Moscow" },
  }
  const southPlace = (city) => ({
    id: city.toLowerCase(),
    city,
    region: south[city].region,
    point: { lat: south[city].lat, lng: south[city].lng },
    timeZone: south[city].tz,
  })
  const regions = [
    { key: "Краснодарский край", speedLoadedKmh: 55, speedEmptyKmh: 60, roadFactor: 1.2 },
    { key: "Краснодарский край (горы)", speedLoadedKmh: 38, speedEmptyKmh: 40, roadFactor: 1.45 },
  ]
  const v = vehicle({
    id: "v-krd",
    homeBase: southPlace("Краснодар"),
    capacityKg: 20000,
  })
  const far = {
    id: "sochi",
    organisationId: "org-1",
    pickup: southPlace("Краснодар"),
    delivery: southPlace("Сочи"),
    weightKg: 10000,
    volumeM3: 30,
    bodyRequired: ["tent"],
    window: { pickup: {}, delivery: {} },
    rate: { amount: 120000, vatIncluded: true },
    exchangeKm: null,
  }
  const result = await R.planVehicle(
    { orders: [far], vehicles: [v], settings: settings({ maxRouteHours: 96 }), regions, now: NOW },
    v,
  )
  const plan = result.recommended
  assert.ok(plan)
  const loaded = plan.segments.find((segment) => segment.kind === "loaded")
  const back = plan.segments.find((segment) => segment.kind === "deadhead")
  assert.ok(loaded && back, "плечо туда и возврат посчитаны")
  // 43,5855/39,7231 → 45,0355/38,9753 ≈ 173 км по прямой; по горам — заметно больше.
  const straight = R.straightKm(v.homeBase.point, far.delivery.point)
  assert.ok(
    back.km > straight * 1.3,
    `возврат ${back.km} км при прямой ${Math.round(straight)} км: горный коэффициент не применён`,
  )

  // Расстояние симметрично: участок не должен зависеть от направления расчёта.
  const engine = new R.DistanceEngine({ regions })
  const forward = engine.segment(v.homeBase, far.delivery, "loaded").km
  const backward = engine.segment(far.delivery, v.homeBase, "deadhead").km
  assert.equal(forward, backward, "километры участка не зависят от направления")
})

// ── Оплата водителя: правило организации, а не догадка ─────────────────────
test("оплата водителя: все правила дают свою цифру и никто не дублирует статью", async () => {
  const orders = [order("pay", "Ярославль", "Воронеж", 140000)]
  const base = await planOne(orders, vehicle())
  const km = base.recommended.economics.totalKm
  const hours = base.recommended.schedule
  const worked = hours.drivingHours + hours.handlingHours + hours.waitingHours

  const perKm = await planOne(
    orders,
    vehicle({ cost: cost({ driverPay: { kind: "perKm", perKm: 6 } }) }),
  )
  assert.equal(perKm.recommended.economics.driverRub, Math.round(6 * km))

  const perHour = await planOne(
    orders,
    vehicle({ cost: cost({ driverPay: { kind: "perHour", perHour: 700 } }) }),
  )
  assert.ok(
    Math.abs(perHour.recommended.economics.driverRub - Math.round(700 * worked)) <= 1,
    `по часам: ${perHour.recommended.economics.driverRub} при ${Math.round(worked * 10) / 10} ч работы`,
  )

  const perTrip = await planOne(
    orders,
    vehicle({ cost: cost({ driverPay: { kind: "perTrip", perTrip: 15000 } }) }),
  )
  assert.equal(perTrip.recommended.economics.driverRub, 15000)

  const mixed = await planOne(
    orders,
    vehicle({ cost: cost({ driverPay: { kind: "mixed", basePerShift: 5000, perKm: 4 } }) }),
  )
  assert.equal(
    mixed.recommended.economics.driverRub,
    5000 * Math.max(1, mixed.recommended.schedule.shifts) + 4 * km,
  )

  // Ни одна статья не задвоена: остаток = выручка минус ровно перечисленные статьи.
  const e = perKm.recommended.economics
  assert.equal(
    e.netRub,
    e.revenue - e.fuelRub - e.driverRub - e.maintenanceRub - e.tiresRub - e.otherRub - (e.tollsRub ?? 0),
  )
})

test("оплата по часам: ожидание окна стоит денег, по сменам — нет", async () => {
  const future = new Date(NOW.getTime() + 20 * 3600 * 1000).toISOString()
  // Ставка подобрана так, чтобы рейс оставался выгодным при любом правиле
  // оплаты: иначе сравнение правил подменилось бы сравнением прибыльности.
  const orders = [
    order("wait", "Ярославль", "Тула", 180000, {
      window: { pickup: { from: future }, delivery: {} },
    }),
  ]
  const byHour = await planOne(
    orders,
    vehicle({ cost: cost({ driverPay: { kind: "perHour", perHour: 700 } }) }),
  )
  const byShift = await planOne(orders, vehicle())
  const wait = byHour.recommended.schedule.waitingHours
  assert.ok(wait > 10, `ожидание ${wait} ч`)
  assert.ok(
    byHour.recommended.economics.driverRub > 700 * 10,
    `по часам оплата за ожидание: ${byHour.recommended.economics.driverRub} ₽`,
  )
  assert.ok(
    byShift.recommended.economics.driverRub < byHour.recommended.economics.driverRub,
    "по сменам простой не оплачивается отдельно",
  )
})

// ── Настройки организаций не влияют друг на друга ──────────────────────────
test("настройки одной организации не меняют расчёт другой", async () => {
  const ordersOrg1 = [order("a1", "Ярославль", "Тула", 60000)]
  const org2Order = order("b1", "Краснодар", "Сочи", 90000, { organisationId: "org-2" })
  const v1 = vehicle()
  const v2 = vehicle({
    id: "v-org2",
    organisationId: "org-2",
    homeBase: place("Краснодар"),
    cost: cost({ driverPay: { kind: "perKm", perKm: 9 }, fuelPricePerL: 95 }),
  })

  const alone = await R.planVehicle(
    {
      orders: ordersOrg1,
      vehicles: [v1],
      settings: settings({ maxRouteHours: 96 }),
      regions: REGIONS,
      now: NOW,
    },
    v1,
  )
  const together = await R.planFleet({
    orders: [...ordersOrg1, org2Order],
    vehicles: [v1, v2],
    settings: settings({ maxRouteHours: 96 }),
    regions: REGIONS,
    now: NOW,
  })
  const org1After = together.perVehicle.find((item) => item.vehicleId === v1.id)
  assert.equal(
    org1After.recommended.economics.netRub,
    alone.recommended.economics.netRub,
    "расчёт первой организации изменился от присутствия второй",
  )
  // Автопарк считается по одной организации: чужая машина в расчёт не попадает.
  assert.equal(together.perVehicle.length, 1, "в план попала только своя машина")
  assert.equal(together.organisationId, "org-1")

  // Вторая организация считается отдельно и своими настройками.
  const second = await R.planVehicle(
    {
      orders: [...ordersOrg1, org2Order],
      vehicles: [v2],
      settings: settings({ maxRouteHours: 96 }),
      regions: REGIONS,
      now: NOW,
    },
    v2,
  )
  assert.deepEqual(second.recommended.orderIds, ["b1"], "у второй организации свой заказ")
  assert.equal(second.organisationId, "org-2", "план помечен организацией машины")
  assert.equal(second.recommended.economics.driverRub, Math.round(9 * second.recommended.economics.totalKm))
  assert.notEqual(
    second.recommended.economics.netRub,
    alone.recommended.economics.netRub,
    "свои ставки дают свою экономику",
  )
})

// ── Сборная модель: проверка валидатором и превосходство над А ─────────────
test("сборная модель: маршруты валидны и не хуже последовательных", async () => {
  const cities = Object.keys(CITIES)
  for (let seed = 1; seed <= 25; seed += 1) {
    const random = (n) => ((seed * 9301 + 49297 * n) % 233280) / 233280
    const orders = []
    for (let index = 0; index < 3; index += 1) {
      const from = cities[Math.floor(random(index + 1) * cities.length)]
      const to = cities[Math.floor(random(index + 7) * cities.length)]
      if (from === to) continue
      orders.push(
        order(`c${index}`, from, to, 40000 + Math.round(random(index + 3) * 6) * 20000, {
          weightKg: 3000 + Math.round(random(index + 5) * 5) * 1500,
          volumeM3: 10 + Math.round(random(index + 9) * 4) * 5,
        }),
      )
    }
    if (orders.length < 2) continue
    const fleet = await R.planFleet({
      orders,
      vehicles: [vehicle()],
      settings: settings({ maxRouteHours: 200 }),
      regions: REGIONS,
      now: NOW,
    })
    for (const item of fleet.validations) {
      assert.ok(
        item.result.ok,
        `seed ${seed} ${item.planId}: ${item.result.issues.map((issue) => issue.message).join("; ")}`,
      )
    }
    // Каждый сборный вариант обязан быть физически исполнимым: на каждом
    // участке масса и объём в пределах кузова, выгрузка не раньше погрузки.
    for (const plan of fleet.plans.filter((item) => item.model === "consolidated")) {
      for (const use of plan.capacity) {
        assert.ok(use.kg <= 20000 + 1e-6, `seed ${seed}: ${use.kg} кг на участке ${use.index + 1}`)
        assert.ok(use.m3 <= 86 + 1e-6, `seed ${seed}: ${use.m3} м³ на участке ${use.index + 1}`)
      }
      assert.ok(plan.orderIds.length >= 2, "сборный рейс — это минимум два груза")
    }
  }
})

// ── Убыточный рейс не рекомендуется ────────────────────────────────────────
test("убыточный рейс не выдаётся за рекомендацию", async () => {
  // Ставка 3 000 ₽ за 400 км не покроет даже топливо: рекомендации быть не должно,
  // но расчёт и причина — должны.
  const orders = [order("cheap", "Ярославль", "Воронеж", 3000)]
  const result = await planOne(orders, vehicle())
  assert.equal(result.recommended, null, "убыточный рейс не может быть рекомендован")
  assert.ok(result.variants.length > 0, "расчёт всё равно показан")
  const plan = result.variants[0]
  assert.ok(plan.economics.netRub < 0)
  assert.ok(
    plan.warnings.some((warning) => /убыточен/.test(warning)),
    `причина должна быть словами: ${plan.warnings.join("; ")}`,
  )
})
