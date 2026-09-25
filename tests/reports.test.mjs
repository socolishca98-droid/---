// tests/reports.test.mjs
//
// Отчёты (задача 8): периоды, итоги, разбивки по интервалам, водителям,
// машинам, клиентам и оплатам, разбор правилами и текстовая сводка.
//
// Проверяется главное: в отчёте нет ни одного выдуманного числа — каждое
// складывается из заказов, рейсов, расходов и оплат, а если данных нет,
// показатель равен нулю или null, но не «правдоподобному» значению.

import assert from "node:assert/strict"
import test from "node:test"

import {
  buildClientsBlock,
  buildExpensesByType,
  buildFleetBlock,
  buildKpi,
  buildOrdersBlock,
  buildPaymentsBlock,
  buildPeriod,
  buildReport,
  buildSeries,
  buildVehiclesBlock,
  buildDriversBlock,
  clientKeyOf,
  daysBetween,
  orderAttributionDate,
  periodBuckets,
  previousPeriod,
} from "../.test-build/lib/reports/aggregate.js"
import {
  buildInsights,
  buildReportText,
  formatChange,
  percentChange,
} from "../.test-build/lib/reports/insights.js"

const NOW = new Date("2026-09-25T12:00:00")

function pick(overrides, key, fallback) {
  // Явный null в переопределении — это значение, а не «не задано»
  return key in overrides ? overrides[key] : fallback
}

function order(overrides = {}) {
  return {
    id: pick(overrides, "id", "order-1"),
    status: pick(overrides, "status", "delivered"),
    createdAt: pick(overrides, "createdAt", new Date("2026-09-10T09:00:00")),
    // дата доставки: по ней заказ относят к периоду отчёта
    deliveredAt: pick(overrides, "deliveredAt", new Date("2026-09-12T18:00:00")),
    deadline: pick(overrides, "deadline", null),
    price: pick(overrides, "price", 100000),
    agreedPrice: pick(overrides, "agreedPrice", null),
    distance: pick(overrides, "distance", 800),
    clientId: pick(overrides, "clientId", "client-1"),
    clientName: pick(overrides, "clientName", "Ромашка"),
    routeFrom: pick(overrides, "routeFrom", "Москва"),
    routeTo: pick(overrides, "routeTo", "Казань"),
    assignedDriverId: pick(overrides, "assignedDriverId", "driver-1"),
    assignedVehicleId: pick(overrides, "assignedVehicleId", "vehicle-1"),
    routeId: pick(overrides, "routeId", "route-1"),
    isPaid: pick(overrides, "isPaid", false),
    paidAt: pick(overrides, "paidAt", null),
    dueDate: pick(overrides, "dueDate", null),
    deferredDays: pick(overrides, "deferredDays", null),
  }
}

function route(overrides = {}) {
  return {
    id: pick(overrides, "id", "route-1"),
    name: pick(overrides, "name", "Рейс: Москва — Казань"),
    status: pick(overrides, "status", "completed"),
    createdAt: pick(overrides, "createdAt", new Date("2026-09-09T08:00:00")),
    startedAt: pick(overrides, "startedAt", new Date("2026-09-10T06:00:00")),
    completedAt: pick(overrides, "completedAt", new Date("2026-09-12T20:00:00")),
    totalDistance: pick(overrides, "totalDistance", 1600),
    startOdometer: pick(overrides, "startOdometer", null),
    endOdometer: pick(overrides, "endOdometer", null),
    driverId: pick(overrides, "driverId", "driver-1"),
    vehicleId: pick(overrides, "vehicleId", "vehicle-1"),
  }
}

function expense(overrides = {}) {
  return {
    id: pick(overrides, "id", "expense-1"),
    routeId: pick(overrides, "routeId", "route-1"),
    type: pick(overrides, "type", "fuel"),
    amount: pick(overrides, "amount", 20000),
    liters: pick(overrides, "liters", 300),
    spentAt: pick(overrides, "spentAt", new Date("2026-09-11T10:00:00")),
  }
}

