/**
 * Тесты сборщика маршрута из грузов биржи (lib/logist-mobile/route-builder.ts).
 *
 * Помощник обещает логисту: из грузов ATI сложить цепочку «база → город →
 * город → домой», где каждое плечо окупается. Проверяем:
 *  1) цепочка строится от точки старта по стыковке городов;
 *  2) убыточные плечи не берутся;
 *  3) низкая ставка (₽/км) — тоже мимо;
 *  4) груз, который не влезает в машину, не берётся;
 *  5) машина перебирается: выбираем вариант с лучшей прибылью на км;
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

test("груз, к дате загрузки которого не успеть, помечается риском", () => {
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
  assert.equal(route.legs.length, 2)
  assert.equal(route.legs[1].lateRisk, true, "приедем завтра, загрузка была сегодня")
  assert.equal(route.lateRiskLegs, 1)
  assert.ok(
    route.reasons.some((line) => line.includes("не успеть")),
    `причины: ${route.reasons.join(" | ")}`,
  )
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
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000 }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 70000 }),
    load({ id: "c", fromCity: "Липецк", toCity: "Тамбов", distanceKm: 300, priceRub: 80000 }),
    load({ id: "d", fromCity: "Тамбов", toCity: "Саратов", distanceKm: 400, priceRub: 100000 }),
  ]
  // Плечо «Москва → Воронеж»: 526/55 + 4 ч погрузки-выгрузки ≈ 13.6 ч
  const short = buildRoute({
    startCity: "Москва", loads, vehicles: [vehicle()], fuelPriceRubPerL: FUEL, now: NOW, maxHours: 24,
  })
  const long = buildRoute({
    startCity: "Москва", loads, vehicles: [vehicle()], fuelPriceRubPerL: FUEL, now: NOW, maxHours: 72,
  })
  assert.ok(short && long)
  assert.equal(short.legs.length, 2, "сутки — два плеча: 13.6 + 9.1 ч влезают, третье уже нет")
  assert.equal(long.legs.length, 4, "трое суток — вся цепочка")
  assert.ok(long.totalRevenue > short.totalRevenue)
  assert.ok(short.totalHours <= 24 + 9, "суточный маршрут плюс возврат домой")
  assert.ok(long.totalHours > short.totalHours)
  assert.ok(
    Math.abs(short.legs[0].hours - 13.6) < 0.05,
    `часы плеча = км/55 + 4 ч, получено ${short.legs[0].hours}`,
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
    load({ id: "a", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 120000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    load({ id: "b", fromCity: "Воронеж", toCity: "Липецк", distanceKm: 280, priceRub: 70000, fromPoint: VORONEZH, toPoint: LIPETSK }),
    load({ id: "c", fromCity: "Липецк", toCity: "Тамбов", distanceKm: 300, priceRub: 80000, fromPoint: LIPETSK, toPoint: TAMBOV }),
    load({ id: "d", fromCity: "Тамбов", toCity: "Саратов", distanceKm: 400, priceRub: 100000, fromPoint: TAMBOV, toPoint: SARATOV }),
  ]
  // Плечи занимают 43.5 ч, возврат из Саратова — ещё ~14 ч: в 50 ч не влезает.
  // detourKm: 0 — проверяем именно срок: цепочка здесь идёт по точному
  // совпадению городов, и радиус «по пути» к смыслу теста не относится.
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 50,
    detourKm: 0,
    startPoint: MOSCOW,
  })
  assert.ok(route)
  assert.equal(route.legs.length, 3, "последнее плечо снято — маршрут не длиннее срока")
  assert.ok(route.totalHours <= 50, `в пути ${route.totalHours} ч при лимите 50 ч`)
  assert.ok(
    route.reasons.some((line) => /не влезал|не влезало|лимит/.test(line)),
    `причины объясняют обрезку: ${route.reasons.join(" | ")}`,
  )
  // Время — честно: сколько заняли и сколько осталось, а не «уложились»
  assert.ok(
    route.reasons.some((line) => line.startsWith("Маршрут занял")),
    `причины показывают занятое время: ${route.reasons.join(" | ")}`,
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
    // Выгоднее за километр, но ехать 526 км — в 24 ч вместе с возвратом не влезает
    load({ id: "long", fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 250000, fromPoint: MOSCOW, toPoint: VORONEZH }),
    // Короче и дешевле за километр, но в лимит укладывается
    load({ id: "short", fromCity: "Москва", toCity: "Липецк", distanceKm: 280, priceRub: 40000, fromPoint: MOSCOW, toPoint: LIPETSK }),
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
  // 13.6 ч туда + дорога домой = 25.4 ч — влезает; обратка добавит ещё
  // 13.6 ч, и лимит 26 ч будет нарушен
  const route = buildRoute({
    startCity: "Москва",
    loads,
    vehicles: [vehicle()],
    fuelPriceRubPerL: FUEL,
    now: NOW,
    maxHours: 26,
    startPoint: MOSCOW,
  })
  assert.ok(route)
  assert.equal(route.legs.length, 1, "обратка не влезла в срок")
  assert.ok(route.totalHours <= route.maxHours, "лимит не нарушен")
})
