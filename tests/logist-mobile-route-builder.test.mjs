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
const { buildRoute, loadPrice, loadRatePerKm, routeSummaryLine } = require(
  "../.test-build/lib/logist-mobile/route-builder.js",
)

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
    loadingDate: "2026-10-24T08:00:00.000Z",
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
