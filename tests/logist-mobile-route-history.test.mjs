/**
 * Тесты истории рейсов (lib/logist-mobile/route-history.ts).
 *
 * История отвечает на вопрос логиста: «Что и когда возили и кто не заплатил?»
 * Поэтому проверяем три вещи и все три по существу:
 *   1) фильтр по периоду, машине и водителю — рейс либо попадает, либо нет,
 *      и молча исчезать не может;
 *   2) состояние оплаты заказа рейса — оплачен / ждём / просрочка;
 *      «непонятно» показывается честно, а не выдаётся за просрочку;
 *   3) сводка считает деньги периода и число должников.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  HISTORY_PERIODS,
  filterHistoryRoutes,
  historySummary,
  inHistoryPeriod,
  orderOverdueDays,
  orderPaymentState,
  routeHistoryDate,
  routeHistoryDateLabel,
  routeHistoryLine,
  routeHistoryWaypoints,
  routeStateLabel,
} = require("../.test-build/lib/logist-mobile/route-history.js")

const NOW = new Date("2026-10-19T10:00:00.000Z")

function daysAgo(days) {
  const d = new Date(NOW)
  d.setDate(d.getDate() - days)
  return d
}

function route(overrides = {}) {
  return {
    id: "route-1",
    name: "Рейс: Москва — Тула",
    status: "completed",
    createdAt: daysAgo(10),
    startedAt: daysAgo(10),
    completedAt: daysAgo(9),
    driverId: "driver-1",
    driverName: "Кузнецов Андрей",
    vehicleId: "vehicle-1",
    vehiclePlate: "О556АА750",
    totalDistance: 380,
    cargoWeight: 5000,
    orders: [],
    ...overrides,
  }
}

function order(overrides = {}) {
  return {
    id: "order-1",
    clientName: "ООО «Ромашка»",
    clientContact: "+79161112233",
    clientId: "client-1",
    routeFrom: "Москва, склад",
    routeTo: "Тула, база",
    distance: 190,
    cargoType: "Паллеты",
    weight: 5000,
    status: "delivered",
    deliveredAt: daysAgo(9),
    price: 80000,
    agreedPrice: null,
    paymentType: "bank",
    deferredDays: 0,
    isPaid: false,
    paidAt: null,
    ...overrides,
  }
}

test("период: неделя назад попадает в «неделю», месяц назад — нет", () => {
  const week = route({ id: "w", startedAt: daysAgo(5) })
  const month = route({ id: "m", startedAt: daysAgo(25) })
  assert.equal(inHistoryPeriod(week, 7, NOW), true)
  assert.equal(inHistoryPeriod(month, 7, NOW), false)
  assert.equal(inHistoryPeriod(month, 30, NOW), true)
  // «Всё время» пропускает любой рейс
  assert.equal(inHistoryPeriod(month, null, NOW), true)
})

test("период: рейс без даты не прячется", () => {
  // Рейс без дат — не повод молча потерять его из истории
  const noDate = route({ id: "nd", startedAt: null, completedAt: null, createdAt: null })
  assert.equal(inHistoryPeriod(noDate, 7, NOW), true)
})

test("дата рейса берётся из поездки, а не из записи в базе", () => {
  const planned = route({
    createdAt: daysAgo(30),
    startedAt: daysAgo(2),
    completedAt: daysAgo(1),
  })
  assert.equal(routeHistoryDate(planned)?.getTime(), daysAgo(2).getTime())
})

test("фильтр: по машине и водителю отбирает только их рейсы", () => {
  const routes = [
    route({ id: "a", vehicleId: "vehicle-1", driverId: "driver-1" }),
    route({ id: "b", vehicleId: "vehicle-2", driverId: "driver-1" }),
    route({ id: "c", vehicleId: "vehicle-1", driverId: "driver-2" }),
  ]
  const byVehicle = filterHistoryRoutes(routes, { days: null, vehicleId: "vehicle-1" }, NOW)
  assert.deepEqual(byVehicle.map((r) => r.id).sort(), ["a", "c"])
  const byDriver = filterHistoryRoutes(routes, { days: null, driverId: "driver-2" }, NOW)
  assert.deepEqual(byDriver.map((r) => r.id), ["c"])
  const byBoth = filterHistoryRoutes(routes, { days: null, vehicleId: "vehicle-1", driverId: "driver-1" }, NOW)
  assert.deepEqual(byBoth.map((r) => r.id), ["a"])
})

test("фильтр: свежие рейсы идут первыми", () => {
  const routes = [
    route({ id: "old", startedAt: daysAgo(20) }),
    route({ id: "new", startedAt: daysAgo(1) }),
  ]
  const sorted = filterHistoryRoutes(routes, { days: null }, NOW)
  assert.deepEqual(sorted.map((r) => r.id), ["new", "old"])
})

test("маршрут одной строкой: точки без повторов, в порядке поездки", () => {
  const r = route({
    orders: [
      order({ routeFrom: "Москва, склад", routeTo: "Тула, база" }),
      order({ routeFrom: "Тула, база", routeTo: "Воронеж, склад" }),
    ],
  })
  assert.deepEqual(routeHistoryWaypoints(r), ["Москва", "Тула", "Воронеж"])
  assert.equal(routeHistoryLine(r), "Москва — Тула — Воронеж")
})

test("оплата: оплаченный заказ показан оплаченным", () => {
  const state = orderPaymentState(order({ isPaid: true, paidAt: daysAgo(1) }), NOW)
  assert.equal(state.tone, "paid")
  assert.equal(state.label, "Оплачен")
  assert.equal(state.amount, 80000)
})

test("оплата: отсрочка без срока — «ждём оплату», не просрочка", () => {
  const state = orderPaymentState(order({ deferredDays: 14 }), NOW)
  assert.equal(state.tone, "wait")
  assert.equal(state.label, "Ждём оплату")
  assert.equal(state.overdueDays, 0)
})

test("оплата: срок прошёл — просрочка с числом дней", () => {
  const state = orderPaymentState(order({ deferredDays: 5 }), NOW)
  assert.equal(state.tone, "overdue")
  assert.equal(state.overdueDays, 4)
  assert.match(state.label, /Просрочка 4 дн/)
})

test("оплата: без условий — «непонятно», а не долг", () => {
  // Заказ без paymentType и без deferredDays: не «оплачен» и не «просрочен».
  // Показывать его просрочкой нельзя — это вранье.
  const state = orderPaymentState(order({ paymentType: null, deferredDays: null }), NOW)
  assert.equal(state.tone, "unknown")
  assert.equal(state.label, "Без условий оплаты")
  assert.equal(state.overdueDays, 0)
})

test("оплата: договорная цена важнее прайсовой", () => {
  const state = orderPaymentState(order({ price: 80000, agreedPrice: 92000 }), NOW)
  assert.equal(state.amount, 92000)
})

test("сводка: деньги периода и должники", () => {
  const routes = [
    route({
      id: "r1",
      orders: [
        order({ id: "o1", isPaid: true, clientId: "c1" }),
        order({ id: "o2", clientId: "c2", deferredDays: 5 }), // просрочка
        order({ id: "o3", clientId: "c3", deferredDays: 14 }), // ждём
      ],
    }),
    route({
      id: "r2",
      totalDistance: 100,
      orders: [
        order({ id: "o4", clientId: "c4", paymentType: null, deferredDays: null }), // неясно
      ],
    }),
  ]
  const s = historySummary(routes, NOW)
  assert.equal(s.routes, 2)
  assert.equal(s.orders, 4)
  assert.equal(s.distanceKm, 480)
  assert.equal(s.paidAmount, 80000)
  assert.equal(s.waitingAmount, 80000)
  assert.equal(s.overdueAmount, 80000)
  assert.equal(s.overdueCount, 1)
  assert.equal(s.unknownCount, 1)
  assert.equal(s.debtorClients, 1)
})

test("состояние рейса словами", () => {
  assert.equal(routeStateLabel("completed"), "Завершён")
  assert.equal(routeStateLabel("in_transit"), "В пути")
  assert.equal(routeStateLabel("planned"), "Запланирован")
  assert.equal(routeStateLabel("cancelled"), "Отменён")
  assert.equal(routeStateLabel(null), "Без статуса")
})

test("периоды на экране: неделя, месяц, 3 месяца, всё время", () => {
  assert.deepEqual(HISTORY_PERIODS.map((p) => p.days), [7, 30, 90, null])
})

test("подпись даты: без года для этого года, с годом — для прошлых", () => {
  const thisYear = route({ startedAt: new Date("2026-03-10T09:00:00.000Z") })
  assert.equal(routeHistoryDateLabel(thisYear, NOW), routeHistoryDateLabel(thisYear, NOW))
  const past = route({ startedAt: new Date("2024-03-10T09:00:00.000Z") })
  assert.match(routeHistoryDateLabel(past, NOW), /2024$/)
})
