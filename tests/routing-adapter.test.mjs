// tests/routing-adapter.test.mjs
//
// Тесты адаптера: данные Loginex → контракты ядра.
//
// Главное, что здесь проверяется, — не «функция вернула объект», а:
//   · невозможность построить маршрут называется словами и с адресом, куда идти;
//   · отсутствие данных не превращается в ноль (нет координат — нет точки;
//     нет ставки — нет груза);
//   · часовой пояс берётся по региону, а не «Москва по умолчанию»;
//   · ставка ₽/км не превращается в двойной учёт водителя;
//   · расчёт целиком работает на данных организации от базы до экономики.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const A = require("../.test-build/lib/routing/adapter.js")
const TZ = require("../.test-build/lib/routing/timezones.js")
const R = require("../.test-build/lib/routing/index.js")
const FUEL = require("../.test-build/lib/fleet/fuel-price.js")

const NOW = new Date("2026-11-02T05:00:00.000Z")

const CITY_ROWS = [
  { city: "Ярославль", region: "Ярославская область", lat: 57.6261, lng: 39.8845 },
  { city: "Тула", region: "Тульская область", lat: 54.1961, lng: 37.6182 },
  { city: "Екатеринбург", region: "Свердловская область", lat: 56.8389, lng: 60.6057 },
  { city: "Красноярск", region: "Красноярский край", lat: 56.0153, lng: 92.8932 },
  { city: "Краснодар", region: "Краснодарский край", lat: 45.0355, lng: 38.9753 },
]

const PLACES = new Map(
  CITY_ROWS.map((row) => {
    const place = A.placeFromCity(row)
    return [A.cityKey(row.city), place]
  }),
)

test("точка маршрута: без координат точки нет, а не «нулевой километр»", () => {
  assert.equal(A.placeFromCity({ city: "Неизвестск" }), null)
  assert.equal(A.placeFromCity({ city: "Тула", lat: null, lng: 37.6 }), null)
  const place = A.placeFromCity(CITY_ROWS[0])
  assert.equal(place.city, "Ярославль")
  assert.equal(place.timeZone, "Europe/Moscow")
})

test("часовой пояс берётся по региону", () => {
  assert.equal(TZ.timeZoneForRegion("Свердловская область"), "Asia/Yekaterinburg")
  assert.equal(TZ.timeZoneForRegion("Красноярский край"), "Asia/Krasnoyarsk")
  assert.equal(TZ.timeZoneForRegion("Краснодарский край"), "Europe/Moscow")
  assert.equal(TZ.timeZoneForRegion("Калининградская область"), "Europe/Kaliningrad")
  // Неизвестный регион — честный null, а не Москва.
  assert.equal(TZ.timeZoneForRegion("Мордор"), null)
  assert.equal(A.placeFromCity({ city: "Тест", region: "Мордор", lat: 1, lng: 2 }).timeZone, null)
})

test("база организации берётся из настроек автопарка", () => {
  const base = A.baseFromSettings({
    baseAddress: "Московская область, Домодедово, улица Логистическая, 12",
    baseLat: 55.4207,
    baseLng: 37.7376,
    baseRegion: "Московская область",
  })
  assert.equal(base.city, "Домодедово")
  assert.equal(base.timeZone, "Europe/Moscow")
  assert.equal(A.baseFromSettings({ baseAddress: "Ярославль" }), null, "без координат базы нет")
  assert.equal(A.baseFromSettings(null), null)
})

test("нормы: перерыв в приложении водителя — не суточная норма планирования", () => {
  // 270/45 мин в FleetSettings — напоминание водителю внутри смены (ЕСТП).
  // Планировщик не должен считать по ней суточный календарь: на рейсе 1000 км
  // это дало бы «5 смен» вместо двух.
  const driverApp = A.settingsFromOrg({ restDriveLimitMin: 270, restMinBreakMin: 45 })
  assert.equal(driverApp.drivingLimitHours, 9)
  assert.equal(driverApp.restHours, 11)
  assert.equal(A.planningNorms({ restDriveLimitMin: 270, restMinBreakMin: 45 }).source, "standard")

  // Настоящая суточная норма из организации уважается.
  const org = A.settingsFromOrg({ restDriveLimitMin: 540, restMinBreakMin: 660 })
  assert.equal(org.drivingLimitHours, 9)
  assert.equal(org.restHours, 11)
  assert.equal(A.planningNorms({ restDriveLimitMin: 540, restMinBreakMin: 660 }).source, "organization")

  const shorter = A.settingsFromOrg({ restDriveLimitMin: 480, restMinBreakMin: 600 })
  assert.equal(shorter.drivingLimitHours, 8)
  assert.equal(shorter.restHours, 10)

  // Пустые настройки — тоже норма, а не падение.
  const empty = A.settingsFromOrg(null)
  assert.equal(empty.drivingLimitHours, 9)
})