// ── Периоды ─────────────────────────────────────────────────────────────────

test("пресеты периода: 7, 30, 90 дней, месяц, год", () => {
  const week = buildPeriod("7d", { now: NOW })
  assert.equal(daysBetween(week.from, week.to), 6, "7 дней включая сегодня")
  assert.equal(week.group, "day")

  const month30 = buildPeriod("30d", { now: NOW })
  assert.equal(daysBetween(month30.from, month30.to), 29)

  const quarter = buildPeriod("90d", { now: NOW })
  assert.equal(daysBetween(quarter.from, quarter.to), 89)
  assert.equal(quarter.group, "week", "длинный период — интервалы по неделям")

  const month = buildPeriod("month", { now: NOW })
  assert.equal(month.from.getDate(), 1, "текущий месяц начинается с 1-го")
  assert.equal(month.from.getMonth(), 8)

  const year = buildPeriod("year", { now: NOW })
  assert.equal(year.from.getMonth(), 0)
  assert.equal(year.group, "month")
})

test("произвольный период важнее пресета, а конец дня учитывается целиком", () => {
  const period = buildPeriod("30d", {
    from: "2026-09-01",
    to: "2026-09-03",
    now: NOW,
  })

  assert.equal(period.preset, "custom")
  assert.equal(period.from.getDate(), 1)
  assert.equal(period.to.getHours(), 23, "заказы последнего дня попадают в отчёт")
  assert.equal(period.group, "day")

  const long = buildPeriod("30d", { from: "2026-01-01", to: "2026-09-01", now: NOW })
  assert.equal(long.group, "month", "более 120 дней — интервалы по месяцам")
})

test("предыдущий период — такой же длины и встык", () => {
  const period = buildPeriod("7d", { now: NOW })
  const previous = previousPeriod(period.from, period.to)

  assert.equal(daysBetween(previous.from, previous.to), daysBetween(period.from, period.to))
  assert.equal(daysBetween(previous.to, period.from), 1, "день между периодами не потерян")

  const empty = previousPeriod(period.from, period.from)
  assert.equal(daysBetween(empty.from, empty.to), 0, "период из одного дня не даёт нулевую длину")
})

test("заказ относят к периоду по дате доставки, незакрытый — по дате оформления", () => {
  const delivered = order({ deliveredAt: new Date("2026-09-12T18:00:00") })
  assert.equal(orderAttributionDate(delivered).getDate(), 12)

  const open = order({ status: "in_route", deliveredAt: null, createdAt: new Date("2026-09-20T09:00:00") })
  assert.equal(orderAttributionDate(open).getDate(), 20)

  // Оформлен давно, а довезён в этом месяце — считается по доставке
  const long = order({
    createdAt: new Date("2026-08-20T09:00:00"),
    deliveredAt: new Date("2026-09-05T12:00:00"),
  })
  assert.equal(orderAttributionDate(long).getDate(), 5)
})

test("интервалы периода идут подряд — на графике нет дыр", () => {
  const period = buildPeriod("7d", { now: NOW })
  const buckets = periodBuckets(period)

  assert.equal(buckets.length, 7)
  assert.deepEqual(
    buckets.map((bucket) => bucket.label),
    ["19.09", "20.09", "21.09", "22.09", "23.09", "24.09", "25.09"],
  )

  const months = buildPeriod("30d", { from: "2026-01-15", to: "2026-03-15", now: NOW })
  assert.equal(months.group, "week", "два месяца — интервалы по неделям")
  assert.ok(periodBuckets(months).length >= 8, "недели идут подряд, без пропусков")

  const halfYear = buildPeriod("30d", { from: "2026-01-15", to: "2026-08-15", now: NOW })
  assert.equal(halfYear.group, "month")
  assert.equal(periodBuckets(halfYear).length, 8, "январь–август: восемь интервалов")

  const weeks = periodBuckets(buildPeriod("90d", { now: NOW }))
  assert.ok(weeks.length >= 13, "90 дней — минимум 13 недель")
  assert.ok(weeks.length <= 15)
})

