// tests/trip-history.test.mjs
//
// История рейса (задача 7): хронология, расходы и итог — сколько проехали,
// сколько заработали, сколько потратили и что осталось.

import assert from "node:assert/strict"
import test from "node:test"

import {
  buildTripSummary,
  buildTripTimeline,
  expenseTypeLabel,
  fuelConsumptionPer100Km,
  groupExpensesByType,
  tripDistanceKm,
} from "../.test-build/lib/trips/history.js"

const statusLabel = (status) => `Статус: ${status}`

function route(overrides = {}) {
  return {
    id: "route-1",
    name: "Рейс: Москва — Казань",
    status: "completed",
    createdAt: new Date("2026-09-01T08:00:00"),
    startedAt: new Date("2026-09-02T06:00:00"),
    completedAt: new Date("2026-09-04T20:00:00"),
    totalDistance: 1600,
    startOdometer: null,
    endOdometer: null,
    ...overrides,
  }
}

function expense(overrides = {}) {
  return { id: "exp-1", type: "fuel", amount: 5000, ...overrides }
}

test("пробег считается по одометру, если его записали", () => {
  const result = tripDistanceKm({
    startOdometer: 120000,
    endOdometer: 121640,
    totalDistance: 1500,
    orders: [{ id: "o1", distance: 800 }],
  })

  assert.equal(result.distanceKm, 1640)
  assert.equal(result.odometerDistanceKm, 1640)
  assert.equal(result.plannedDistanceKm, 1500)
})

test("пробег без одометра: берётся плановый, потом сумма заказов, иначе ноль", () => {
  assert.equal(tripDistanceKm({ totalDistance: 900 }).distanceKm, 900)
  assert.equal(
    tripDistanceKm({ orders: [{ id: "o1", distance: 300 }, { id: "o2", distance: 200 }] })
      .distanceKm,
    500,
  )
  assert.equal(tripDistanceKm({}).distanceKm, 0)
  // одометр «назад» — это опечатка, а не отрицательный пробег
  assert.equal(
    tripDistanceKm({ startOdometer: 200000, endOdometer: 150000, totalDistance: 700 }).distanceKm,
    700,
  )
})

test("итог рейса: заработок, расходы, топливо и что осталось", () => {
  const summary = buildTripSummary({
    route: route({ startOdometer: 120000, endOdometer: 121600 }),
    orders: [
      { id: "o1", price: 60000, agreedPrice: 65000, distance: 800 },
      { id: "o2", price: 40000, distance: 800 },
    ],
    expenses: [
      expense({ id: "fuel1", amount: 18000, liters: 300 }),
      expense({ id: "fuel2", amount: 9000, liters: 150 }),
      expense({ id: "toll", type: "toll", amount: 3000 }),
    ],
  })

  assert.equal(summary.ordersCount, 2)
  assert.equal(summary.distanceKm, 1600)
  assert.equal(summary.durationDays, 3)
  assert.equal(summary.revenueRub, 105000) // 65 000 (согласованная) + 40 000
  assert.equal(summary.expensesRub, 30000)
  assert.equal(summary.fuelRub, 27000)
  assert.equal(summary.fuelLiters, 450)
  assert.equal(summary.fuelPricePerLiter, 60)
  assert.equal(summary.otherRub, 3000)
  assert.equal(summary.profitRub, 75000)
  assert.equal(summary.costPerKmRub, 18.75)
  assert.equal(summary.revenuePerKmRub, 65.63)
  assert.equal(summary.marginPercent, 71.4)
})

test("итог не делится на ноль километров и не врёт про маржу", () => {
  const summary = buildTripSummary({
    route: route({ totalDistance: 0 }),
    orders: [],
    expenses: [expense({ amount: 1000 })],
  })

  assert.equal(summary.distanceKm, 0)
  assert.equal(summary.costPerKmRub, null)
  assert.equal(summary.revenuePerKmRub, null)
  assert.equal(summary.marginPercent, null)
  assert.equal(summary.profitRub, -1000)
  assert.equal(summary.fuelPricePerLiter, null)
})