test("расходы: ставка ₽/км не превращается в двойной учёт водителя", () => {
  const { cost, notes } = A.costFromSettings(
    { operatingCostPerKm: 24 },
    { operatingCostPerKm: 31 },
    "Ярославская область",
  )
  // Своя ставка машины главнее ставки организации.
  assert.equal(cost.maintenancePerKm, 31)
  assert.equal(cost.driverPay.kind, "includedInPerKm")
  assert.equal(R.driverPay(cost.driverPay, {
    revenue: 0,
    totalKm: 100,
    loadedKm: 100,
    fuelLiters: 0,
    tollsRub: null,
    schedule: { drivingHours: 2, waitingHours: 0, handlingHours: 1, shifts: 1, startAt: NOW, endAt: NOW },
    cost,
  }), 0, "оплата водителя не начисляется второй раз поверх ставки")
  // Цена топлива — по региону базы, а не «62 ₽ из головы».
  assert.equal(cost.fuelPricePerL, FUEL.fuelPriceForRegion("Ярославская область"))
  assert.ok(notes.some((note) => /одной цифрой/.test(note)), "нет предупреждения о разбивке")
})

test("груз из биржи: километраж биржи идёт в гружёное плечо", () => {
  const { order, problems } = A.orderFromAtiRow(
    {
      atiLoadId: "ati-1",
      organisationId: "org-1",
      routeFrom: "Ярославль",
      routeTo: "Тула",
      distance: 380,
      weight: 12000,
      volume: 40,
      truckType: "Тент",
      price: 42000,
      loadingDate: "2026-11-03T05:00:00.000Z",
    },
    PLACES,
  )
  assert.deepEqual(problems, [])
  assert.equal(order.exchangeKm, 380, "километраж биржи сохранён")
  assert.equal(order.rate.amount, 42000)
  assert.equal(order.pickup.city, "Ярославль")
  assert.equal(order.window.pickup.from, "2026-11-03T05:00:00.000Z")
  assert.equal(order.bodyRequired[0], "tent")
})

test("груз без координат или без ставки не выдумывается", () => {
  const noCoords = A.orderFromAtiRow(
    {
      atiLoadId: "ati-2",
      organisationId: "org-1",
      routeFrom: "Атлантида",
      routeTo: "Тула",
      distance: 100,
      weight: 1000,
      price: 5000,
    },
    PLACES,
  )
  assert.equal(noCoords.order, null)
  assert.ok(noCoords.problems.some((problem) => /Атлантида/.test(problem)))

  // Груз без цены теперь НЕ выбрасывается: раньше он отбрасывался целиком с
  // причиной «ставка не указана», и логист не видел заявку, по которой надо
  // звонить. Деньги при этом не выдумываются: суммы нет, статус говорит, что
  // цена не указана. Изменение поведения — по ТЗ этапа 8 (нулевая цена).
  const noPrice = A.orderFromAtiRow(
    {
      atiLoadId: "ati-3",
      organisationId: "org-1",
      routeFrom: "Ярославль",
      routeTo: "Тула",
      distance: 380,
      weight: 1000,
    },
    PLACES,
  )
  assert.ok(noPrice.order, "заявка без цены остаётся в пуле")
  assert.equal(noPrice.order.rate.amount, 0, "ноль — «не указана», а не бесплатная перевозка")
  assert.equal(noPrice.order.rate.status, "NEGOTIATION_REQUIRED")
  assert.equal(noPrice.order.rate.raw, null, "исходного значения не было — и не придумано")
  assert.ok(noPrice.problems.some((problem) => /цен/i.test(problem)), "причина названа словами")
})

test("готовность: причина называется словами и с адресом, куда идти", () => {
  const noBase = A.readiness({ base: null, vehicles: [], orders: [], orderProblems: [] })
  assert.equal(noBase.ok, false)
  assert.ok(noBase.blockers.some((text) => /адрес базы/.test(text) && /Настройки/.test(text)))
  assert.ok(noBase.blockers.some((text) => /нет доступных машин/.test(text)))

  const base = A.baseFromSettings({
    baseAddress: "Ярославская область, Ярославль, Московский проспект, 1",
    baseLat: 57.6261,
    baseLng: 39.8845,
    baseRegion: "Ярославская область",
  })
  const vehicle = A.vehicleFromRow(
    {
      id: "v1",
      organisationId: "org-1",
      plate: "А123ВС76",
      type: "Тент",
      capacity: 20000,
      volume: 82,
      status: "available",
    },
    base,
    { operatingCostPerKm: 28 },
    "Ярославская область",
  )
  const ok = A.readiness({ base, vehicles: [vehicle], orders: [{ id: "x" }], orderProblems: [] })
  assert.equal(ok.ok, true)
  assert.ok(
    ok.warnings.some((text) => /расход топлива/.test(text) && /оценка/.test(text)),
    "отсутствие расхода топлива не ноль, а видимая оценка",
  )
  assert.equal(vehicle.consumptionLPer100, 30, "для 20-тонника оценка 30 л/100 км")
  assert.equal(vehicle.consumptionEstimated, true)
  // Предупреждения не повторяются по кругу.
  assert.equal(new Set(ok.warnings).size, ok.warnings.length)
})