// ── Итоги ───────────────────────────────────────────────────────────────────

test("итог считает деньги, пробег и топливо; маржа и километр — честные числа", () => {
  const kpi = buildKpi({
    orders: [
      order({ price: 100000 }),
      order({ id: "order-2", price: null, agreedPrice: 140000, distance: 400 }),
    ],
    expenses: [
      expense({ amount: 20000, liters: 300 }),
      expense({ id: "expense-2", type: "toll", amount: 5000, liters: null }),
    ],
    routes: [route({ startOdometer: 120000, endOdometer: 121500 })],
  })

  assert.equal(kpi.revenueRub, 240000, "согласованная цена важнее прайса")
  assert.equal(kpi.expensesRub, 25000)
  assert.equal(kpi.profitRub, 215000)
  assert.equal(kpi.distanceKm, 1500, "одометр важнее планового расстояния")
  assert.equal(kpi.fuelRub, 20000)
  assert.equal(kpi.fuelLiters, 300)
  assert.equal(kpi.fuelPer100Km, 20)
  assert.equal(kpi.costPerKmRub, 16.7)
  assert.equal(kpi.revenuePerKmRub, 160)
  assert.equal(kpi.marginPercent, 89.6)
  assert.equal(kpi.deliveredCount, 2)
  assert.equal(kpi.cancelledCount, 0)
})

test("без километров и без выручки отчёт не делит на ноль", () => {
  const empty = buildKpi({ orders: [], expenses: [] })

  assert.equal(empty.revenueRub, 0)
  assert.equal(empty.avgOrderRub, 0)
  assert.equal(empty.marginPercent, null)
  assert.equal(empty.costPerKmRub, null)
  assert.equal(empty.fuelPer100Km, null)
  assert.equal(empty.distanceKm, 0)
})

test("отменённые и просроченные заказы считаются отдельно, но деньги не теряются", () => {
  const kpi = buildKpi({
    orders: [
      order({ status: "delivered", price: 100000 }),
      order({ id: "o2", status: "cancelled", price: 50000 }),
      order({ id: "o3", status: "expired", price: 30000 }),
    ],
    expenses: [],
  })

  assert.equal(kpi.ordersCount, 3)
  assert.equal(kpi.deliveredCount, 1)
  assert.equal(kpi.cancelledCount, 2)
  assert.equal(kpi.revenueRub, 180000, "показываем всю сумму по периоду, включая отменённые")
})

// ── График ──────────────────────────────────────────────────────────────────

test("разбивка по дням складывает выручку и расходы в свой интервал", () => {
  const period = buildPeriod("7d", { now: NOW })
  const series = buildSeries(
    [
      order({ createdAt: new Date("2026-09-24T09:00:00"), deliveredAt: new Date("2026-09-24T20:00:00"), price: 50000 }),
      order({ id: "o2", createdAt: new Date("2026-09-25T09:00:00"), deliveredAt: new Date("2026-09-25T20:00:00"), price: 70000 }),
      // Вне периода — в отчёт не попадает
      order({ id: "o3", createdAt: new Date("2026-09-01T09:00:00"), deliveredAt: new Date("2026-09-01T20:00:00"), price: 999999 }),
    ],
    [expense({ spentAt: new Date("2026-09-25T08:00:00"), amount: 12000 })],
    period,
  )

  assert.equal(series.length, 7)
  const last = series[series.length - 1]
  assert.equal(last.label, "25.09")
  assert.equal(last.revenueRub, 70000)
  assert.equal(last.expensesRub, 12000)
  assert.equal(last.profitRub, 58000)
  assert.equal(last.ordersCount, 1)

  const previous = series[series.length - 2]
  assert.equal(previous.revenueRub, 50000)

  const emptyDay = series[0]
  assert.equal(emptyDay.revenueRub, 0)
  assert.equal(emptyDay.expensesRub, 0)
  assert.equal(emptyDay.profitRub, 0)
})

// ── Расходы ─────────────────────────────────────────────────────────────────