test("рейс без даты завершения: длительность не выдумывается", () => {
  const summary = buildTripSummary({
    route: route({ completedAt: null }),
    orders: [{ id: "o1", price: 10000 }],
  })

  assert.equal(summary.durationDays, null)
  assert.equal(summary.revenueRub, 10000)
})

test("расходы группируются по видам, дорогие сверху", () => {
  const groups = groupExpensesByType([
    expense({ id: "f1", amount: 10000, liters: 160 }),
    expense({ id: "f2", amount: 5000, liters: 80 }),
    expense({ id: "t1", type: "toll", amount: 2500 }),
    expense({ id: "r1", type: "repair", amount: 40000 }),
    expense({ id: "o1", type: "other", amount: 700 }),
  ])

  assert.deepEqual(
    groups.map((group) => group.type),
    ["repair", "fuel", "toll", "other"],
  )

  const fuel = groups.find((group) => group.type === "fuel")
  assert.equal(fuel.amount, 15000)
  assert.equal(fuel.liters, 240)
  assert.equal(fuel.count, 2)
  assert.equal(fuel.label, "Топливо")

  assert.equal(expenseTypeLabel("toll"), "Платные дороги")
  assert.equal(expenseTypeLabel(null), "Прочее")
  assert.equal(expenseTypeLabel("мойка"), "мойка")
})

test("хронология рейса идёт по времени и включает расходы, заказы и границы рейса", () => {
  const timeline = buildTripTimeline({
    route: route(),
    events: [
      {
        id: "e1",
        type: "status",
        status: "in_route",
        createdAt: new Date("2026-09-02T07:00:00"),
      },
    ],
    orders: [
      {
        id: "o1",
        status: "delivered",
        routeFrom: "Москва",
        routeTo: "Казань",
        cargoType: "Бытовая техника",
        price: 60000,
        createdAt: new Date("2026-09-01T09:00:00"),
        deliveredAt: new Date("2026-09-04T18:00:00"),
      },
    ],
    expenses: [
      expense({ id: "f1", amount: 18000, liters: 300, vendor: "Лукойл", spentAt: new Date("2026-09-03T12:00:00") }),
    ],
    orderStatusLabel: statusLabel,
  })

  const titles = timeline.map((entry) => entry.title)
  // заказ встаёт в хронологию моментом доставки, а не создания:
  // в истории рейса важно, когда груз довезли
  assert.deepEqual(titles, [
    "Рейс создан",
    "Рейс начат",
    "Статус: in_route",
    "Топливо",
    "Москва → Казань",
    "Рейс завершён",
  ])

  const expenseEntry = timeline.find((entry) => entry.kind === "expense")
  assert.equal(expenseEntry.amount, 18000)
  assert.match(expenseEntry.description, /Лукойл/)
  assert.match(expenseEntry.description, /300 л/)

  const orderEntry = timeline.find((entry) => entry.kind === "order")
  assert.equal(orderEntry.amount, 60000)
  assert.match(orderEntry.description, /Статус: delivered/)
})

test("событие без даты не ломает порядок хронологии", () => {
  const timeline = buildTripTimeline({
    route: route({ startedAt: null, completedAt: null }),
    events: [{ id: "e1", type: "note", message: "Позвонил диспетчеру", createdAt: null }],
  })

  // у события без даты время неизвестно — оно идёт первым, а не теряется
  assert.equal(timeline.length, 2)
  assert.equal(timeline[0].title, "Позвонил диспетчеру")
  assert.equal(timeline[1].title, "Рейс создан")
})

test("расход топлива на 100 км считается только по факту", () => {
  assert.equal(fuelConsumptionPer100Km({ liters: 300, distanceKm: 1200 }), 25)
  assert.equal(fuelConsumptionPer100Km({ liters: 0, distanceKm: 1200 }), null)
  assert.equal(fuelConsumptionPer100Km({ liters: 300, distanceKm: 0 }), null)
})
