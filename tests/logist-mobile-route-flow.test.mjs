/**
 * Тесты «туннеля рейса» (lib/logist-mobile/route-flow.ts).
 *
 * Проверяем три обещания экрана рейса:
 *   1) логист всегда видит один следующий шаг — и он правильный для этого статуса;
 *   2) список точек — это маршрут, а не список адресов (повторы схлопнуты);
 *   3) деньги рейса считаются честно: выручка по заказам, расходы по чекам
 *      или по оценке, и когда данных нет — программа об этом говорит словами.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  routeStageLabel,
  routeOrderProgress,
  routeNextStep,
  routeListHint,
  routeWaypoints,
  routeMoney,
  moneyBasisLabel,
  routeTotals,
  routeSummaryLine,
} = require("../.test-build/lib/logist-mobile/route-flow.js")

function order(overrides = {}) {
  return {
    id: "demo-order-1",
    status: "assigned",
    routeFrom: "Москва, улица Складская, 8",
    routeTo: "Тула, улица Рязанская, 38",
    clientName: "ООО «Ромашка»",
    cargoType: "ТНП",
    weight: 4200,
    price: 38000,
    agreedPrice: null,
    routeSequence: 1,
    distance: 210,
    ...overrides,
  }
}

const shortCity = (address) => {
  if (!address) return "—"
  return String(address).split(",")[0].replace(/^г\.\s*/i, "").trim()
}

// ───────────────────────────── статусы и прогресс ─────────────────────────────

test("статус рейса называется так же, как в компьютерной версии", () => {
  assert.equal(routeStageLabel("planned"), "Запланирован")
  assert.equal(routeStageLabel("active"), "Назначен")
  assert.equal(routeStageLabel("in_transit"), "В пути")
  assert.equal(routeStageLabel("completed"), "Завершён")
  assert.equal(routeStageLabel("cancelled"), "Отменён")
  // Неизвестный статус не выдумываем — отдаём как есть
  assert.equal(routeStageLabel("какой-то"), "какой-то")
})

test("прогресс рейса: доставлено, в пути, ещё не начали", () => {
  const progress = routeOrderProgress([
    order({ id: "o1", status: "delivered" }),
    order({ id: "o2", status: "in_route" }),
    order({ id: "o3", status: "assigned" }),
    order({ id: "o4", status: "search" }),
  ])
  assert.deepEqual(progress, { total: 4, delivered: 1, moving: 1, awaiting: 2 })
})

// ───────────────────────────── следующий шаг ─────────────────────────────

test("без водителя шаг один — передать водителю", () => {
  const step = routeNextStep({ status: "planned", driverId: null, orders: [order()] })
  assert.equal(step.key, "handover")
  assert.equal(step.label, "Передать водителю")
  assert.equal(step.tone, "warn")
  assert.equal(step.action, undefined)
})

test("рейс с водителем, но без выезда — подтвердить выезд", () => {
  for (const status of ["planned", "active"]) {
    const step = routeNextStep({
      status,
      driverId: "demo-driver-1",
      driverName: "Фёдоров",
      orders: [order()],
    })
    assert.equal(step.key, "start")
    assert.equal(step.label, "Подтвердить выезд")
    assert.equal(step.action?.kind, "start")
    assert.equal(step.action?.tone, "primary")
    assert.match(step.hint, /Фёдоров/)
    // Логист фиксирует старт, а «В пути» рейс ставит действие водителя
    assert.match(step.hint, /В пути/)
  }
})

test("водитель выехал, но работу не начал — от логиста ничего не нужно", () => {
  const step = routeNextStep({
    status: "active",
    driverId: "demo-driver-1",
    driverName: "Фёдоров",
    startedAt: "2026-10-08T09:00:00.000Z",
    orders: [order()],
  })
  assert.equal(step.key, "wait")
  assert.equal(step.action, undefined)
  assert.match(step.hint, /станет «В пути»/)
})