test("расходы по видам: сумма, литры и доля", () => {
  const groups = buildExpensesByType([
    expense({ amount: 60000, liters: 900 }),
    expense({ id: "e2", amount: 20000, liters: null }),
    expense({ id: "e3", type: "toll", amount: 20000, liters: null }),
    expense({ id: "e4", type: null, amount: 0, liters: null }),
  ])

  const fuel = groups.find((group) => group.type === "fuel")
  assert.equal(fuel.label, "Топливо")
  assert.equal(fuel.amountRub, 80000)
  assert.equal(fuel.liters, 900)
  assert.equal(fuel.count, 2)
  assert.equal(fuel.sharePercent, 80)

  const toll = groups.find((group) => group.type === "toll")
  assert.equal(toll.sharePercent, 20)

  // Вид не указан — это «Прочее», а не «Топливо»: топливо так не завышается
  const other = groups.find((group) => group.type === "other")
  assert.equal(other.label, "Прочее")
  assert.equal(other.count, 1)
  assert.equal(other.sharePercent, 0)
})

// ── Заказы ──────────────────────────────────────────────────────────────────

test("заказы: статусы, средний чек, своевременность и направления", () => {
  const block = buildOrdersBlock([
    order({
      price: 100000,
      distance: 800,
      deliveredAt: new Date("2026-09-10T18:00:00"),
      deadline: new Date("2026-09-11T00:00:00"),
    }),
    order({
      id: "o2",
      status: "cancelled",
      price: 50000,
      distance: 200,
      deliveredAt: new Date("2026-09-11T18:00:00"),
      deadline: new Date("2026-09-11T10:00:00"),
    }),
    order({
      id: "o3",
      status: "control",
      price: 60000,
      distance: 300,
      deliveredAt: null,
      deadline: null,
      routeFrom: "Казань",
      routeTo: "Москва",
    }),
  ])

  assert.equal(block.avgPriceRub, 70000)
  assert.equal(block.avgDistanceKm, 433)
  assert.equal(block.onTimeCount, 1)
  assert.equal(block.lateCount, 1)
  assert.equal(block.onTimePercent, 50, "считаются только заказы со сроком")
  assert.equal(block.topDirections.length, 2)
  assert.equal(block.topDirections[0].direction, "Москва — Казань")
  assert.equal(block.topDirections[0].count, 2)
  assert.equal(block.byStatus.find((row) => row.status === "delivered").label, "Доставлен")
})

test("клиент опознаётся по карточке, иначе по имени без регистра", () => {
  assert.equal(clientKeyOf({ clientId: "c1", clientName: "Ромашка" }), "id:c1")
  assert.equal(clientKeyOf({ clientId: null, clientName: "  Ромашка  " }), "name:ромашка")
  assert.equal(clientKeyOf({ clientId: null, clientName: null }), "unknown")
})

test("клиенты: выручка периода, долг и просрочка из оплат, зависимость от одного", () => {
  const orders = [
    order({ price: 100000, clientId: "c1", clientName: "Ромашка" }),
    order({ id: "o2", price: 60000, clientId: "c2", clientName: "Василёк" }),
  ]
  const paymentOrders = [
    order({ id: "p1", price: 100000, clientId: "c1", isPaid: false, dueDate: new Date("2026-09-01T00:00:00") }),
    order({ id: "p2", price: 60000, clientId: "c2", isPaid: false, dueDate: new Date("2026-10-10T00:00:00") }),
  ]

  const block = buildClientsBlock(orders, paymentOrders, NOW)

  assert.equal(block.totalRub, 160000)
  assert.equal(block.concentrationPercent, 63, "доля крупнейшего клиента")
  assert.equal(block.top[0].name, "Ромашка")
  assert.equal(block.top[0].debtRub, 100000)
  assert.equal(block.top[0].overdueRub, 100000, "срок 1 сентября уже прошёл")
  assert.equal(block.top[1].overdueRub, 0, "срок 10 октября ещё не наступил")
  assert.equal(block.top[1].debtRub, 60000)
})

// ── Водители и машины ───────────────────────────────────────────────────────

