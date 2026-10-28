/**
 * Тесты сборщика маршрута из грузов биржи (lib/logist-mobile/route-builder.ts).
 *
 * Помощник обещает логисту: из грузов ATI сложить цепочку «база → город →
 * город → домой», где каждое плечо окупается. Проверяем:
 *  1) цепочка строится от точки старта по стыковке городов;
 *  2) убыточные плечи не берутся;
 *  3) низкая ставка (₽/км) — тоже мимо;
 *  4) груз, который не влезает в машину, не берётся;
 *  5) машина перебирается: выбираем вариант с лучшей прибылью за ЧАС;
 *  6) keepIds (согласованные звонком) сохраняются при пересборке;
 *  7) excludeIds («заменить отказавшего») выкидывают груз с причиной;
 *  8) просроченные грузы и грузы без ставки мимо;
 *  9) без точки старта начинаем от самого выгодного груза;
 * 10) итоги: километры, выручка, прибыль — считаются по сумме плеч.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  buildRoute,
  buildRouteVariants,
  departTime,
  hoursLabel,
  hoursSpan,
  loadPrice,
  loadRatePerKm,
  routeMapPoints,
  routeSummaryLine,
  explainFailure,
  handlingHours,
  driveHours,
  restForSegment,
  legHours,
  DRIVE_LIMIT_HOURS,
  REST_HOURS,
} = require("../.test-build/lib/logist-mobile/route-builder.js")

const NOW = new Date("2026-10-22T10:00:00.000Z")
const FUEL = 62

function load(overrides = {}) {
  return {
    id: "cl-1",
    loadId: "ati-load-1",
    fromCity: "Москва",
    toCity: "Воронеж",
    weightKg: 18000,
    volumeM3: null,
    cargoType: "Палеты",
    priceRub: 52000,
    priceWithNds: null,
    distanceKm: 526,
    firmName: "ООО «Ромашка»",
    contactPhone: "+79001234567",
    loadingDate: null,
    status: "new",
    ...overrides,
  }
}

function vehicle(overrides = {}) {
  return {
    id: "vh-1",
    plate: "E774OP750",
    type: "фура",
    capacity: 20000,
    volume: 90,
    status: "available",
    fuelConsumptionPer100: 30,
    ...overrides,
  }
}

// ── 1. Цепочка от точки старта ────────────────────────────────────────────
test("цепочка строится от базы по стыковке городов", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 52000 }),
      load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 35000 }),
      load({ id: "c", fromCity: "Казань", toCity: "Уфа", distanceKm: 500, priceRub: 90000 }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })

  assert.ok(route, "маршрут должен собраться")
  assert.equal(route.legs.length, 2)
  assert.equal(route.legs[0].load.id, "a")
  assert.equal(route.legs[1].load.id, "b")
  assert.deepEqual(route.path, ["Москва", "Воронеж", "Липецк"])
  assert.equal(route.totalDistanceKm, 526 + 280)
  assert.equal(route.totalRevenue, 52000 + 35000)
})

// ── 2. Убыточное плечо не берём ───────────────────────────────────────────
test("плечо, где топливо дороже ставки, не берётся", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      // 300 км, ставка 3000 ₽ — топливо (~25 л/100км пути) съест всё
      load({ id: "bad", fromCity: "Москва", toCity: "Тула", distanceKm: 300, priceRub: 3000 }),
    ],
    vehicles: [vehicle({ fuelConsumptionPer100: 40 })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })

  assert.equal(route, null, "убыточного плеча в маршруте быть не должно")
})

// ── 3. Низкая ставка ₽/км мимо ────────────────────────────────────────────
test("плечо с низкой ставкой ₽/км не берётся", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      // 500 км за 5000 ₽ = 10 ₽/км — ниже порога, хотя «прибыльно»
      load({ id: "cheap", fromCity: "Москва", toCity: "Нижний", distanceKm: 500, priceRub: 5000 }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    minProfitPerKm: 25,
  })

  assert.equal(route, null)
})

// ── 4. Не влезает в машину ────────────────────────────────────────────────
test("груз тяжелее грузоподъёмности машины не берётся", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [load({ id: "heavy", weightKg: 25000, distanceKm: 400, priceRub: 80000 })],
    vehicles: [vehicle({ capacity: 20000 })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })

  assert.equal(route, null)
  assert.equal(loadPrice(load()), 52000)
})

// ── 5. Перебор машин: лучшая прибыль на км ────────────────────────────────
test("машина выбирается по лучшей прибыльности маршрута", () => {
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 52000, weightKg: 18000 }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 35000, weightKg: 18000 }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [
      // Газель: 1.5 т — грузы не влезают
      vehicle({ id: "gazel", plate: "A111AA", capacity: 1500, volume: 20, fuelConsumptionPer100: 18 }),
      // Фура: влезает
      vehicle({ id: "fura", plate: "E774OP750", capacity: 20000, fuelConsumptionPer100: 30 }),
    ],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })

  assert.ok(route)
  assert.equal(route.vehicle?.id, "fura", "должна выбраться машина, в которую влезают грузы")
  assert.equal(route.legs.length, 2)
})

// ── 5б. Машина выбирается по прибыли за час ──────────────────────────────
test("машина выбирается по прибыли за час, а не за километр", () => {
  // Живой замер на Новосибирске: помощник брал 10-тонную фуру с одним плечом
  // 317 км на 18 872 ₽ (59 ₽/км) вместо 20-тонной с двумя плечами 3118 км на
  // 152 888 ₽ (49 ₽/км). По деньгам за час машины — 1 054 против ~3 000 ₽/ч:
  // короткий рейс выигрывал у длинного только потому, что сравнение шло по
  // километрам. Поездка ограничена сроком, поэтому актив диспетчера — часы.
  const P = {
    Москва: { lat: 55.7558, lng: 37.6173 },
    Серпухов: { lat: 54.9, lng: 37.4 },
    НижнийНовгород: { lat: 56.3269, lng: 44.0059 },
    Ухта: { lat: 63.5567, lng: 53.7 },
  }
  const loads = [
    // Ближнее плечо с жирной ставкой: влезает в любую машину
    load({ id: "light", fromCity: "Москва", toCity: "Серпухов", distanceKm: 110, priceRub: 22000, weightKg: 3000, fromPoint: P.Москва, toPoint: P.Серпухов }),
    // Дальнее плечо полегче по ставке: только 20-тонная фура
    load({ id: "heavy", fromCity: "Москва", toCity: "Нижний Новгород", distanceKm: 420, priceRub: 90000, weightKg: 20000, fromPoint: P.Москва, toPoint: P.НижнийНовгород }),
    // Продолжение цепочки из Нижнего Новгорода
    load({ id: "heavy2", fromCity: "Нижний Новгород", toCity: "Ухта", distanceKm: 1100, priceRub: 116000, weightKg: 3000, fromPoint: P.НижнийНовгород, toPoint: P.Ухта }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    startPoint: P.Москва,
    loads,
    vehicles: [
      vehicle({ id: "small", plate: "O556AA750", capacity: 10000, volume: 40, fuelConsumptionPer100: 30 }),
      vehicle({ id: "big", plate: "A421VS750", capacity: 20000, volume: 90, fuelConsumptionPer100: 30 }),
    ],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    // Неделя: 420 км + 1100 км с отдыхом по нормам — это ~4 суток. Тест про
    // выбор машины, а не про лимит, поэтому лимит заведомо достаточный.
    maxHours: 168,
  })

  assert.ok(route)
  assert.equal(route.vehicle?.id, "big", "должна выбраться машина, которая больше зарабатывает за час")
  assert.equal(route.legs.length, 2)
  assert.deepEqual(route.legs.map((leg) => leg.load.id), ["heavy", "heavy2"])
  // У длинного рейса ставка за километр ниже (длинный порожний возврат), но за
  // час он выгоднее — именно поэтому выбор идёт по часам. Часы теперь включают
  // отдых водителя (11 ч на каждую ночь), поэтому 1100 км — это не 20 ч, а
  // почти трое суток: 1293 ₽/ч вместо 3000 ₽/ч при расчёте «без сна».
  assert.ok((route.profitPerHour ?? 0) > 1000, `прибыль за час ${route.profitPerHour}`)
  assert.ok((route.profitPerKm ?? 0) < (route.profitPerHour ?? 0))
})

// ── 5в. Обратка: груз в свой регион закрывает выезд ───────────────────────
test("обраткой считается груз в свой регион, а не только в сам город базы", () => {
  // Живой замер: пул помощника фильтруется по РЕГИОНУ БАЗИ и смотрит на город
  // ПОГРУЗКИ, поэтому груз «Домодедово → Рыбинск» (Рыбинск — тот же регион, что
  // и база Ярославль) в пул не попадает. Без него маршрут заканчивался 400 км
  // порожняком, хотя биржа отдаёт десятки грузов «откуда стоим → куда база».
  const P = {
    Ярославль: { lat: 57.6261, lng: 39.8845 },
    Домодедово: { lat: 55.4417, lng: 37.7542 },
    Рыбинск: { lat: 58.0447, lng: 38.8581 },
  }
  const loads = [
    load({ id: "out", fromCity: "Ярославль", toCity: "Домодедово", distanceKm: 400, priceRub: 60000, weightKg: 18000, fromPoint: P.Ярославль, toPoint: P.Домодедово }),
    load({ id: "back", fromCity: "Домодедово", toCity: "Рыбинск", distanceKm: 300, priceRub: 40000, weightKg: 18000, fromPoint: P.Домодедово, toPoint: P.Рыбинск }),
  ]
  const route = buildRoute({
    startCity: "Ярославль",
    startPoint: P.Ярославль,
    loads,
    vehicles: [vehicle({ id: "fura", plate: "A421VS750", capacity: 20000 })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })

  assert.ok(route)
  assert.equal(route.legs.length, 2, "плечо домой должно закрыть выезд")
  assert.equal(route.legs[1].load.id, "back")
  // До базы осталось 80 км — это честный порожний остаток, а не 400 км
  assert.ok(route.returnDeadheadKm > 0 && route.returnDeadheadKm < 150, `остаток ${Math.round(route.returnDeadheadKm)} км`)
  assert.ok((route.totalProfitRub ?? 0) > 0)
})

test("обратка закрывает выезд даже когда груз дальше детура — по дороге домой", () => {
  // Живой замер: маршрут из Ярославля кончался в Липецке с 559 км порожняка.
  // Груз «Липецк -> Ярославль» не брался: детур 150 км, а до погрузки машина
  // стоит почти там же. Но эти 559 км машина проедет в любом случае — вопрос
  // только, с грузом или пустой. Погрузку обратки ищем в радиусе дороги домой.
  const P = {
    Ярославль: { lat: 57.6261, lng: 39.8845 },
    Ростов: { lat: 47.2357, lng: 39.7015 },
    Липецк: { lat: 52.6031, lng: 39.5709 },
    Воронеж: { lat: 51.6720, lng: 39.1843 },
  }
  const loads = [
    load({ id: "out", fromCity: "Ярославль", toCity: "Ростов", distanceKm: 1100, priceRub: 150000, weightKg: 18000, fromPoint: P.Ярославль, toPoint: P.Ростов }),
    load({ id: "back", fromCity: "Липецк", toCity: "Ярославль", distanceKm: 400, priceRub: 60000, weightKg: 18000, fromPoint: P.Липецк, toPoint: P.Ярославль }),
  ]
  const route = buildRoute({
    startCity: "Ярославль",
    startPoint: P.Ярославль,
    loads,
    vehicles: [vehicle({ id: "fura", plate: "A421VS750", capacity: 20000 })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    // 1100 км — это 20 часов вождения: по нормам два отдыха. Раньше тест
    // укладывался в 48 ч только потому, что отдых не считался вовсе.
    maxHours: 96,
    detourKm: 150,
  })

  assert.ok(route)
  assert.equal(route.legs.length, 2, "обратка должна закрыть выезд")
  assert.equal(route.legs[1].load.id, "back")
  // Плечо обратки помечено: на экране это «по дороге домой», а не «по пути»
  assert.equal(route.legs[1].homeLeg, true)
  // Подъезд к погрузке больше детура, но не больше дороги домой из Ростова
  assert.ok(route.legs[1].deadheadKm > 150, `подъезд ${Math.round(route.legs[1].deadheadKm)} км`)
  assert.equal(route.returnsHomeWithLoad, true, "машина доезжает домой с грузом")
})

// ── 6. keepIds сохраняются ────────────────────────────────────────────────
test("согласованные грузы (keepIds) остаются в маршруте при пересборке", () => {
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 52000 }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 35000 }),
    // Более выгодное плечо из Воронежа, но логист уже договорился по «b»
    load({ id: "c", fromCity: "Воронеж", toCity: "Ростов", distanceKm: 900, priceRub: 200000 }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    keepIds: ["b"],
  })

  assert.ok(route)
  assert.ok(
    route.legs.some((leg) => leg.load.id === "b"),
    "согласованный груз должен остаться в маршруте",
  )
})

// ── 7. excludeIds выкидывают груз ─────────────────────────────────────────
test("исключённый груз не попадает в маршрут, причина сохраняется", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 52000 }),
      load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 35000 }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    excludeIds: ["b"],
  })

  assert.ok(route)
  assert.equal(route.legs.length, 1)
  assert.equal(route.legs[0].load.id, "a")
  assert.ok(route.excluded.some((item) => item.load.id === "b" && item.reason === "исключён вами"))
})

// ── 8. Просроченные и без ставки ──────────────────────────────────────────
test("просроченный груз и груз без ставки не берутся", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({ id: "old", loadingDate: "2026-10-01T08:00:00.000Z", distanceKm: 400, priceRub: 60000 }),
      load({ id: "free", priceRub: 0, priceWithNds: null, distanceKm: 400 }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })

  assert.equal(route, null)
})

// ── 9. Без точки старта ───────────────────────────────────────────────────
test("без города старта начинаем от самого выгодного груза", () => {
  const route = buildRoute({
    startCity: "",
    loads: [
      load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 52000 }),
      load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 35000 }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })

  assert.ok(route)
  assert.ok(route.reasons.some((reason) => reason.includes("Город старта не указан")))
  assert.ok(route.legs.length >= 1)
})

// ── 10. Итоги считаются по сумме плеч ─────────────────────────────────────
test("итоги маршрута: дистанция, выручка и прибыль — сумма по плечам", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 500, priceRub: 100000 }),
      load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 300, priceRub: 60000 }),
    ],
    vehicles: [vehicle({ fuelConsumptionPer100: 30 })],
    fuelPriceRubPerL: 100, // круглое число: 30 л/100км × 800 км = 240 л × 100 = 24 000 ₽
    now: NOW,
  })

  assert.ok(route)
  assert.equal(route.totalDistanceKm, 800)
  assert.equal(route.totalRevenue, 160000)
  // 30 л/100 км, загрузка 18 из 20 т → коэффициент 1,225:
  // 800 км × 30 × 1,225 = 294 л × 100 ₽ = 29 400 ₽
  assert.equal(route.totalFuelCostRub, 29400)
  assert.equal(route.totalProfitRub, 130600)
  assert.equal(route.profitPerKm, 163)
  assert.equal(route.unprofitable, false)
})

// ── 11. Ставка ₽/км груза ─────────────────────────────────────────────────
test("ставка за километр считается по цене и дистанции", () => {
  assert.equal(loadRatePerKm(load({ priceRub: 52000, distanceKm: 520 })), 100)
  assert.equal(loadRatePerKm(load({ priceRub: 52000, distanceKm: 0 })), null)
  assert.equal(loadRatePerKm(load({ priceRub: 0, distanceKm: 520 })), null)
})

// ── 12. Строка-итог ───────────────────────────────────────────────────────
test("строка-итог маршрута содержит плечи, км и прибыль", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [load({ id: "a", distanceKm: 500, priceRub: 100000 })],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.ok(route)
  const line = routeSummaryLine(route)
  assert.match(line, /плеч/)
  assert.match(line, /500 км/)
  assert.match(line, /прибыль/)
})

// ── 13. Нормализация городов: «Ступино г.» и «Ступино» — один город ───────
test("город, написанный по-разному, стыкуется в цепочку", () => {
  const route = buildRoute({
    startCity: "Ступино г. (г.о. Ступино), Московская область",
    loads: [
      load({ id: "a", fromCity: "Ступино, Московская область", toCity: "Воронеж", distanceKm: 450, priceRub: 90000 }),
      load({ id: "b", fromCity: "Воронеж г.", toCity: "Липецк", distanceKm: 280, priceRub: 70000 }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })

  assert.ok(route, "цепочка должна собраться через нормализацию городов")
  assert.equal(route.legs.length, 2)
})

// ── 14. Груз «по пути»: город не совпал, но рядом с маршрутом ────────────
test("груз берётся «по пути», если город погрузки в радиусе", () => {
  // Домодедово (~37.7, 55.4) и Ворсино (~55.2, 36.0) — ~160 км
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000 }),
      // Из Воронежа нет груза, но рядом Коломна (~110 км) — берём «по пути»
      load({ id: "b", fromCity: "Коломна", toCity: "Рязань", distanceKm: 300, priceRub: 80000 }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    detourKm: 200,
    startPoint: { lat: 55.7558, lng: 37.6173 },
  })
  // Точки у грузов не заданы — «по пути» не считается, цепочка обрывается
  assert.ok(route)
  assert.equal(route.legs.length, 1)
})

test("с координатами «по пути» продолжает цепочку и считает подъезд", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({
        id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000,
        fromPoint: { lat: 55.7558, lng: 37.6173 }, toPoint: { lat: 51.6720, lng: 39.1843 },
      }),
      // Коломна ~110 км от Воронежа? Нет — но в радиусе проверки используем
      // реальные близкие точки: Липецк ~150 км от Воронежа
      load({
        id: "b", fromCity: "Липецк", toCity: "Тамбов", distanceKm: 300, priceRub: 90000,
        fromPoint: { lat: 52.6088, lng: 39.5992 }, toPoint: { lat: 52.7212, lng: 41.4523 },
      }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    detourKm: 200,
    startPoint: { lat: 55.7558, lng: 37.6173 },
  })

  assert.ok(route)
  assert.equal(route.legs.length, 2, "второй груз берётся по пути")
  const second = route.legs[1]
  assert.ok(second.byTheWay, "плечо помечено как «по пути»")
  assert.ok(second.deadheadKm > 0, "подъезд к погрузке посчитан")
})

// ── 14b. Радиус «по пути» — на КАЖДОМ шаге, не только на первом ──────────
test("«по пути» ограничено своим радиусом: 300 км годится первому плечу, второму — нет", () => {
  // Живой замер для базы «Ярославль»: радиус считался один раз ДО цикла, и
  // условие «первое плечо» срабатывало на всех шагах. Цепочка из шести плеч
  // шла с прыжками по 292, 252 и 271 км — при выставленных «по пути» 150 км.
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({
        id: "a", fromCity: "Москва", toCity: "Рязань", distanceKm: 200, priceRub: 60000,
        fromPoint: { lat: 55.7558, lng: 37.6173 }, toPoint: { lat: 54.6296, lng: 39.7417 },
      }),
      // Владимир ~190 км от Рязани: в радиус поиска первого груза (300)
      // попадает, в «по пути» (150) — нет. Взять его вторым плечом — значит
      // соврать про «по пути».
      load({
        id: "b", fromCity: "Владимир", toCity: "Нижний Новгород", distanceKm: 450, priceRub: 120000,
        fromPoint: { lat: 56.1290, lng: 40.4066 }, toPoint: { lat: 56.3269, lng: 44.0059 },
      }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    detourKm: 150,
    startRadiusKm: 300,
    startPoint: { lat: 55.7558, lng: 37.6173 },
  })

  assert.ok(route, "первое плечо из Рязани берём — 190 км от базы в пределах радиуса поиска")
  assert.equal(route.legs.length, 1, "второе плечо из Владимира не берём: 190 км больше «по пути» 150 км")
  assert.ok(route.legs[0].deadheadKm <= 300, "пробег первого плеча в пределах радиуса поиска")
})

test("тот же груз берётся, когда «по пути» его покрывает", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({
        id: "a", fromCity: "Москва", toCity: "Рязань", distanceKm: 200, priceRub: 60000,
        fromPoint: { lat: 55.7558, lng: 37.6173 }, toPoint: { lat: 54.6296, lng: 39.7417 },
      }),
      // Коломна ~115 км от Рязани — в «по пути» 150 км попадает
      load({
        id: "b", fromCity: "Коломна", toCity: "Владимир", distanceKm: 250, priceRub: 70000,
        fromPoint: { lat: 55.0794, lng: 38.7536 }, toPoint: { lat: 56.1290, lng: 40.4066 },
      }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    detourKm: 150,
    startRadiusKm: 300,
    startPoint: { lat: 55.7558, lng: 37.6173 },
  })

  assert.ok(route)
  assert.equal(route.legs.length, 2, "цепочка продолжается грузом «по пути»")
  assert.ok(route.legs[1].byTheWay, "плечо помечено «по пути»")
  assert.ok(route.legs[1].deadheadKm > 0 && route.legs[1].deadheadKm <= 150, "подъезд в пределах «по пути»")
})

// ── 15. Возврат домой: порожний пробег входит в расходы ──────────────────
test("порожний возврат домой учитывается в километраже и прибыли", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({
        id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000,
        fromPoint: { lat: 55.7558, lng: 37.6173 }, toPoint: { lat: 51.6720, lng: 39.1843 },
      }),
    ],
    vehicles: [vehicle({ fuelConsumptionPer100: 30 })],
    fuelPriceRubPerL: 100,
    now: NOW,
    startPoint: { lat: 55.7558, lng: 37.6173 },
  })

  assert.ok(route)
  // Воронеж → Москва ~466 км по прямой (ATI даёт 526 по дороге)
  assert.ok(route.returnDeadheadKm >= 400, `возврат должен быть посчитан, получено ${route.returnDeadheadKm}`)
  assert.ok(route.totalDistanceKm > 900, "итоговый пробег включает возврат")
  assert.ok(route.reasons.some((reason) => reason.includes("порожнем")))
})

// ── 16. Домой с грузом — возврат не нужен ─────────────────────────────────
test("груз домой закрывает обратное плечо", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({
        id: "a", fromCity: "Воронеж", toCity: "Москва", distanceKm: 526, priceRub: 120000,
        fromPoint: { lat: 51.6720, lng: 39.1843 }, toPoint: { lat: 55.7558, lng: 37.6173 },
      }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    startPoint: { lat: 55.7558, lng: 37.6173 },
  })
  // Из Москвы груза нет — маршрут начнётся от груза «по пути»? Нет:
  // город старта не совпал и точек-городов старта нет в грузе.
  assert.equal(route, null)
})

// ── 17. Почему не собралось: экран обязан объяснять ────────────────────────
test("объяснение: из города нет грузов", () => {
  const reason = explainFailure({
    startCity: "Казань",
    loads: [load({ id: "a", fromCity: "Москва", toCity: "Тула", distanceKm: 400, priceRub: 60000 })],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.ok(reason)
  assert.equal(reason.loadsFromCity, 0)
  assert.match(reason.headline, /грузов на бирже сейчас нет/)
})

test("объяснение: грузы не влезают в машины", () => {
  const reason = explainFailure({
    startCity: "Вязники",
    loads: [load({ id: "a", fromCity: "Вязники г.", toCity: "Пермь", distanceKm: 1229, priceRub: 203100, weightKg: 20000 })],
    vehicles: [vehicle({ capacity: 5000 })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.ok(reason)
  assert.equal(reason.loadsFromCity, 1)
  assert.equal(reason.tooHeavy, 1)
  assert.match(reason.headline, /не влезают/)
})

test("объяснение: ставка не озвучена", () => {
  const reason = explainFailure({
    startCity: "Вязники",
    loads: [load({ id: "a", fromCity: "Вязники г.", toCity: "Пермь", priceRub: 0, priceWithNds: null })],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.ok(reason)
  assert.equal(reason.noPrice, 1)
  assert.match(reason.headline, /ставка нигде не озвучена/)
})

test("объяснение: плечо в убыток", () => {
  const reason = explainFailure({
    startCity: "Тула",
    // 400 км за 3000 ₽ при расходе 40 л — топливо дороже ставки
    loads: [load({ id: "a", fromCity: "Тула", toCity: "Москва", distanceKm: 400, priceRub: 3000 })],
    vehicles: [vehicle({ fuelConsumptionPer100: 40 })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.ok(reason)
  assert.equal(reason.unprofitable, 1)
  assert.match(reason.headline, /не окупаются/)
})

test("объяснение: пустой город — null", () => {
  assert.equal(explainFailure({ startCity: "", loads: [], vehicles: [], fuelPriceRubPerL: null }), null)
})

// ── 18. Радиус поиска первого груза от базы ────────────────────────────────
test("первый груз берётся шире «по пути»: радиус поиска отдельный", () => {
  // База — Коломна (~55.10, 38.76). Груз из Воронежа (~51.67, 39.18) — ~530 км:
  // за пределами «по пути», но в пределах разумного выезда за грузом.
  const route = buildRoute({
    startCity: "Коломна",
    loads: [
      load({
        id: "far", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 300, priceRub: 90000,
        fromPoint: { lat: 51.6720, lng: 39.1843 }, toPoint: { lat: 52.6088, lng: 39.5992 },
      }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    detourKm: 150,
    startRadiusKm: 600,
    startPoint: { lat: 55.0938, lng: 38.7670 },
  })

  assert.ok(route, "груз за пределами «по пути», но в радиусе поиска — берём")
  assert.equal(route.legs.length, 1)
  const leg = route.legs[0]
  assert.ok(leg.byTheWay, "груз не из нашего города")
  assert.ok(leg.deadheadKm > 350, `порожний выезд большой: ${leg.deadheadKm}`)
  assert.ok(route.reasons.some((r) => r.includes("Первый груз в")))
})

test("за пределами радиуса поиска первый груз не берётся", () => {
  const route = buildRoute({
    startCity: "Коломна",
    loads: [
      load({
        id: "far", fromCity: "Сочи", toCity: "Краснодар", distanceKm: 300, priceRub: 90000,
        fromPoint: { lat: 43.6028, lng: 39.7342 }, toPoint: { lat: 45.0355, lng: 38.9753 },
      }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    detourKm: 150,
    startRadiusKm: 600,
    startPoint: { lat: 55.0938, lng: 38.7670 },
  })
  assert.equal(route, null)
})

// ── 18b. Даты загрузки: ЕТА плеча и риск не успеть ───────────────────────
test("плечо знает дату загрузки и когда машина доедет", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const loads = [
    load({
      id: "a",
      fromCity: "Москва",
      toCity: "Воронеж",
      distanceKm: 526,
      priceRub: 120000,
      loadingDate: "2026-10-26T00:00:00.000Z",
      fromPoint: MOSCOW,
      toPoint: VORONEZH,
    }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: new Date("2026-10-25T09:00:00.000Z"),
    startPoint: MOSCOW,
  })
  assert.ok(route)
  const leg = route.legs[0]
  assert.ok(leg.loadsAt, "дата загрузки фрахтователя попала в плечо")
  assert.ok(leg.etaAt instanceof Date, "ЕСТь ЕТА погрузки")
  assert.equal(leg.lateRisk, false, "27 октября — доедем с запасом")
  assert.ok(route.homeAt.getTime() > route.departAt.getTime(), "домой позже выезда")
  // сутки ожидания даты загрузки + дорога туда-обратно — в пределах лимита
  assert.ok(route.totalHours > 0 && route.totalHours <= 72, `в пути ${route.totalHours} ч`)
  // Ожидание — фактические часы от приезда до даты груза (выезд в 11:00,
  // груз готов 26-го в 00:00): раньше тут были сутки «с запасом», и итог
  // маршрута расходился с проверкой лимита
  assert.equal(route.legs[0].waitHours, 13, "ждём ровно до даты загрузки")
})

test("груз, к дате которого не успеть, вторым плечом не берём", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const PERM = { lat: 58.01, lng: 56.25 }
  const loads = [
    load({
      id: "a",
      fromCity: "Москва",
      toCity: "Воронеж",
      distanceKm: 526,
      priceRub: 120000,
      loadingDate: "2026-10-25T00:00:00.000Z",
      fromPoint: MOSCOW,
      toPoint: VORONEZH,
    }),
    load({
      id: "b",
      fromCity: "Воронеж",
      toCity: "Пермь",
      distanceKm: 1400,
      priceRub: 200000,
      // загрузка сегодня, а до Воронежа мы доедем только к вечеру — и ещё
      // сутки ехать: фрахтователь груз не ждёт
      loadingDate: "2026-10-25T00:00:00.000Z",
      fromPoint: VORONEZH,
      toPoint: PERM,
    }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: new Date("2026-10-25T09:00:00.000Z"),
    startPoint: MOSCOW,
  })
  assert.ok(route)
  // Живой экран: вторым плечом стоял груз с загрузкой 29 окт, а расчёт честно
  // писал «приедем ≈ 30 окт». Логист читал это как «маршрут, где машина
  // опаздывает на сутки» — и был прав. Уехавший груз не купить ставкой,
  // поэтому такое плечо в цепочку не идёт, а объяснение говорит почему.
  assert.equal(route.legs.length, 1, "опаздывающее плечо в цепочку не берём")
  assert.equal(route.legs[0].load.id, "a")
  assert.ok(
    route.reasons.some((line) => /не (успе|влез)/.test(line)),
    `причины: ${route.reasons.join(" | ")}`,
  )
})

test("груз с прошедшей датой загрузки вообще не попадает в сборку", () => {
  // Дату прошлого дня отсекает фильтр «прошедшая дата» ещё до цепочки —
  // поэтому риска «опоздали» на первом плече не возникает вовсе.
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const route = buildRoute({
    startCity: "Москва",
    loads: [
      load({
        id: "a",
        fromCity: "Москва",
        toCity: "Воронеж",
        distanceKm: 526,
        priceRub: 120000,
        loadingDate: "2026-10-24T00:00:00.000Z",
        fromPoint: MOSCOW,
        toPoint: VORONEZH,
      }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: new Date("2026-10-25T09:00:00.000Z"),
    startPoint: MOSCOW,
  })
  assert.equal(route, null)
})

test("вечером выезд переносится на утро — узлы в пути не планируют", () => {
  const evening = departTime(new Date("2026-10-25T20:30:00.000Z"))
  assert.equal(evening.getHours(), 8, "выезд в 8 утра")
  assert.equal(evening.getDate(), 26, "на следующий день")
  const morning = departTime(new Date("2026-10-25T09:00:00.000Z"))
  assert.equal(morning.getHours(), 11, "утром — через пару часов сборов")
})

test("среди двух грузов берём тот, к дате загрузки которого успеваем", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const PERM = { lat: 58.01, lng: 56.25 }
  const LIPETSK = { lat: 52.61, lng: 39.59 }
  // Первое плечо — общее. Дальше выбор: «дорогой» груз, к загрузке которого
  // мы не успеваем, и спокойный рядом. Логист возьмёт спокойный: груз,
  // который уедет, не купить никакой ставкой.
  const loads = [
    load({
      id: "first",
      fromCity: "Москва",
      toCity: "Воронеж",
      distanceKm: 526,
      priceRub: 120000,
      loadingDate: "2026-10-25T00:00:00.000Z",
      fromPoint: MOSCOW,
      toPoint: VORONEZH,
    }),
    load({
      id: "rich-but-late",
      fromCity: "Воронеж",
      toCity: "Пермь",
      distanceKm: 1400,
      priceRub: 400000,
      loadingDate: "2026-10-25T00:00:00.000Z",
      fromPoint: VORONEZH,
      toPoint: PERM,
    }),
    load({
      id: "calm",
      fromCity: "Воронеж",
      toCity: "Липецк",
      distanceKm: 280,
      priceRub: 70000,
      loadingDate: "2026-10-26T00:00:00.000Z",
      fromPoint: VORONEZH,
      toPoint: LIPETSK,
    }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: new Date("2026-10-25T09:00:00.000Z"),
    startPoint: MOSCOW,
  })
  assert.ok(route)
  assert.equal(route.legs.length, 2)
  assert.equal(route.legs[1].load.id, "calm", "груз, к которому успеваем, важнее ставки")
})

// ── 18c. Варианты маршрута: выбор за логистом ─────────────────────────────
test("помощник предлагает варианты: как выбрано, больше денег, быстрее", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const LIPETSK = { lat: 52.61, lng: 39.59 }
  const TAMBOV = { lat: 52.72, lng: 41.45 }
  const SARATOV = { lat: 51.53, lng: 46.03 }
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 70000, fromPoint: VORONEZH, toPoint: LIPETSK }),
    load({ id: "c", fromCity: "Липецк", toCity: "Тамбов", distanceKm: 300, priceRub: 80000, fromPoint: LIPETSK, toPoint: TAMBOV }),
    load({ id: "d", fromCity: "Тамбов", toCity: "Саратов", distanceKm: 400, priceRub: 100000, fromPoint: TAMBOV, toPoint: SARATOV }),
  ]
  // Плечи занимают 43.5 ч: в сутки влезают два, в двое — все четыре
  const variants = buildRouteVariants({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 48,
  })
  assert.ok(variants.length >= 2, `вариантов: ${variants.length}`)
  const kinds = variants.map((variant) => variant.kind)
  assert.ok(kinds.includes("chosen"), "первый — как выбрано")
  assert.ok(
    variants.every((variant) => variant.hours > 0 && variant.route.legs.length > 0),
    "у каждого варианта есть часы и плечи",
  )
  // «Быстрее домой» короче по времени, «больше денег» — не короче
  const fast = variants.find((variant) => variant.kind === "fast")
  const money = variants.find((variant) => variant.kind === "money")
  if (fast) assert.ok(fast.route.totalHours <= variants[0].route.totalHours + 0.01)
  if (money) assert.ok(money.route.totalHours >= variants[0].route.totalHours - 0.01)
  // Одинаковых маршрутов не дублируем
  const ids = variants.map((variant) => variant.route.id)
  assert.equal(new Set(ids).size, ids.length)
})

test("карта маршрута: база, погрузки и выгрузки без дублей", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    // выгрузка здесь же, где следующая погрузка: второй маркер не нужен
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 70000, fromPoint: VORONEZH, toPoint: { lat: 52.61, lng: 39.59 } }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    startPoint: MOSCOW,
  })
  assert.ok(route)
  const points = routeMapPoints(route)
  assert.equal(points[0].home, true, "первая точка — база")
  assert.equal(points[0].label, "База: Москва")
  // Москва один раз: база и погрузка первого плеча — один город
  assert.equal(points[1].index, 1, "выгрузка первого плеча — Воронеж")
  // Воронеж один раз: погрузка второго плеча совпала с выгрузкой первого
  assert.equal(points[2].index, 2, "выгрузка второго плеча — Липецк")
  assert.equal(points.length, 3, `точек: ${points.length}`)
})

test("подписи лимита времени: 24 → «1 день», 72 → «3 дня»", () => {
  assert.equal(hoursLabel(24), "1 день")
  assert.equal(hoursLabel(48), "2 дня")
  assert.equal(hoursLabel(72), "3 дня")
  assert.equal(hoursLabel(120), "5 дней")
  assert.equal(hoursLabel(168), "7 дней")
})

// ── 19. Длина маршрута считается по времени (maxHours) ─────────────────────
test("длина маршрута ограничена временем в пути, а не числом плеч", () => {
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 300, weightKg: 5000, priceRub: 90000 }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 200, weightKg: 5000, priceRub: 60000 }),
    load({ id: "c", fromCity: "Липецк", toCity: "Тамбов", distanceKm: 180, weightKg: 5000, priceRub: 50000 }),
    load({ id: "d", fromCity: "Тамбов", toCity: "Саратов", distanceKm: 150, weightKg: 5000, priceRub: 45000 }),
  ]
  const short = buildRoute({
    startCity: "Москва", loads, vehicles: [vehicle()], fuelPriceRubPerL: FUEL, now: NOW, maxHours: 24,
  })
  const long = buildRoute({
    startCity: "Москва", loads, vehicles: [vehicle()], fuelPriceRubPerL: FUEL, now: NOW, maxHours: 72,
  })
  assert.ok(short && long)
  // Инварианты, а не зашитые числа: срок соблюдён, длинный вариант не короче
  // короткого, и время плеча = дорога + погрузка по весу (+ отдых, если норма
  // вождения выработана).
  assert.ok(short.totalHours <= 24 + 1, `сутки: в пути ${short.totalHours} ч`)
  assert.ok(long.totalHours <= 72 + 1, `трое суток: в пути ${long.totalHours} ч`)
  assert.ok(long.legs.length >= short.legs.length, "с большим сроком плеч не меньше")
  assert.ok(long.totalRevenue >= short.totalRevenue)
  assert.ok(short.legs.length >= 1, "хотя бы одно плечо в сутки влезает")
  const first = short.legs[0]
  const expected = Math.round((300 / 55 + 3) * 10) / 10
  assert.ok(
    Math.abs(first.hours - expected) < 0.05,
    `часы плеча 300 км на 5 т = 300/55 + 3 ч погрузки = ${expected}, получено ${first.hours}`,
  )
})

// ── 19b. Маршрут не длиннее выбранного срока — с дорогой домой ─────────────
test("цепочка обрезается, если вместе с возвратом не влезает в срок", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const LIPETSK = { lat: 52.61, lng: 39.59 }
  const TAMBOV = { lat: 52.72, lng: 41.45 }
  const SARATOV = { lat: 51.53, lng: 46.03 }
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 300, weightKg: 5000, priceRub: 90000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 200, weightKg: 5000, priceRub: 60000, fromPoint: VORONEZH, toPoint: LIPETSK }),
    load({ id: "c", fromCity: "Липецк", toCity: "Тамбов", distanceKm: 180, weightKg: 5000, priceRub: 50000, fromPoint: LIPETSK, toPoint: TAMBOV }),
    load({ id: "d", fromCity: "Тамбов", toCity: "Саратов", distanceKm: 150, weightKg: 5000, priceRub: 45000, fromPoint: TAMBOV, toPoint: SARATOV }),
  ]
  const tight = buildRoute({
    startCity: "Москва", loads, vehicles: [vehicle()], fuelPriceRubPerL: FUEL, now: NOW,
    maxHours: 40, detourKm: 0, startPoint: MOSCOW,
  })
  const loose = buildRoute({
    startCity: "Москва", loads, vehicles: [vehicle()], fuelPriceRubPerL: FUEL, now: NOW,
    maxHours: 120, detourKm: 0, startPoint: MOSCOW,
  })
  assert.ok(tight && loose)
  // Смысл теста: время сильнее жадности — при коротком сроке плеч меньше,
  // и обрезка объяснена словами. Числа зависят от модели времени (дорога +
  // погрузка по весу + отдых), поэтому проверяем инварианты.
  assert.ok(tight.totalHours <= 40 + 1, `в пути ${tight.totalHours} ч при лимите 40 ч`)
  assert.ok(loose.legs.length > tight.legs.length, "с большим сроком плеч больше")
  assert.ok(
    tight.reasons.some((line) => /не влезал|не влезало|лимит|остав/i.test(line)),
    `причины объясняют: ${tight.reasons.join(" | ")}`,
  )
  assert.ok(
    tight.reasons.some((line) => line.startsWith("Маршрут занял")),
    `причины показывают занятое время: ${tight.reasons.join(" | ")}`,
  )
})

// ── 19c. Провал по времени объясняется словами ────────────────────────────
test("если грузы есть, но едут дольше срока — провал объясняет это", () => {
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000 }),
  ]
  const reason = explainFailure({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 8,
  })
  assert.ok(reason)
  assert.equal(reason.tooLong, 1, "плечо дольше 8 ч")
  assert.ok(reason.headline.includes("срок"), `заголовок: ${reason.headline}`)
})

// ── 20. Объяснения не врут: «Почему собрал так» ──────────────────────────
// Живой прогон на бирже (185 грузов, Домодедово, 48 ч, машина 5 т) показал:
// маршрут на 11 ч при лимите 48 ч сопровождался фразой «дальше грузы были,
// но маршрут не влезал в лимит времени». Это ложь — и по ней логист не
// понимает, что менять. Ниже — проверка, что причину теперь говорят по
// факту, а цифры совпадают с маршрутом.
test("причина остановки называется по факту, а не «грузы были»", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const HIMKI = { lat: 55.897, lng: 37.4293 }
  const RAMENSKOE = { lat: 55.567, lng: 38.227 }
  const loads = [
    load({ id: "a", fromCity: "Домодедово", toCity: "Химки", distanceKm: 54, priceRub: 16500, weightKg: 5000, fromPoint: MOSCOW, toPoint: HIMKI }),
    // Груз «по пути» из Химок: готов только послезавтра — ждать двое суток
    load({
      id: "b",
      fromCity: "Раменское",
      toCity: "Москва",
      distanceKm: 51,
      priceRub: 22700,
      weightKg: 600,
      fromPoint: RAMENSKOE,
      toPoint: MOSCOW,
      loadingDate: "2026-10-25T00:00:00.000Z",
    }),
  ]
  const route = buildRoute({
    startCity: "Домодедово",
    loads,
    vehicles: [vehicle({ capacity: 5000, volume: 30, fuelConsumptionPer100: 18 })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 48,
    detourKm: 150,
    startPoint: MOSCOW,
  })
  assert.ok(route)
  assert.equal(route.legs.length, 1, "второе плечо не влезает в срок вместе с ожиданием")
  const lines = route.reasons.join(" | ")
  assert.ok(
    !lines.includes("Дальше грузы были, но маршрут не влезал в лимит времени"),
    `не должно было быть старой лживой строки: ${lines}`,
  )
  assert.ok(
    lines.includes("Ближайший груз по пути — Раменское → Москва"),
    `причина называет груз: ${lines}`,
  )
  assert.ok(lines.includes("ждать"), `причина называет ожидание: ${lines}`)
  assert.ok(
    lines.includes("лимит 48 ч"),
    `причина называет лимит: ${lines}`,
  )
  // Время — честно: сколько заняли и сколько осталось
  assert.ok(
    lines.includes(`Маршрут занял ${Math.round(route.totalHours)} ч`),
    `время маршрута в причинах: ${lines}`,
  )
  assert.ok(lines.includes("осталось"), `остаток лимита в причинах: ${lines}`)
  assert.equal(route.growthHours, 72, "подсказка поднимает лимит на следующий шаг")
  assert.ok(route.growthHint?.includes("Раменское"), `подсказка роста: ${route.growthHint}`)
})

test("маршрут не вылезает за лимит времени — с дорогой домой", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const LIPETSK = { lat: 52.61, lng: 39.59 }
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 70000, fromPoint: VORONEZH, toPoint: LIPETSK }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 48,
    startPoint: MOSCOW,
  })
  assert.ok(route)
  assert.equal(route.legs.length, 2, "оба плеча влезают в двое суток с дорогой домой")
  assert.ok(
    route.totalHours <= route.maxHours,
    `в пути ${route.totalHours} ч при лимите ${route.maxHours} ч`,
  )
  assert.ok(
    route.reasons.some((line) => line.startsWith("Маршрут занял")),
    `причины показывают занятое время: ${route.reasons.join(" | ")}`,
  )
})

test("длинный груз не влез — берём более короткий, а не останавливаем цепочку", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const LIPETSK = { lat: 52.61, lng: 39.59 }
  const loads = [
    // Выгоднее за километр, но ехать 700 км — в 24 ч вместе с отдыхом и
    // возвратом не влезает никак
    load({ id: "long", fromCity: "Москва", toCity: "Воронеж", distanceKm: 700, weightKg: 5000, priceRub: 250000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    // Короче и дешевле за километр, но в лимит укладывается
    load({ id: "short", fromCity: "Москва", toCity: "Липецк", distanceKm: 150, weightKg: 5000, priceRub: 40000, fromPoint: MOSCOW, toPoint: LIPETSK }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 24,
    startPoint: MOSCOW,
  })
  assert.ok(route)
  assert.equal(route.legs.length, 1, "цепочка не пустая")
  assert.equal(route.legs[0].load.id, "short", "взяли груз, который влезает в срок")
})

test("«осталось на бирже» считает пригодные грузы, а не всё подряд", () => {
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 52000 }),
    // Влезает в машину, ставка есть, дата свежая — но не взяли: другое направление
    load({ id: "b", fromCity: "Казань", toCity: "Уфа", distanceKm: 500, priceRub: 90000 }),
    // Без ставки — в «пригодные» не идёт
    load({ id: "c", fromCity: "Тула", toCity: "Орёл", distanceKm: 300, priceRub: 0 }),
    // Не влезает в машину
    load({ id: "d", fromCity: "Курск", toCity: "Белгород", distanceKm: 150, priceRub: 30000, weightKg: 25000 }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.ok(route)
  assert.equal(route.leftover.usable, 1, "только Казань → Уфа подошёл бы, но не взятый")
  assert.equal(route.leftover.noRate, 1, "один груз без ставки")
  assert.equal(route.leftover.notFit, 1, "один не влезает в машину")
  assert.equal(
    route.leftover.usable + route.leftover.notFit + route.leftover.noRate + route.leftover.pastDate + route.leftover.other,
    route.excluded.length,
    "счётчики сходятся с полным списком отложенных",
  )
})

test("расстояния помечены как оценка по прямой", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 52000 })],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.ok(route)
  assert.ok(
    route.reasons.some((line) => line.includes("по прямой")),
    `причины помечают оценки: ${route.reasons.join(" | ")}`,
  )
})

test("часы словами: 11 ч, 1 день, 2 дня 1 ч", () => {
  assert.equal(hoursSpan(11), "11 ч")
  assert.equal(hoursSpan(24), "1 день")
  assert.equal(hoursSpan(25), "1 день 1 ч")
  assert.equal(hoursSpan(49), "2 дня 1 ч")
  assert.equal(hoursSpan(48), "2 дня")
  assert.equal(hoursSpan(0), "0 ч")
})

test("на предельном лимите подсказки роста нет — выше 168 ч не уехать", () => {
  const route = buildRoute({
    startCity: "Москва",
    loads: [load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 52000 })],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 168,
  })
  assert.ok(route)
  assert.equal(route.growthHours, null, "расти некуда — выше 168 ч лимита нет")
  assert.ok(
    route.growthHint === null || route.growthHint.includes("радиус"),
    `подсказка на предельном лимите не про время: ${route.growthHint}`,
  )
})

// ── 21. Провал не тупик: «рядом» считается по радиусу, как у сборщика ────
// Живая биржа: база «Москва», грузов ИЗ Москвы — ноль, а в радиусе 300 км
// — больше сотни. Объяснение «грузов из Москвы нет» оставляло логиста в
// тупике, хотя помощник строит маршрут из радиуса.
test("провал в городе без грузов ведёт строить от ближайшего", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const STUPINO = { lat: 54.9, lng: 38.0 }
  const loads = [
    load({ id: "a", fromCity: "Ступино", toCity: "Воронеж", distanceKm: 500, priceRub: 60000, fromPoint: STUPINO }),
    load({ id: "b", fromCity: "Тверь", toCity: "Воронеж", distanceKm: 600, priceRub: 70000 }),
  ]
  const reason = explainFailure({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    startRadiusKm: 300,
    startPoint: MOSCOW,
  })
  assert.ok(reason)
  assert.equal(reason.loadsFromCity, 0, "из самой Москвы грузов нет")
  assert.equal(reason.loadsNearby, 1, "рядом — Ступино")
  assert.equal(reason.loadsNearbyPriced, 1, "со ставкой")
  assert.ok(
    reason.headline.includes("рядом") && reason.headline.includes("300"),
    `заголовок ведёт строить от ближайшего: ${reason.headline}`,
  )
})

test("если рядом тоже пусто — говорим это прямо", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const NOVOSIBIRSK = { lat: 55.03, lng: 82.92 }
  const loads = [
    load({ id: "a", fromCity: "Новосибирск", toCity: "Омск", distanceKm: 600, priceRub: 70000, fromPoint: NOVOSIBIRSK }),
  ]
  const reason = explainFailure({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    startRadiusKm: 300,
    startPoint: MOSCOW,
  })
  assert.ok(reason)
  assert.equal(reason.loadsNearby, 0)
  assert.ok(
    reason.headline.includes("рядом"),
    `без грузов рядом не обещаем строить: ${reason.headline}`,
  )
})

test("груз без ставки не считается кандидатом «рядом»", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const STUPINO = { lat: 54.9, lng: 38.0 }
  const loads = [
    load({ id: "a", fromCity: "Ступино", toCity: "Воронеж", distanceKm: 500, priceRub: 0, fromPoint: STUPINO }),
  ]
  const reason = explainFailure({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    startRadiusKm: 300,
    startPoint: MOSCOW,
  })
  assert.ok(reason)
  assert.equal(reason.loadsNearby, 1, "груз рядом есть")
  assert.equal(reason.loadsNearbyPriced, 0, "но ставки нет — строить не из чего")
})

// ── 22. Обратный груз домой: машина не едет порожняком ──────────────────
// Логист не возит пустую машину. Если на бирже есть груз из конечного
// города маршрута на базу — он и закрывает выезд, и прибыль выше на весь
// порожний возврат.
test("обратный груз на базу закрывает выезд", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const LIPETSK = { lat: 52.61, lng: 39.59 }
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 70000, fromPoint: VORONEZH, toPoint: LIPETSK }),
    load({ id: "back", fromCity: "Липецк", toCity: "Москва", distanceKm: 450, priceRub: 90000, fromPoint: LIPETSK, toPoint: MOSCOW }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 72,
    startPoint: MOSCOW,
  })
  assert.ok(route)
  assert.equal(route.legs.length, 3, "обратка добавилась плечом")
  assert.equal(route.legs[2].load.id, "back", "обратка — последним плечом")
  assert.equal(route.legs[2].returnsHome, true, "плечо везёт домой")
  assert.equal(route.returnDeadheadKm, 0, "порожнего возврата нет")
  assert.equal(route.returnsHomeWithLoad, true)
  assert.ok(
    route.reasons.some((line) => line.includes("Возврат домой с грузом")),
    `причины объясняют обратку: ${route.reasons.join(" | ")}`,
  )
})

test("убыточная обратка не берётся — остаётся порожний возврат", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const LIPETSK = { lat: 52.61, lng: 39.59 }
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 70000, fromPoint: VORONEZH, toPoint: LIPETSK }),
    // 450 км за 3000 ₽ — топливо дороже ставки
    load({ id: "back", fromCity: "Липецк", toCity: "Москва", distanceKm: 450, priceRub: 3000, fromPoint: LIPETSK, toPoint: MOSCOW }),
  ]
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 72,
    startPoint: MOSCOW,
  })
  assert.ok(route)
  assert.equal(route.legs.length, 2, "обратка не добавилась")
  assert.ok(route.returnDeadheadKm > 0, "возврат порожний — и это честно написано")
  assert.equal(route.returnsHomeWithLoad, false)
  assert.ok(
    route.reasons.some((line) => line.includes("порожнем")),
    `причины называют порожний возврат: ${route.reasons.join(" | ")}`,
  )
})

test("обратка везёт домой и в свой городской округ", () => {
  const BASE = { lat: 55.44, lng: 37.75 }
  const HIMKI = { lat: 55.897, lng: 37.4293 }
  const KONST = { lat: 55.4, lng: 37.72 }
  const loads = [
    load({ id: "a", fromCity: "Домодедово", toCity: "Химки", distanceKm: 133, priceRub: 16500, fromPoint: BASE, toPoint: HIMKI }),
    load({ id: "back", fromCity: "Химки", toCity: "Константиново с. (г.о. Домодедово)", distanceKm: 40, priceRub: 12000, fromPoint: HIMKI, toPoint: KONST }),
  ]
  const route = buildRoute({
    startCity: "Домодедово",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 48,
    startPoint: BASE,
  })
  assert.ok(route)
  assert.equal(route.returnDeadheadKm, 0, "Константиново — свой округ, возврата нет")
  assert.equal(route.returnsHomeWithLoad, true)
})

test("обратка не берётся, если не влезает в лимит времени", () => {
  const MOSCOW = { lat: 55.75, lng: 37.62 }
  const VORONEZH = { lat: 51.67, lng: 39.21 }
  const loads = [
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    load({ id: "back", fromCity: "Воронеж", toCity: "Москва", distanceKm: 526, priceRub: 120000, fromPoint: VORONEZH, toPoint: MOSCOW }),
  ]
  // 526 км — это 9.6 ч вождения: по нормам нужен отдых, поэтому плечо занимает
  // ~25 ч. Ровно столько лимит и даёт: туда влезает, обратка — уже нет.
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 40,
    startPoint: MOSCOW,
  })
  assert.ok(route)
  assert.equal(route.legs.length, 1, "обратка не влезла в срок")
  assert.ok(route.totalHours <= route.maxHours, "лимит не нарушен")
})

test("машина пришла на базу — маршрут закончен, плечо «после дома» не берём", () => {
  // Живой замер (база «Нижний Новгород»): цепочка шла «НН → Москва → НН
  // (домой) → Дзержинск → Дзержинск» — после возврата на базу она брала ещё
  // одно плечо в 35 км. Для логиста это два разных рейса: приехал домой —
  // выезд закончился.
  const NN = { lat: 56.3269, lng: 44.0059 }
  const MSK = { lat: 55.7558, lng: 37.6173 }
  const DZ = { lat: 56.2377, lng: 43.4595 }
  const route = buildRoute({
    startCity: "Нижний Новгород",
    startPoint: NN,
    loads: [
      load({ id: "out", fromCity: "Нижний Новгород", toCity: "Москва", distanceKm: 440, priceRub: 110000, fromPoint: NN, toPoint: MSK }),
      load({ id: "back", fromCity: "Москва", toCity: "Нижний Новгород", distanceKm: 440, priceRub: 100000, fromPoint: MSK, toPoint: NN }),
      load({ id: "after", fromCity: "Дзержинск", toCity: "Дзержинск", distanceKm: 40, priceRub: 30000, fromPoint: DZ, toPoint: DZ }),
    ],
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    detourKm: 150,
    startRadiusKm: 300,
  })
  assert.ok(route)
  assert.deepEqual(route.legs.map((leg) => leg.load.id), ["out", "back"], "плечо после возврата домой не берём")
  assert.equal(route.returnDeadheadKm, 0, "дома — пустого возврата нет")
})

// ── Машина: вес, объём и тип кузова ────────────────────────────────────────
test("в 5-тонную машину 10.8 т не кладём", () => {
  // Живой случай: логист выбирал 5-тонную, а помещник показывал маршрут с
  // грузом на 10.8 т. Проверка веса работала — но выбранную машину сборщику
  // не передавали, он перебирал весь автопарк. Здесь фиксируем саму проверку;
  // выбор машины в сценарии проверяется тестом «одна машина — только её».
  const route = buildRoute({
    startCity: "Москва",
    startPoint: { lat: 55.75, lng: 37.62 },
    loads: [
      load({
        id: "heavy",
        weightKg: 10800,
        distanceKm: 170,
        priceRub: 90000,
        fromPoint: { lat: 55.75, lng: 37.62 },
        toPoint: { lat: 56.86, lng: 35.9 },
      }),
    ],
    vehicles: [vehicle({ capacity: 5000, volume: 32, type: "изотерм" })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.equal(route, null, "груз тяжелее машины не берём")
})

test("объём тоже проверяется: 82 м³ в 32 м³ не влезает", () => {
  const route = buildRoute({
    startCity: "Москва",
    startPoint: { lat: 55.75, lng: 37.62 },
    loads: [
      load({
        id: "bulky",
        weightKg: 3000,
        volumeM3: 82,
        distanceKm: 170,
        priceRub: 90000,
        fromPoint: { lat: 55.75, lng: 37.62 },
        toPoint: { lat: 56.86, lng: 35.9 },
      }),
    ],
    vehicles: [vehicle({ capacity: 5000, volume: 32, type: "изотерм" })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.equal(route, null, "груз объёмнее машины не берём")
})

test("тип кузова: груз «только рефрижератор» в тент не ставим", () => {
  const cold = {
    id: "cold",
    weightKg: 3000,
    distanceKm: 170,
    priceRub: 90000,
    truckType: "Рефрижератор",
    fromPoint: { lat: 55.75, lng: 37.62 },
    toPoint: { lat: 56.86, lng: 35.9 },
  }
  const base = {
    startCity: "Москва",
    startPoint: { lat: 55.75, lng: 37.62 },
    fuelPriceRubPerL: FUEL,
    now: NOW,
  }
  assert.equal(
    buildRoute({ ...base, loads: [load(cold)], vehicles: [vehicle({ type: "тент" })] }),
    null,
    "тент не берёт температурный груз",
  )
  const ok = buildRoute({ ...base, loads: [load(cold)], vehicles: [vehicle({ type: "рефрижератор" })] })
  assert.ok(ok, "рефрижератор берёт температурный груз")
})

test("изотерм берёт сухой груз, а тент не берёт груз с изотермом", () => {
  const dry = {
    id: "dry",
    weightKg: 3000,
    distanceKm: 170,
    priceRub: 90000,
    truckType: "Тент, Фургон, Контейнеровоз, Кузов #16",
    fromPoint: { lat: 55.75, lng: 37.62 },
    toPoint: { lat: 56.86, lng: 35.9 },
  }
  const base = {
    startCity: "Москва",
    startPoint: { lat: 55.75, lng: 37.62 },
    fuelPriceRubPerL: FUEL,
    now: NOW,
  }
  assert.ok(
    buildRoute({ ...base, loads: [load(dry)], vehicles: [vehicle({ type: "изотерм", capacity: 5000, volume: 32 })] }),
    "сухой груз в изотерм ставим",
  )
  assert.equal(
    buildRoute({
      ...base,
      loads: [load({ ...dry, truckType: "Изотерм" })],
      vehicles: [vehicle({ type: "тент" })],
    }),
    null,
    "тент не берёт груз, которому нужен изотерм",
  )
})

test("незнакомый код кузова не мешает брать груз", () => {
  // «Кузов #16» ATI пишет вместо типа — не повод выбрасывать груз.
  const route = buildRoute({
    startCity: "Москва",
    startPoint: { lat: 55.75, lng: 37.62 },
    loads: [
      load({
        id: "unknown",
        weightKg: 3000,
        distanceKm: 170,
        priceRub: 90000,
        truckType: "Кузов #16",
        fromPoint: { lat: 55.75, lng: 37.62 },
        toPoint: { lat: 56.86, lng: 35.9 },
      }),
    ],
    vehicles: [vehicle({ type: "тент" })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.ok(route, "неизвестный тип кузова не отсекает груз")
})

test("одна машина — только её: сборщик не подменяет 5-тонную на 20-тонную", () => {
  const route = buildRouteVariants({
    startCity: "Москва",
    startPoint: { lat: 55.75, lng: 37.62 },
    loads: [
      load({
        id: "fit",
        weightKg: 3000,
        distanceKm: 170,
        priceRub: 60000,
        fromPoint: { lat: 55.75, lng: 37.62 },
        toPoint: { lat: 56.86, lng: 35.9 },
      }),
      load({
        id: "heavy",
        weightKg: 15000,
        distanceKm: 170,
        priceRub: 170000,
        fromCity: "Тверь",
        toCity: "Москва",
        fromPoint: { lat: 56.86, lng: 35.9 },
        toPoint: { lat: 55.75, lng: 37.62 },
      }),
    ],
    vehicles: [vehicle({ id: "v5", plate: "K215CT790", capacity: 5000, volume: 32, type: "изотерм" })],
    fuelPriceRubPerL: FUEL,
    now: NOW,
  })
  assert.ok(route.length > 0)
  assert.equal(route[0].route.vehicle.id, "v5")
  assert.ok(
    route[0].route.legs.every((leg) => (leg.load.weightKg ?? 0) <= 5000),
    "тяжёлый груз в пятитонку не попал",
  )
})

// ── 20. Время рейса: погрузка по весу и режим труда и отдыха ───────────────
test("погрузка-выгрузка считается по весу груза, а не константой 4 ч", () => {
  // Живой замер: маршрут на 5-тонной машине с грузом 600 кг показывал 20 ч
  // вместо 12 — четыре часа на погрузку и выгрузку завышали короткое плечо
  // вдвое и съедали лимит, который логист выставил.
  assert.equal(handlingHours(600), 2, "мелкий груз — 2 ч")
  assert.equal(handlingHours(1500), 2)
  assert.equal(handlingHours(3000), 3)
  assert.equal(handlingHours(5000), 3)
  assert.equal(handlingHours(10000), 4)
  assert.equal(handlingHours(20000), 5, "фура — 5 ч")
  assert.equal(handlingHours(null), 4, "вес не назван — считаем как фуру")
  assert.equal(handlingHours(0), 4)
})

test("водитель не едет 20 часов подряд: отдых входит в часы рейса", () => {
  // До этой правки маршрут считался непрерывным: 68 часов в пути при лимите 72
  // выглядели как «успеваем». По нормам вождение — не больше 9 часов между
  // отдыхами, отдых — не меньше 11 часов.
  assert.equal(DRIVE_LIMIT_HOURS, 9)
  assert.equal(REST_HOURS, 11)
  // За рулём 8 ч с последнего отдыха — ещё 3 ч влезают без отдыха
  assert.deepEqual(restForSegment(8, 3), { restHours: 11, driveAfter: 2 }, "3 ч не влезают в остаток нормы — отдых, потом 2 ч")
  // За рулём 5 ч — 4 ч влезают в норму без отдыха
  assert.deepEqual(restForSegment(5, 4), { restHours: 0, driveAfter: 9 })
  // 8 + 10 = 18 ч: норма выработана, нужен отдых, после него остаётся 9 ч
  assert.deepEqual(restForSegment(8, 10), { restHours: 11, driveAfter: 9 })
  // Плечо 1100 км = 20 ч вождения: это трое суток с двумя ночами
  const drive = driveHours(0, 1100)
  const rest = restForSegment(0, drive)
  assert.ok(drive > 19.9 && drive < 20.1, `вождение ${drive} ч`)
  assert.equal(rest.restHours, 22, "два ночных отдыха на 20 ч вождения")
})

test("часы плеча 1100 км на фуре включают отдых, погрузку и выгрузку", () => {
  // 20 ч вождения + 22 ч отдыха + 5 ч погрузки на 20 т = 47 ч
  const hours = legHours(0, 1100, 20000, 0)
  assert.ok(hours >= 46.5 && hours <= 47.5, `получено ${hours} ч`)
  // Порожний возврат тех же 1100 км — без погрузки, но с отдыхом:
  // 18.3 ч вождения + 22 ч отдыха, часы на погрузку не добавляются
  const back = legHours(1100, 0, null, 0)
  assert.ok(back > 40 && back < 41, `порожний возврат ${back} ч`)
})