test("машина: тип кузова и статус переносятся без потерь", () => {
  const base = A.baseFromSettings({
    baseAddress: "Ярославская область, Ярославль, Московский проспект, 1",
    baseLat: 57.6261,
    baseLng: 39.8845,
    baseRegion: "Ярославская область",
  })
  const reefer = A.vehicleFromRow(
    {
      id: "v2",
      organisationId: "org-1",
      plate: "В108МК76",
      type: "Рефрижератор",
      capacity: 20000,
      volume: 86,
      fuelConsumptionPer100: 32,
      status: "in_use",
    },
    base,
    null,
    "Ярославская область",
  )
  assert.deepEqual(reefer.body, ["reefer"])
  assert.equal(reefer.status, "in_use")
  assert.equal(reefer.consumptionEstimated, false)
  assert.equal(reefer.capacityM3, 86)

  // Рефрижератор берёт тентовый груз — перевозчик так и работает.
  const tentCargo = {
    id: "t1",
    organisationId: "org-1",
    pickup: PLACES.get("ярославль"),
    delivery: PLACES.get("тула"),
    weightKg: 5000,
    volumeM3: 20,
    bodyRequired: ["tent"],
    window: { pickup: {}, delivery: {} },
    rate: { amount: 30000 },
    exchangeKm: null,
  }
  assert.equal(R.compatible(tentCargo, reefer).fits, true)
})

test("сквозной расчёт на данных организации: от базы до экономики", async () => {
  const base = A.baseFromSettings({
    baseAddress: "Ярославская область, Ярославль, Московский проспект, 1",
    baseLat: 57.6261,
    baseLng: 39.8845,
    baseRegion: "Ярославская область",
  })
  const settingsRow = { operatingCostPerKm: 26, restDriveLimitMin: 540, restMinBreakMin: 660 }
  const vehicle = A.vehicleFromRow(
    {
      id: "v1",
      organisationId: "org-1",
      plate: "А123ВС76",
      type: "Тент",
      capacity: 20000,
      volume: 82,
      fuelConsumptionPer100: 30,
      status: "available",
    },
    base,
    settingsRow,
    "Ярославская область",
  )

  const rows = [
    {
      atiLoadId: "l1",
      organisationId: "org-1",
      routeFrom: "Ярославль",
      routeTo: "Тула",
      distance: 380,
      weight: 12000,
      volume: 40,
      truckType: "Тент",
      price: 60000,
    },
    {
      atiLoadId: "l2",
      organisationId: "org-1",
      routeFrom: "Тула",
      routeTo: "Ярославль",
      distance: 390,
      weight: 12000,
      volume: 40,
      truckType: "Тент",
      price: 58000,
    },
    {
      atiLoadId: "alien",
      organisationId: "org-2",
      routeFrom: "Ярославль",
      routeTo: "Тула",
      distance: 380,
      weight: 1000,
      price: 420000,
    },
  ]
  const built = rows.map((row) => A.orderFromAtiRow(row, PLACES))
  const orders = built.map((item) => item.order).filter(Boolean)

  const plan = await R.planVehicle(
    {
      orders,
      vehicles: [vehicle],
      settings: A.settingsFromOrg(settingsRow),
      regions: A.regionsFromRows(["Ярославская область", "Тульская область"]),
      now: NOW,
    },
    vehicle,
  )

  assert.ok(plan.recommended, "маршрут построен на данных организации")
  assert.deepEqual([...plan.recommended.orderIds].sort(), ["l1", "l2"])
  assert.equal(plan.recommended.economics.emptyKm, 0, "кольцо без порожнего пробега")
  assert.ok(plan.recommended.economics.netRub > 0)

  // Чужой заказ не попал в расчёт ни при каких условиях.
  assert.ok(!plan.variants.some((variant) => variant.orderIds.includes("alien")))

  // Проверка: рекомендация проходит независимый валидатор.
  const check = R.validatePlan(
    plan.recommended,
    orders,
    vehicle,
    A.settingsFromOrg(settingsRow),
  )
  assert.ok(check.ok, check.issues.map((issue) => issue.message).join("; "))

  // В экономике видно, что разбивки расходов нет — это не «ноль рублей».
  assert.ok(plan.recommended.economics.unknown.length > 0 || plan.recommended.assumptions.length > 0)
})