test("в пути: пока точки не доставлены — следим за выгрузкой", () => {
  const step = routeNextStep({
    status: "in_transit",
    driverId: "demo-driver-1",
    orders: [order({ id: "o1", status: "delivered" }), order({ id: "o2", status: "in_route" })],
  })
  assert.equal(step.key, "track")
  assert.match(step.label, /осталось 1/)
  assert.match(step.hint, /Доставлено 1 из 2/)
  // Закрыть рейс можно и с недоставленными точками, но кнопка запасная
  assert.equal(step.action?.kind, "finish")
  assert.equal(step.action?.tone, "secondary")
  assert.match(step.action?.confirm ?? "", /Оставшиеся точки/)
})

test("в пути и всё доставлено — пора закрывать рейс", () => {
  const step = routeNextStep({
    status: "in_transit",
    driverId: "demo-driver-1",
    orders: [order({ id: "o1", status: "delivered" }), order({ id: "o2", status: "delivered" })],
  })
  assert.equal(step.key, "finish")
  assert.equal(step.action?.kind, "finish")
  assert.equal(step.action?.tone, "primary")
  assert.match(step.hint, /освободятся/)
})

test("закрытый и отменённый рейс ничего не требуют", () => {
  const done = routeNextStep({ status: "completed", driverId: "d1", orders: [order({ status: "delivered" })] })
  assert.equal(done.key, "done")
  assert.equal(done.tone, "ok")

  const cancelled = routeNextStep({ status: "cancelled", driverId: null, orders: [order()] })
  assert.equal(cancelled.key, "cancelled")
  assert.match(cancelled.hint, /помощник сборки/i)
})

test("рейс только выехал: в подсказке видно, что точки в дороге", () => {
  const fresh = {
    status: "in_transit",
    driverId: "demo-driver-1",
    orders: [order({ id: "o1", status: "in_route" }), order({ id: "o2", status: "control" })],
  }
  const step = routeNextStep(fresh)
  assert.match(step.hint, /Ни одна точка ещё не закрыта/)
  assert.match(step.hint, /2 точки в дороге/)
  assert.equal(routeListHint(fresh).text, "В пути: 2 точки в дороге")
})

test("подсказка в списке короче, но про то же", () => {
  const noDriver = routeListHint({ status: "planned", driverId: null, orders: [order()] })
  assert.equal(noDriver.tone, "warn")
  assert.match(noDriver.text, /Нет водителя/)

  const onRoad = routeListHint({
    status: "in_transit",
    driverId: "d1",
    orders: [order({ id: "o1", status: "delivered" }), order({ id: "o2", status: "in_route" })],
  })
  assert.match(onRoad.text, /доставлено 1 из 2/i)
})

// ───────────────────────────── маршрут по точкам ─────────────────────────────

test("точки рейса схлопывают повторы и идут по порядку", () => {
  const points = routeWaypoints(
    [
      order({ id: "o1", routeFrom: "Москва, склад", routeTo: "Тула, центр", routeSequence: 1 }),
      order({ id: "o2", routeFrom: "Тула, центр", routeTo: "Воронеж, склад", routeSequence: 2 }),
      order({ id: "o3", routeFrom: "Воронеж, склад", routeTo: "Ростов, порт", routeSequence: 3 }),
    ],
    shortCity,
  )
  assert.deepEqual(points, ["Москва", "Тула", "Воронеж", "Ростов"])
})

test("порядок точек берётся из routeSequence, а не из порядка массива", () => {
  const points = routeWaypoints(
    [
      order({ id: "o2", routeFrom: "Тула", routeTo: "Воронеж", routeSequence: 2 }),
      order({ id: "o1", routeFrom: "Москва", routeTo: "Тула", routeSequence: 1 }),
    ],
    shortCity,
  )
  assert.deepEqual(points, ["Москва", "Тула", "Воронеж"])
})

test("пустой рейс — пустой маршрут, без выдумок", () => {
  assert.deepEqual(routeWaypoints([], shortCity), [])
})

// ───────────────────────────── деньги ─────────────────────────────