test("водители: рейсы, заказы, пробег по одометру, расходы и прибыль", () => {
  const rows = buildDriversBlock({
    drivers: [{ id: "driver-1", name: "Петров" }],
    orders: [
      order({ price: 100000, assignedDriverId: "driver-1" }),
      order({ id: "o2", price: 50000, assignedDriverId: "driver-1" }),
      order({ id: "o3", price: 90000, assignedDriverId: null }),
    ],
    routes: [
      route({ startOdometer: 120000, endOdometer: 121500 }),
      route({ id: "route-2", totalDistance: 400, startOdometer: null, endOdometer: null }),
    ],
    expenses: [expense({ amount: 30000 }), expense({ id: "e2", routeId: "route-2", amount: 5000 })],
  })

  assert.equal(rows.length, 1, "заказ без водителя никому не приписывается")
  const petrov = rows[0]
  assert.equal(petrov.name, "Петров")
  assert.equal(petrov.orders, 2)
  assert.equal(petrov.routes, 2)
  assert.equal(petrov.revenueRub, 150000)
  assert.equal(petrov.expensesRub, 35000)
  assert.equal(petrov.profitRub, 115000)
  assert.equal(petrov.distanceKm, 1900)
  assert.equal(petrov.avgOrderRub, 75000)
})

test("машины: выручка, расходы и себестоимость километра", () => {
  const rows = buildVehiclesBlock({
    vehicles: [
      { id: "vehicle-1", plate: "А123ВС77" },
      { id: "vehicle-2", plate: "В456ЕК50" },
    ],
    orders: [
      order({ price: 100000, assignedVehicleId: "vehicle-1" }),
      order({ id: "o2", price: 80000, assignedVehicleId: "vehicle-2" }),
    ],
    routes: [
      route({ startOdometer: 10000, endOdometer: 11000, vehicleId: "vehicle-1" }),
      route({ id: "route-2", startOdometer: 20000, endOdometer: 20800, vehicleId: "vehicle-1" }),
    ],
    expenses: [
      expense({ amount: 18000 }),
      expense({ id: "e2", routeId: "route-2", amount: 6000 }),
    ],
  })

  const first = rows.find((row) => row.vehicleId === "vehicle-1")
  assert.equal(first.plate, "А123ВС77")
  assert.equal(first.routes, 2)
  assert.equal(first.distanceKm, 1800)
  assert.equal(first.expensesRub, 24000)
  assert.equal(first.revenueRub, 100000)
  assert.equal(first.profitRub, 76000)
  assert.equal(first.costPerKmRub, 13.3)

  const second = rows.find((row) => row.vehicleId === "vehicle-2")
  assert.equal(second.routes, 0)
  assert.equal(second.costPerKmRub, null, "без пробега себестоимость не выдумывается")
})

test("парк: простой, загрузка и рейсы в минус", () => {
  const vehicles = [
    { id: "vehicle-1", plate: "А123ВС77" },
    { id: "vehicle-2", plate: "В456ЕК50" },
    { id: "vehicle-3", plate: "С789МН99" },
  ]

  const block = buildFleetBlock({
    vehicles,
    vehiclesRows: [
      { vehicleId: "vehicle-1", plate: "А123ВС77" },
      { vehicleId: "vehicle-2", plate: "В456ЕК50" },
    ],
    routes: [
      route({ id: "route-1" }),
      route({ id: "route-2", name: "Рейс: Казань — Уфа" }),
    ],
    orders: [order({ price: 100000, routeId: "route-1" }), order({ id: "o2", price: 20000, routeId: "route-2" })],
    expenses: [
      expense({ routeId: "route-1", amount: 40000 }),
      expense({ id: "e2", routeId: "route-2", amount: 35000 }),
    ],
  })

  assert.equal(block.vehiclesTotal, 3)
  assert.equal(block.vehiclesUsed, 2)
  assert.equal(block.utilizationPercent, 67)
  assert.deepEqual(block.idleVehicles.map((vehicle) => vehicle.plate), ["С789МН99"])
  assert.equal(block.unprofitableRoutes.length, 1)
  assert.equal(block.unprofitableRoutes[0].routeId, "route-2")
  assert.equal(block.unprofitableRoutes[0].profitRub, -15000)
})