test("мультирегиональность: смена региона базы меняет цену топлива и результат", async () => {
  const makeBase = (region, lat, lng, address) =>
    A.baseFromSettings({ baseAddress: address, baseLat: lat, baseLng: lng, baseRegion: region })

  const yar = makeBase("Ярославская область", 57.6261, 39.8845, "Ярославская область, Ярославль, ул. 1")
  const krd = makeBase("Краснодарский край", 45.0355, 38.9753, "Краснодарский край, Краснодар, ул. 1")

  const settingsRow = { operatingCostPerKm: 26, restDriveLimitMin: 540, restMinBreakMin: 660 }
  const build = (base) => {
    const vehicle = A.vehicleFromRow(
      {
        id: "v1",
        organisationId: "org-1",
        plate: "А123ВС76",
        type: "Тент",
        capacity: 20000,
        volume: 82,
        fuelConsumptionPer100: 30,
        status: "available",
      },
      base,
      settingsRow,
      base.region,
    )
    return { vehicle, settings: A.settingsFromOrg(settingsRow) }
  }

  const yarPack = build(yar)
  const krdPack = build(krd)
  assert.notEqual(
    yarPack.vehicle.cost.fuelPricePerL,
    krdPack.vehicle.cost.fuelPricePerL,
    "цена литра зависит от региона базы",
  )

  const order = A.orderFromAtiRow(
    {
      atiLoadId: "l1",
      organisationId: "org-1",
      routeFrom: "Краснодар",
      routeTo: "Тула",
      distance: 1300,
      weight: 12000,
      volume: 40,
      truckType: "Тент",
      // Ставка такая, чтобы рейс был выгоден с обеих баз: иначе сравнение
      // свелось бы к «из Ярославля это убыток» (правильное, но не наша тема).
      price: 420000,
    },
    PLACES,
  ).order

  // Радиус первого плеча здесь увеличен намеренно: проверяется не он, а то,
  // что база и регион базы действительно участвуют в расчёте.
  const wide = { ...yarPack.settings, startRadiusKm: 3000, maxRouteHours: 168 }
  const regions = A.regionsFromRows(["Ярославская область", "Краснодарский край", "Тульская область"])
  const fromYar = await R.planVehicle(
    { orders: [order], vehicles: [yarPack.vehicle], settings: wide, regions, now: NOW },
    yarPack.vehicle,
  )
  const fromKrd = await R.planVehicle(
    { orders: [order], vehicles: [krdPack.vehicle], settings: wide, regions, now: NOW },
    krdPack.vehicle,
  )
  assert.ok(fromYar.recommended && fromKrd.recommended, "рейс выгоден с обеих баз")
  assert.notEqual(
    fromYar.recommended.segments[0].km,
    fromKrd.recommended.segments[0].km,
    "первое плечо считается от своей базы",
  )
  // Из Ярославля машина сначала едет порожним подъездом в Краснодар — это
  // видно в характере первого участка.
  assert.equal(fromYar.recommended.segments[0].kind, "deadhead")
  assert.equal(fromKrd.recommended.segments[0].kind, "loaded")
  assert.notEqual(
    fromYar.recommended.economics.fuelRub,
    fromKrd.recommended.economics.fuelRub,
    "топливо считается по цене региона базы",
  )
})

test("неизвестный тип кузова не превращается в отказ", () => {
  const base = A.baseFromSettings({
    baseAddress: "Московская область, Домодедово, улица Логистическая, 12",
    baseLat: 55.4207,
    baseLng: 37.7376,
  })
  assert.equal(base.region, "Московская область", "регион вычитан из адреса")
  assert.equal(base.timeZone, "Europe/Moscow", "а по региону нашёлся часовой пояс")

  const truck = A.vehicleFromRow(
    {
      id: "v3",
      organisationId: "org-1",
      plate: "В108МК799",
      // В карточке написано «Фура» — тип кузова не определён.
      type: "Фура",
      capacity: 20000,
      volume: 92,
      fuelConsumptionPer100: 31,
      status: "available",
    },
    base,
    null,
    base.region,
  )
  const cargo = {
    id: "c1",
    organisationId: "org-1",
    pickup: PLACES.get("ярославль"),
    delivery: PLACES.get("тула"),
    weightKg: 17000,
    volumeM3: 60,
    bodyRequired: ["tent"],
    window: { pickup: {}, delivery: {} },
    rate: { amount: 60000 },
    exchangeKm: null,
  }
  const check = R.compatible(cargo, truck)
  assert.equal(
    check.fits,
    true,
    `груз 17 т на «Фуре» не должен объявляться неподходящим: ${check.reasons.join("; ")}`,
  )
})