test("деньги по заказам: договорная цена важнее прайсовой", () => {
  const money = routeMoney({
    status: "active",
    driverId: "d1",
    orders: [
      order({ id: "o1", price: 38000, agreedPrice: null }),
      order({ id: "o2", price: 1000, agreedPrice: 30000 }),
    ],
    distanceKm: 340,
  })
  assert.equal(money.revenue, 68000)
  assert.equal(money.revenuePerKm, 200)
  assert.equal(money.cost, null)
  assert.equal(money.basis, null)
  assert.equal(moneyBasisLabel(money.basis), "расходов пока нет")
})

test("расходы фактом важнее оценки, прибыль считается от факта", () => {
  const money = routeMoney({
    status: "in_transit",
    driverId: "d1",
    orders: [order({ price: 72000 })],
    distanceKm: 395,
    economics: {
      revenueRub: 72000,
      factCostRub: 52000,
      estimatedCostRub: 60000,
      profitRub: 20000,
      rubPerKmRevenue: 182,
      costPerKm: 132,
      basis: "fact",
    },
  })
  assert.equal(money.cost, 52000)
  assert.equal(money.basis, "fact")
  assert.equal(money.profit, 20000)
  assert.equal(money.costPerKm, 132)
  assert.equal(moneyBasisLabel(money.basis), "по расходам рейса")
  assert.equal(money.unprofitable, false)
})

test("оценка по топливу используется, пока чеков нет", () => {
  const money = routeMoney({
    status: "in_transit",
    driverId: "d1",
    orders: [order({ price: 40000 })],
    distanceKm: 300,
    economics: { revenueRub: 40000, factCostRub: null, estimatedCostRub: 45000, basis: "estimate" },
  })
  assert.equal(money.basis, "estimate")
  assert.equal(money.cost, 45000)
  assert.equal(money.profit, -5000)
  assert.equal(money.unprofitable, true)
  assert.equal(moneyBasisLabel(money.basis), "оценка по топливу")
})

test("заказы без цены видны: их деньги в выручку не попали", () => {
  const money = routeMoney({
    status: "planned",
    driverId: null,
    orders: [order({ price: 38000 }), order({ id: "o2", price: null, agreedPrice: null })],
  })
  assert.equal(money.revenue, 38000)
  assert.equal(money.withoutPrice, 1)
})

test("убыточный рейс не маскируется под нормальный", () => {
  const money = routeMoney({
    status: "in_transit",
    driverId: "d1",
    orders: [order({ price: 30000 })],
    distanceKm: 400,
    economics: { revenueRub: 30000, factCostRub: 41000, basis: "fact" },
  })
  assert.equal(money.unprofitable, true)
  assert.equal(money.profit, -11000)
})

// ───────────────────────────── итоги и строка ─────────────────────────────

test("итоги рейса: заказы, километры, вес, выручка", () => {
  const totals = routeTotals({
    status: "active",
    driverId: "d1",
    orders: [
      order({ id: "o1", weight: 4200, price: 38000, distance: 210 }),
      order({ id: "o2", weight: 3000, price: 27000, distance: 240 }),
    ],
  })
  assert.equal(totals.orders, 2)
  assert.equal(totals.distanceKm, 240) // самая дальняя точка
  assert.equal(totals.weightKg, 7200)
  assert.equal(totals.revenue, 65000)
})

test("строка рейса читается как фраза, без «1 заказов»", () => {
  const one = routeSummaryLine(
    { status: "active", driverId: "d1", orders: [order()], distanceKm: 210 },
    (value) => (value ? `${(value / 1000).toFixed(1).replace(".", ",")} т` : "—"),
  )
  assert.equal(one, "1 заказ · 210 км · 4,2 т")

  const many = routeSummaryLine(
    {
      status: "active",
      driverId: "d1",
      orders: [order(), order({ id: "o2" }), order({ id: "o3" })],
      distanceKm: 500,
    },
    () => "12,6 т",
  )
  assert.equal(many, "3 заказа · 500 км · 12,6 т")
})