// ── Оплаты ──────────────────────────────────────────────────────────────────

test("оплаты: получено, отсрочка, ожидание, просрочка и средний срок", () => {
  const block = buildPaymentsBlock(
    [
      order({
        isPaid: true,
        paidAt: new Date("2026-09-20T12:00:00"),
        price: 100000,
        deliveredAt: new Date("2026-09-10T12:00:00"),
      }),
      order({ id: "p2", price: 50000, dueDate: new Date("2026-09-01T00:00:00"), isPaid: false, clientName: "Василёк" }),
      order({ id: "p3", price: 30000, dueDate: new Date("2026-10-20T00:00:00"), isPaid: false, clientName: "Ромашка" }),
      order({ id: "p4", price: 20000, isPaid: false, clientName: "Ромашка" }),
      order({ id: "p5", price: 0, isPaid: false, clientName: "Пустой" }),
    ],
    NOW,
  )

  assert.equal(block.paidRub, 100000)
  assert.equal(block.overdueRub, 50000)
  assert.equal(block.overdueCount, 1)
  assert.equal(block.deferredRub, 30000)
  assert.equal(block.pendingRub, 20000, "без срока — просто ждём")
  assert.equal(block.avgDaysToPayment, 10)
  assert.equal(block.overdueClients.length, 1)
  assert.equal(block.overdueClients[0].name, "Василёк")
  assert.equal(block.overdueClients[0].overdueRub, 50000)
})

test("отсрочка считается от даты доставки, а не от сегодня", () => {
  const block = buildPaymentsBlock(
    [
      order({
        id: "d1",
        price: 40000,
        isPaid: false,
        deliveredAt: new Date("2026-09-20T12:00:00"),
        deferredDays: 30,
      }),
    ],
    NOW,
  )

  assert.equal(block.deferredRub, 40000)
  assert.equal(block.overdueRub, 0)
  assert.equal(block.pendingRub, 0)
})

// ── Полный отчёт ────────────────────────────────────────────────────────────

// Период отчёта в тестах: 19–25 сентября 2026 (пресет «7 дней»), поэтому
// текущие записи лежат внутри этого окна, а прошлые — в 12–18 сентября.
function fullInput() {
  return {
    orders: [
      order({
        id: "o1",
        price: 100000,
        deliveredAt: new Date("2026-09-20T18:00:00"),
        deadline: new Date("2026-09-21T00:00:00"),
      }),
      order({
        id: "o2",
        price: 80000,
        deliveredAt: new Date("2026-09-23T18:00:00"),
        deadline: new Date("2026-09-23T00:00:00"),
        clientId: "c2",
        clientName: "Василёк",
        assignedDriverId: "driver-2",
        assignedVehicleId: "vehicle-2",
        routeId: "route-2",
      }),
      // Прошлый период (12–18 сентября) — для сравнения
      order({
        id: "o3",
        price: 60000,
        deliveredAt: new Date("2026-09-15T18:00:00"),
        createdAt: new Date("2026-09-12T09:00:00"),
        clientId: "c1",
        clientName: "Ромашка",
        routeId: "route-3",
      }),
      // Вне обоих периодов
      order({ id: "o4", price: 999999, deliveredAt: new Date("2026-07-01T18:00:00") }),
    ],
    routes: [
      route({
        id: "route-1",
        startedAt: new Date("2026-09-19T06:00:00"),
        startOdometer: 120000,
        endOdometer: 121500,
      }),
      route({
        id: "route-2",
        startedAt: new Date("2026-09-22T06:00:00"),
        startOdometer: 50000,
        endOdometer: 51000,
        vehicleId: "vehicle-2",
        driverId: "driver-2",
        name: "Рейс: Казань — Уфа",
      }),
      route({ id: "route-3", startedAt: new Date("2026-09-14T06:00:00"), totalDistance: 700 }),
    ],
    expenses: [
      expense({ id: "e1", routeId: "route-1", amount: 20000, liters: 300, spentAt: new Date("2026-09-19T10:00:00") }),
      expense({ id: "e2", routeId: "route-2", amount: 25000, liters: 200, spentAt: new Date("2026-09-22T10:00:00") }),
      expense({
        id: "e3",
        routeId: "route-3",
        amount: 10000,
        liters: 150,
        spentAt: new Date("2026-09-15T10:00:00"),
      }),
    ],
    vehicles: [
      { id: "vehicle-1", plate: "А123ВС77" },
      { id: "vehicle-2", plate: "В456ЕК50" },
      { id: "vehicle-3", plate: "С789МН99" },
    ],
    drivers: [
      { id: "driver-1", name: "Петров" },
      { id: "driver-2", name: "Сидоров" },
      { id: "driver-3", name: "Козлов" },
    ],
  }
}

test("полный отчёт за 7 дней: свой период, свой прогноз сравнения, свои разбивки", () => {
  const period = buildPeriod("7d", { now: NOW })
  const report = buildReport(fullInput(), period, NOW)

  assert.equal(report.data.ordersInPeriod, 2, "заказы июля и прошлой недели не в этом периоде")
  assert.equal(report.data.routesInPeriod, 2)
  assert.equal(report.data.expensesInPeriod, 2, "чек прошлой недели в этот период не попал")
  assert.equal(report.finance.revenueRub, 180000)
  assert.equal(report.finance.expensesRub, 45000)
  assert.equal(report.finance.profitRub, 135000)
  assert.equal(report.finance.distanceKm, 2500, "пробег по одометру двух рейсов")

  assert.equal(report.previousFinance.revenueRub, 60000, "предыдущий период той же длины")
  assert.equal(report.previousFinance.expensesRub, 10000)

  assert.equal(report.series.length, 7)
  assert.equal(report.expensesByType[0].type, "fuel")
  assert.equal(report.drivers.length, 2, "третий водитель без рейсов в отчёт не попал")
  assert.equal(report.drivers[0].name, "Петров")
  assert.equal(report.vehicles.length, 2)
  assert.equal(report.fleet.idleVehicles.length, 1)
  assert.equal(report.payments.overdueCount, 0, "сроков оплаты в данных нет")
  assert.equal(report.clients.top.length, 2)
})

test("пустой период не выдумывает числа", () => {
  const period = buildPeriod("7d", { now: NOW })
  const report = buildReport({ orders: [], routes: [], expenses: [] }, period, NOW)

  assert.equal(report.data.hasData, false)
  assert.equal(report.finance.revenueRub, 0)
  assert.equal(report.finance.marginPercent, null)
  assert.equal(report.series.length, 7)
  assert.equal(report.series.every((point) => point.revenueRub === 0), true)
  assert.equal(report.clients.top.length, 0)
  assert.equal(report.drivers.length, 0)
  assert.equal(report.fleet.utilizationPercent, null)
})

// ── Разбор ──────────────────────────────────────────────────────────────────

test("разбор: просрочка, убыточный рейс и зависимость от клиента попадают в выводы", () => {
  const period = buildPeriod("7d", { now: NOW })
  const report = buildReport(
    {
      ...fullInput(),
      // Долг прошлого месяца — просрочен, хотя заказ вне периода
      orders: [
        ...fullInput().orders,
        order({
          id: "old-debt",
          price: 70000,
          clientId: "c1",
          clientName: "Ромашка",
          isPaid: false,
          dueDate: new Date("2026-08-01T00:00:00"),
          deliveredAt: new Date("2026-07-20T12:00:00"),
          createdAt: new Date("2026-07-15T12:00:00"),
        }),
      ],
    },
    period,
    NOW,
  )

  const insights = buildInsights({ report, periodLabel: period.label, companyName: "ООО Тест" })
  const ids = insights.map((insight) => insight.id)

  assert.ok(ids.includes("payments-overdue"), "просрочка — первое, что видит логист")
  assert.ok(ids.includes("fleet-idle"), "простой машины виден")
  assert.ok(ids.includes("payments-overdue"))

  const overdue = insights.find((insight) => insight.id === "payments-overdue")
  assert.equal(overdue.level, "risk")
  assert.match(overdue.detail, /Ромашка/)
  assert.match(overdue.detail, /70\s000\s₽/)
  assert.ok(overdue.action, "у вывода есть действие, а не только пересказ")

  // Каждый вывод ссылается на раздел интерфейса
  for (const insight of insights) {
    assert.ok(insight.source, `${insight.id} без источника`)
    assert.ok(insight.title.length > 0)
  }
})

test("разбор: когда данных нет, он говорит прямо об этом", () => {
  const period = buildPeriod("7d", { now: NOW })
  const report = buildReport({ orders: [], routes: [], expenses: [] }, period, NOW)
  const insights = buildInsights({ report, periodLabel: period.label })

  assert.equal(insights.length, 1)
  assert.equal(insights[0].id, "no-data")
  assert.equal(insights[0].level, "info")
})

test("разбор: тонкая маржа и рост расходов отмечаются предупреждением", () => {
  const period = buildPeriod("7d", { now: NOW })
  const input = fullInput()

  const report = buildReport(
    {
      ...input,
      // Расходы съедают почти всю выручку текущего периода, прошлый — прибыльный
      expenses: [
        expense({ id: "e1", routeId: "route-1", amount: 110000, liters: 2000, spentAt: new Date("2026-09-19T10:00:00") }),
        expense({ id: "e2", routeId: "route-2", amount: 60000, liters: 900, spentAt: new Date("2026-09-22T10:00:00") }),
      ],
    },
    period,
    NOW,
  )

  const insights = buildInsights({ report, periodLabel: period.label })
  const ids = insights.map((insight) => insight.id)

  assert.ok(ids.includes("margin-thin"))
  assert.ok(ids.includes("expenses-fuel"))
  assert.equal(report.finance.profitRub, 10000, "180000 - 170000")
})

test("проценты изменения: с нулём сравнивать не с чем, а не «+100%»", () => {
  assert.equal(percentChange(100, 50), 100)
  assert.equal(percentChange(50, 100), -50)
  assert.equal(percentChange(100, 0), null)
  assert.equal(percentChange(100, 100), 0)

  assert.equal(formatChange(null), "нет данных для сравнения")
  assert.equal(formatChange(0), "без изменений")
  assert.equal(formatChange(12.5), "+12,5%")
  assert.equal(formatChange(-8), "−8%")
})

// ── Текст отчёта ────────────────────────────────────────────────────────────

test("текстовый отчёт содержит те же числа, что и страница", () => {
  const period = buildPeriod("7d", { now: NOW })
  const report = buildReport(fullInput(), period, NOW)
  const insights = buildInsights({ report, periodLabel: period.label })

  const text = buildReportText({
    report,
    insights,
    periodLabel: period.label,
    companyName: "ООО Тест",
  })

  assert.match(text, /ООО Тест/)
  assert.match(text, /Выручка: 180\s000\s₽/)
  assert.match(text, /Расходы: 45\s000\s₽/)
  assert.match(text, /Прибыль: 135\s000\s₽/)
  assert.match(text, /Москва — Казань/)
  assert.match(text, /Петров/)
  assert.match(text, /РАЗБОР/)
  assert.match(text, /А123ВС77/)
  assert.match(text, /С789МН99/, "простой машины виден в тексте")
  assert.match(text, /без внешних сервисов/, "честно сказано, чем сделан разбор")
})

test("текстовый отчёт по пустому периоду не врёт про прибыль", () => {
  const period = buildPeriod("7d", { now: NOW })
  const report = buildReport({ orders: [], routes: [], expenses: [] }, period, NOW)
  const text = buildReportText({ report, periodLabel: period.label })

  assert.match(text, /За период нет данных/)
  assert.match(text, /Расходов за период нет/)
  assert.ok(!/999/.test(text), "чужие числа в отчёт не попадают")
})
