// lib/reports/aggregate.ts
//
// Отчёты (задача 8): настоящие агрегаты из базы, без выдуманных чисел.
//
// Модуль чистый — ни Prisma, ни Next: ему на вход отдают уже загруженные
// записи, он считает показатели. Поэтому одни и те же вычисления используют
// и API (app/api/reports), и тесты (без базы).
//
// Как заказ попадает в период: по дате завершения, а незавершённый — по дате
// оформления. Так «выручка за месяц» — это деньги за рейсы, довезённые в этом
// месяце, а не за то, что случайно оформили. Расход — по дате чека, рейс — по
// дате выезда (startedAt), иначе по дате создания.
//
// Все суммы — рубли (в базе Int), проценты — целые или с одним знаком.

import { normalizeOrderStatus, orderStatusLabel } from "../orders/stages"
import { overdueDaysFor, paymentDueDate } from "../payments/summary"
import { EXPENSE_TYPE_LABELS, orderAmount } from "../trips/history"

export type ReportPreset = "7d" | "30d" | "90d" | "year" | "month" | "custom"
export type ReportGroup = "day" | "week" | "month"

export type ReportOrder = {
  id: string
  status: string
  createdAt: Date
  completedAt?: Date | null
  deadline?: Date | null
  dueDate?: Date | null
  deferredDays?: number | null
  paidAt?: Date | null
  isPaid?: boolean | null
  price?: number | null
  agreedPrice?: number | null
  distance?: number | null
  weight?: number | null
  cargoType?: string | null
  routeFrom?: string | null
  routeTo?: string | null
  clientId?: string | null
  clientName?: string | null
  assignedDriverId?: string | null
  assignedVehicleId?: string | null
  routeId?: string | null
}

export type ReportRoute = {
  id: string
  name?: string | null
  status: string
  createdAt: Date
  startedAt?: Date | null
  completedAt?: Date | null
  totalDistance?: number | null
  startOdometer?: number | null
  endOdometer?: number | null
  driverId?: string | null
  vehicleId?: string | null
}

export type ReportExpense = {
  id: string
  routeId: string
  type?: string | null
  amount: number
  liters?: number | null
  spentAt: Date
}

export type ReportVehicle = {
  id: string
  plate?: string | null
  brand?: string | null
  model?: string | null
  status?: string | null
}

export type ReportDriver = {
  id: string
  name?: string | null
  status?: string | null
}

export type ReportInput = {
  orders: ReportOrder[]
  routes: ReportRoute[]
  expenses: ReportExpense[]
  vehicles?: ReportVehicle[]
  drivers?: ReportDriver[]
  /** Все заказы без ограничения периода — для блока оплат (долги живут дольше отчёта) */
  paymentOrders?: ReportOrder[]
}

export type ReportPeriod = {
  preset: ReportPreset
  from: Date
  to: Date
  group: ReportGroup
  label: string
}

export type ReportKpi = {
  revenueRub: number
  expensesRub: number
  profitRub: number
  marginPercent: number | null
  ordersCount: number
  deliveredCount: number
  cancelledCount: number
  avgOrderRub: number
  distanceKm: number
  revenuePerKmRub: number | null
  costPerKmRub: number | null
  fuelRub: number
  fuelLiters: number
  fuelPer100Km: number | null
}

export type ReportSeriesPoint = {
  key: string
  label: string
  revenueRub: number
  expensesRub: number
  profitRub: number
  ordersCount: number
}

export type ReportInsightLevel = "risk" | "warn" | "ok" | "info"

export type ReportResult = {
  period: ReportPeriod
  previous: { from: Date; to: Date }
  finance: ReportKpi
  previousFinance: ReportKpi
  series: ReportSeriesPoint[]
  expensesByType: Array<{
    type: string
    label: string
    amountRub: number
    liters: number
    count: number
    sharePercent: number | null
  }>
  orders: {
    byStatus: Array<{ status: string; label: string; count: number; revenueRub: number }>
    avgPriceRub: number
    avgDistanceKm: number
    onTimeCount: number
    lateCount: number
    onTimePercent: number | null
    topDirections: Array<{ direction: string; count: number; revenueRub: number; distanceKm: number }>
  }
  clients: {
    totalRub: number
    concentrationPercent: number | null
    top: Array<{
      key: string
      clientId: string | null
      name: string
      orders: number
      revenueRub: number
      debtRub: number
      overdueRub: number
    }>
  }
  drivers: Array<{
    driverId: string
    name: string
    routes: number
    orders: number
    revenueRub: number
    distanceKm: number
    expensesRub: number
    profitRub: number
    avgOrderRub: number
    onTimePercent: number | null
  }>
  vehicles: Array<{
    vehicleId: string
    plate: string
    routes: number
    orders: number
    distanceKm: number
    revenueRub: number
    expensesRub: number
    profitRub: number
    costPerKmRub: number | null
  }>
  fleet: {
    vehiclesTotal: number
    vehiclesUsed: number
    utilizationPercent: number | null
    idleVehicles: Array<{ vehicleId: string; plate: string }>
    unprofitableRoutes: Array<{
      routeId: string
      name: string
      revenueRub: number
      expensesRub: number
      profitRub: number
    }>
  }
  payments: {
    paidRub: number
    pendingRub: number
    overdueRub: number
    overdueCount: number
    deferredRub: number
    avgDaysToPayment: number | null
    overdueClients: Array<{ name: string; debtRub: number; overdueRub: number; orders: number }>
  }
  data: {
    ordersInPeriod: number
    routesInPeriod: number
    expensesInPeriod: number
    hasData: boolean
  }
}

const MS_DAY = 24 * 60 * 60 * 1000

/** Названия месяцев в отчётах — коротко и по-русски. */
const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
]

export function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(23, 59, 59, 999)
  return copy
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_DAY)
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date)
  copy.setMonth(copy.getMonth() + months)
  return copy
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_DAY)
}

/** Период отчёта: пресеты плюс произвольные даты. */
export function buildPeriod(
  preset: ReportPreset = "30d",
  options: { from?: string | Date | null; to?: string | Date | null; now?: Date } = {},
): ReportPeriod {
  const now = options.now ?? new Date()
  const to = options.to ? endOfDay(new Date(options.to)) : endOfDay(now)

  // Начало периода — всегда начало суток: иначе пресет «7 дней» терял бы
  // первую половину первого дня (её отсекал бы конец суток, взятый за границу)
  const custom = (from: Date, label: string, group: ReportGroup): ReportPeriod => ({
    preset: "custom",
    from: startOfDay(from),
    to,
    group,
    label,
  })

  if (options.from) {
    const from = startOfDay(new Date(options.from))
    const span = Math.max(0, daysBetween(from, to))
    const group: ReportGroup = span <= 31 ? "day" : span <= 120 ? "week" : "month"
    return {
      preset: "custom",
      from: from > to ? startOfDay(to) : from,
      to,
      group,
      label: "Выбранный период",
    }
  }

  switch (preset) {
    case "7d":
      return custom(addDays(to, -6), "Последние 7 дней", "day")
    case "90d":
      return custom(addDays(to, -89), "Последние 90 дней", "week")
    case "month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      return custom(first, "Текущий месяц", "day")
    }
    case "year": {
      const first = new Date(now.getFullYear(), 0, 1)
      return custom(first, "Текущий год", "month")
    }
    case "30d":
    default:
      return custom(addDays(to, -29), "Последние 30 дней", "day")
  }
}

/** Предыдущий период той же длины — с чем сравнивать. */
export function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const days = Math.max(1, daysBetween(from, to) + 1)
  const previousTo = endOfDay(addDays(from, -1))
  return { from: startOfDay(addDays(previousTo, -(days - 1))), to: previousTo }
}

function inRange(date: Date | null | undefined, from: Date, to: Date): boolean {
  if (!date) return false
  const time = date.getTime()
  return time >= from.getTime() && time <= to.getTime()
}

/** Дата, по которой заказ относят к периоду. */
export function orderAttributionDate(order: ReportOrder): Date {
  return order.completedAt ?? order.createdAt
}

function routeAttributionDate(route: ReportRoute): Date {
  return route.startedAt ?? route.createdAt
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function ratio(numerator: number, denominator: number, digits = 0): number | null {
  if (!denominator) return null
  return round((numerator / denominator) * 100, digits)
}

function bucketKey(date: Date, group: ReportGroup): string {
  if (group === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
  }

  if (group === "week") {
    // Неделя начинается с понедельника
    const day = date.getDay() === 0 ? 7 : date.getDay()
    const monday = startOfDay(addDays(date, -(day - 1)))
    return monday.toISOString().slice(0, 10)
  }

  return startOfDay(date).toISOString().slice(0, 10)
}

function bucketLabel(key: string, group: ReportGroup): string {
  if (group === "month") {
    const [year, month] = key.split("-")
    return `${MONTHS_SHORT[Number(month) - 1]} ${year.slice(2)}`
  }

  const [, month, day] = key.split("-")
  return `${day}.${month}`
}

/** Все интервалы периода подряд — чтобы на графике не было дыр. */
export function periodBuckets(period: ReportPeriod): Array<{ key: string; label: string }> {
  const buckets: Array<{ key: string; label: string }> = []
  const seen = new Set<string>()

  let cursor = new Date(period.from)

  if (period.group === "month") {
    cursor = new Date(period.from.getFullYear(), period.from.getMonth(), 1)
  }

  while (cursor.getTime() <= period.to.getTime()) {
    const key = bucketKey(cursor, period.group)
    if (!seen.has(key)) {
      seen.add(key)
      buckets.push({ key, label: bucketLabel(key, period.group) })
    }
    cursor =
      period.group === "month"
        ? addMonths(cursor, 1)
        : addDays(cursor, period.group === "week" ? 7 : 1)
  }

  return buckets
}

/** Итоговые показатели по набору заказов/расходов. */
export function buildKpi(params: {
  orders: ReportOrder[]
  expenses: ReportExpense[]
  routes?: ReportRoute[]
}): ReportKpi {
  const { orders, expenses, routes = [] } = params

  const revenueRub = orders.reduce((sum, order) => sum + orderAmount(order), 0)
  const expensesRub = expenses.reduce((sum, expense) => sum + expense.amount, 0)

  const fuel = expenses.filter((expense) => (expense.type ?? "other") === "fuel")
  const fuelRub = fuel.reduce((sum, expense) => sum + expense.amount, 0)
  const fuelLiters = fuel.reduce((sum, expense) => sum + (expense.liters ?? 0), 0)

  // Пробег: одометр рейса важнее планового расстояния заказов
  const odometerDistance = routes.reduce((sum, route) => {
    if (typeof route.startOdometer === "number" && typeof route.endOdometer === "number") {
      return sum + Math.max(0, route.endOdometer - route.startOdometer)
    }
    return sum + (route.totalDistance ?? 0)
  }, 0)
  const plannedDistance = orders.reduce((sum, order) => sum + (order.distance ?? 0), 0)
  const distanceKm = odometerDistance > 0 ? odometerDistance : plannedDistance

  const delivered = orders.filter((order) => normalizeOrderStatus(order.status) === "delivered")
  const cancelled = orders.filter((order) =>
    ["cancelled", "rejected", "expired"].includes(normalizeOrderStatus(order.status) ?? ""),
  )

  return {
    revenueRub,
    expensesRub,
    profitRub: revenueRub - expensesRub,
    marginPercent: ratio(revenueRub - expensesRub, revenueRub, 1),
    ordersCount: orders.length,
    deliveredCount: delivered.length,
    cancelledCount: cancelled.length,
    avgOrderRub: orders.length ? Math.round(revenueRub / orders.length) : 0,
    distanceKm,
    revenuePerKmRub: distanceKm ? round(revenueRub / distanceKm, 1) : null,
    costPerKmRub: distanceKm ? round(expensesRub / distanceKm, 1) : null,
    fuelRub,
    fuelLiters: round(fuelLiters, 1),
    fuelPer100Km: distanceKm ? round((fuelLiters / distanceKm) * 100, 1) : null,
  }
}

/** Показатели по интервалам периода: выручка, расход, прибыль, число заказов. */
export function buildSeries(
  orders: ReportOrder[],
  expenses: ReportExpense[],
  period: ReportPeriod,
): ReportSeriesPoint[] {
  const buckets = periodBuckets(period)
  const points = new Map<string, ReportSeriesPoint>()

  for (const bucket of buckets) {
    points.set(bucket.key, {
      key: bucket.key,
      label: bucket.label,
      revenueRub: 0,
      expensesRub: 0,
      profitRub: 0,
      ordersCount: 0,
    })
  }

  for (const order of orders) {
    const point = points.get(bucketKey(orderAttributionDate(order), period.group))
    if (!point) continue
    point.revenueRub += orderAmount(order)
    point.ordersCount += 1
  }

  for (const expense of expenses) {
    const point = points.get(bucketKey(expense.spentAt, period.group))
    if (!point) continue
    point.expensesRub += expense.amount
  }

  for (const point of points.values()) {
    point.profitRub = point.revenueRub - point.expensesRub
  }

  return Array.from(points.values())
}

/** Расходы по видам с долей в общей сумме. */
export function buildExpensesByType(expenses: ReportExpense[]): ReportResult["expensesByType"] {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const groups = new Map<string, { amountRub: number; liters: number; count: number }>()

  for (const expense of expenses) {
    const type = expense.type ?? "other"
    const group = groups.get(type) ?? { amountRub: 0, liters: 0, count: 0 }
    group.amountRub += expense.amount
    group.liters += expense.liters ?? 0
    group.count += 1
    groups.set(type, group)
  }

  return Array.from(groups.entries())
    .map(([type, group]) => ({
      type,
      label: EXPENSE_TYPE_LABELS[type] ?? type,
      amountRub: group.amountRub,
      liters: round(group.liters, 1),
      count: group.count,
      sharePercent: ratio(group.amountRub, total, 1),
    }))
    .sort((a, b) => b.amountRub - a.amountRub)
}

/** Заказы периода: статусы, средний чек, своевременность, топ направлений. */
export function buildOrdersBlock(orders: ReportOrder[]): ReportResult["orders"] {
  const byStatus = new Map<string, { count: number; revenueRub: number }>()

  for (const order of orders) {
    const status = normalizeOrderStatus(order.status) ?? order.status
    const group = byStatus.get(status) ?? { count: 0, revenueRub: 0 }
    group.count += 1
    group.revenueRub += orderAmount(order)
    byStatus.set(status, group)
  }

  const withDeadline = orders.filter((order) => order.completedAt && order.deadline)
  const onTimeCount = withDeadline.filter(
    (order) => (order.completedAt as Date).getTime() <= (order.deadline as Date).getTime(),
  ).length
  const lateCount = withDeadline.length - onTimeCount

  const directions = new Map<string, { count: number; revenueRub: number; distanceKm: number }>()
  for (const order of orders) {
    if (!order.routeFrom || !order.routeTo) continue
    const direction = `${order.routeFrom} — ${order.routeTo}`
    const group = directions.get(direction) ?? { count: 0, revenueRub: 0, distanceKm: 0 }
    group.count += 1
    group.revenueRub += orderAmount(order)
    group.distanceKm += order.distance ?? 0
    directions.set(direction, group)
  }

  const totalDistance = orders.reduce((sum, order) => sum + (order.distance ?? 0), 0)

  return {
    byStatus: Array.from(byStatus.entries())
      .map(([status, group]) => ({
        status,
        label: orderStatusLabel(status),
        count: group.count,
        revenueRub: group.revenueRub,
      }))
      .sort((a, b) => b.count - a.count),
    avgPriceRub: orders.length
      ? Math.round(orders.reduce((sum, order) => sum + orderAmount(order), 0) / orders.length)
      : 0,
    avgDistanceKm: orders.length ? Math.round(totalDistance / orders.length) : 0,
    onTimeCount,
    lateCount,
    onTimePercent: withDeadline.length ? ratio(onTimeCount, withDeadline.length, 0) : null,
    topDirections: Array.from(directions.entries())
      .map(([direction, group]) => ({ direction, ...group }))
      .sort((a, b) => b.revenueRub - a.revenueRub)
      .slice(0, 10),
  }
}

/** Ключ клиента: карточка, иначе нормализованное имя (как в оплатах). */
export function clientKeyOf(order: Pick<ReportOrder, "clientId" | "clientName">): string {
  if (order.clientId) return `id:${order.clientId}`
  const name = (order.clientName ?? "").trim().replace(/\s+/g, " ").toLowerCase()
  return name ? `name:${name}` : "unknown"
}

/** Клиенты: выручка периода, долг и просрочка по всем незакрытым оплатам. */
export function buildClientsBlock(
  orders: ReportOrder[],
  paymentOrders: ReportOrder[],
  now: Date = new Date(),
): ReportResult["clients"] {
  const clients = new Map<string, ReportResult["clients"]["top"][number]>()

  for (const order of orders) {
    const key = clientKeyOf(order)
    const client =
      clients.get(key) ??
      {
        key,
        clientId: order.clientId ?? null,
        name: (order.clientName ?? "Клиент не указан").trim() || "Клиент не указан",
        orders: 0,
        revenueRub: 0,
        debtRub: 0,
        overdueRub: 0,
      }

    client.orders += 1
    client.revenueRub += orderAmount(order)
    if (!client.clientId && order.clientId) client.clientId = order.clientId
    clients.set(key, client)
  }

  for (const order of paymentOrders) {
    const amount = orderAmount(order)
    if (amount <= 0) continue

    const key = clientKeyOf(order)
    const client = clients.get(key)
    if (!client) continue

    if (!order.isPaid) {
      client.debtRub += amount
      if (overdueDaysFor(order, now) > 0) client.overdueRub += amount
    }
  }

  const top = Array.from(clients.values()).sort((a, b) => b.revenueRub - a.revenueRub)
  const totalRub = top.reduce((sum, client) => sum + client.revenueRub, 0)

  return {
    totalRub,
    concentrationPercent: top.length && top[0].revenueRub ? ratio(top[0].revenueRub, totalRub, 0) : null,
    top: top.slice(0, 20),
  }
}

/** Водители: рейсы, заказы, выручка, пробег, расходы рейсов и своевременность. */
export function buildDriversBlock(params: {
  drivers: ReportDriver[]
  orders: ReportOrder[]
  routes: ReportRoute[]
  expenses: ReportExpense[]
}): ReportResult["drivers"] {
  const { drivers, orders, routes, expenses } = params
  const expensesByRoute = new Map<string, number>()
  for (const expense of expenses) {
    expensesByRoute.set(expense.routeId, (expensesByRoute.get(expense.routeId) ?? 0) + expense.amount)
  }

  const rows = new Map<string, ReportResult["drivers"][number]>()

  const ensure = (driverId: string, name?: string | null) => {
    const known = drivers.find((driver) => driver.id === driverId)
    const row =
      rows.get(driverId) ??
      {
        driverId,
        name: name ?? known?.name ?? "Водитель",
        routes: 0,
        orders: 0,
        revenueRub: 0,
        distanceKm: 0,
        expensesRub: 0,
        profitRub: 0,
        avgOrderRub: 0,
        onTimePercent: null,
      }
    rows.set(driverId, row)
    return row
  }

  for (const order of orders) {
    if (!order.assignedDriverId) continue
    const row = ensure(order.assignedDriverId)
    row.orders += 1
    row.revenueRub += orderAmount(order)
  }

  for (const route of routes) {
    if (!route.driverId) continue
    const row = ensure(route.driverId)
    row.routes += 1
    row.distanceKm +=
      typeof route.startOdometer === "number" && typeof route.endOdometer === "number"
        ? Math.max(0, route.endOdometer - route.startOdometer)
        : route.totalDistance ?? 0
    row.expensesRub += expensesByRoute.get(route.id) ?? 0
  }

  const withDeadline = orders.filter((order) => order.completedAt && order.deadline)

  for (const row of rows.values()) {
    row.profitRub = row.revenueRub - row.expensesRub
    row.avgOrderRub = row.orders ? Math.round(row.revenueRub / row.orders) : 0

    const own = withDeadline.filter((order) => order.assignedDriverId === row.driverId)
    if (own.length) {
      const onTime = own.filter(
        (order) => (order.completedAt as Date).getTime() <= (order.deadline as Date).getTime(),
      ).length
      row.onTimePercent = ratio(onTime, own.length, 0)
    }
  }

  return Array.from(rows.values()).sort((a, b) => b.revenueRub - a.revenueRub)
}

/** Машины: рейсы, пробег, выручка, расходы и себестоимость километра. */
export function buildVehiclesBlock(params: {
  vehicles: ReportVehicle[]
  orders: ReportOrder[]
  routes: ReportRoute[]
  expenses: ReportExpense[]
}): ReportResult["vehicles"] {
  const { vehicles, orders, routes, expenses } = params
  const expensesByRoute = new Map<string, number>()
  for (const expense of expenses) {
    expensesByRoute.set(expense.routeId, (expensesByRoute.get(expense.routeId) ?? 0) + expense.amount)
  }

  const rows = new Map<string, ReportResult["vehicles"][number]>()

  const ensure = (vehicleId: string) => {
    const known = vehicles.find((vehicle) => vehicle.id === vehicleId)
    const row =
      rows.get(vehicleId) ??
      {
        vehicleId,
        plate: known?.plate ?? "Без номера",
        routes: 0,
        orders: 0,
        distanceKm: 0,
        revenueRub: 0,
        expensesRub: 0,
        profitRub: 0,
        costPerKmRub: null,
      }
    rows.set(vehicleId, row)
    return row
  }

  for (const route of routes) {
    if (!route.vehicleId) continue
    const row = ensure(route.vehicleId)
    row.routes += 1
    row.distanceKm +=
      typeof route.startOdometer === "number" && typeof route.endOdometer === "number"
        ? Math.max(0, route.endOdometer - route.startOdometer)
        : route.totalDistance ?? 0
    row.expensesRub += expensesByRoute.get(route.id) ?? 0
  }

  for (const order of orders) {
    if (!order.assignedVehicleId) continue
    const row = ensure(order.assignedVehicleId)
    row.orders += 1
    row.revenueRub += orderAmount(order)
  }

  for (const row of rows.values()) {
    row.profitRub = row.revenueRub - row.expensesRub
    row.costPerKmRub = row.distanceKm ? round(row.expensesRub / row.distanceKm, 1) : null
  }

  return Array.from(rows.values()).sort((a, b) => b.revenueRub - a.revenueRub)
}

/** Парк: загрузка, простой и рейсы, которые не отбили расходы. */
export function buildFleetBlock(params: {
  vehicles: ReportVehicle[]
  vehiclesRows: ReportResult["vehicles"]
  routes: ReportRoute[]
  orders: ReportOrder[]
  expenses: ReportExpense[]
}): ReportResult["fleet"] {
  const { vehicles, vehiclesRows, routes, orders, expenses } = params

  const used = new Set(vehiclesRows.map((row) => row.vehicleId))
  const idleVehicles = vehicles
    .filter((vehicle) => !used.has(vehicle.id))
    .map((vehicle) => ({ vehicleId: vehicle.id, plate: vehicle.plate ?? "Без номера" }))

  const revenueByRoute = new Map<string, number>()
  for (const order of orders) {
    if (!order.routeId) continue
    revenueByRoute.set(order.routeId, (revenueByRoute.get(order.routeId) ?? 0) + orderAmount(order))
  }

  const expensesByRoute = new Map<string, number>()
  for (const expense of expenses) {
    expensesByRoute.set(expense.routeId, (expensesByRoute.get(expense.routeId) ?? 0) + expense.amount)
  }

  const unprofitableRoutes = routes
    .map((route) => {
      const revenueRub = revenueByRoute.get(route.id) ?? 0
      const expensesRub = expensesByRoute.get(route.id) ?? 0
      return {
        routeId: route.id,
        name: route.name ?? `Рейс ${route.id.slice(-6)}`,
        revenueRub,
        expensesRub,
        profitRub: revenueRub - expensesRub,
      }
    })
    .filter((route) => route.expensesRub > 0 && route.profitRub < 0)
    .sort((a, b) => a.profitRub - b.profitRub)
    .slice(0, 10)

  const vehiclesTotal = vehicles.length

  return {
    vehiclesTotal,
    vehiclesUsed: used.size,
    utilizationPercent: vehiclesTotal ? ratio(used.size, vehiclesTotal, 0) : null,
    idleVehicles,
    unprofitableRoutes,
  }
}

/** Оплаты: получено, ждём, просрочено, средний срок оплаты и должники. */
export function buildPaymentsBlock(
  orders: ReportOrder[],
  now: Date = new Date(),
): ReportResult["payments"] {
  let paidRub = 0
  let pendingRub = 0
  let overdueRub = 0
  let deferredRub = 0
  let overdueCount = 0
  const paidDays: number[] = []
  const debtors = new Map<string, { name: string; debtRub: number; overdueRub: number; orders: number }>()

  for (const order of orders) {
    const amount = orderAmount(order)
    if (amount <= 0) continue

    if (order.isPaid) {
      paidRub += amount
      if (order.paidAt) {
        paidDays.push(daysBetween(orderAttributionDate(order), order.paidAt))
      }
      continue
    }

    const overdueDays = overdueDaysFor(order, now)
    const dueDate = paymentDueDate(order)

    if (overdueDays > 0) {
      overdueRub += amount
      overdueCount += 1
    } else if (dueDate) {
      // Срок известен и ещё не наступил — это отсрочка, а не «просто ждём»
      deferredRub += amount
    } else {
      pendingRub += amount
    }

    const key = clientKeyOf(order)
    const debtor =
      debtors.get(key) ??
      {
        name: (order.clientName ?? "Клиент не указан").trim() || "Клиент не указан",
        debtRub: 0,
        overdueRub: 0,
        orders: 0,
      }
    debtor.debtRub += amount
    debtor.orders += 1
    if (overdueDays > 0) debtor.overdueRub += amount
    debtors.set(key, debtor)
  }

  return {
    paidRub,
    pendingRub,
    overdueRub,
    overdueCount,
    deferredRub,
    avgDaysToPayment: paidDays.length
      ? round(paidDays.reduce((sum, days) => sum + days, 0) / paidDays.length, 0)
      : null,
    overdueClients: Array.from(debtors.values())
      .filter((debtor) => debtor.overdueRub > 0)
      .sort((a, b) => b.overdueRub - a.overdueRub)
      .slice(0, 10),
  }
}

/** Полный отчёт за период: деньги, заказы, клиенты, водители, машины, оплаты. */
export function buildReport(input: ReportInput, period: ReportPeriod, now: Date = new Date()): ReportResult {
  const previous = previousPeriod(period.from, period.to)

  const ordersInPeriod = input.orders
    .filter((order) => inRange(orderAttributionDate(order), period.from, period.to))
    .sort((a, b) => orderAttributionDate(a).getTime() - orderAttributionDate(b).getTime())

  const previousOrders = input.orders.filter((order) =>
    inRange(orderAttributionDate(order), previous.from, previous.to),
  )

  const routesInPeriod = input.routes.filter((route) =>
    inRange(routeAttributionDate(route), period.from, period.to),
  )
  const previousRoutes = input.routes.filter((route) =>
    inRange(routeAttributionDate(route), previous.from, previous.to),
  )

  // Расход привязан к рейсу: в период попадают и расходы рейсов периода,
  // иначе выручка была бы «своя», а топливо — чужое
  const routeIdsInPeriod = new Set(routesInPeriod.map((route) => route.id))
  const previousRouteIds = new Set(previousRoutes.map((route) => route.id))

  const expensesInPeriod = input.expenses.filter(
    (expense) =>
      routeIdsInPeriod.has(expense.routeId) || inRange(expense.spentAt, period.from, period.to),
  )
  const previousExpenses = input.expenses.filter(
    (expense) =>
      previousRouteIds.has(expense.routeId) || inRange(expense.spentAt, previous.from, previous.to),
  )

  const vehicles = input.vehicles ?? []
  const drivers = input.drivers ?? []
  const paymentOrders = (input.paymentOrders ?? input.orders).filter((order) => orderAmount(order) > 0)

  const finance = buildKpi({ orders: ordersInPeriod, expenses: expensesInPeriod, routes: routesInPeriod })
  const previousFinance = buildKpi({
    orders: previousOrders,
    expenses: previousExpenses,
    routes: previousRoutes,
  })

  const vehiclesRows = buildVehiclesBlock({
    vehicles,
    orders: ordersInPeriod,
    routes: routesInPeriod,
    expenses: expensesInPeriod,
  })

  return {
    period,
    previous,
    finance,
    previousFinance,
    series: buildSeries(ordersInPeriod, expensesInPeriod, period),
    expensesByType: buildExpensesByType(expensesInPeriod),
    orders: buildOrdersBlock(ordersInPeriod),
    clients: buildClientsBlock(ordersInPeriod, paymentOrders, now),
    drivers: buildDriversBlock({
      drivers,
      orders: ordersInPeriod,
      routes: routesInPeriod,
      expenses: expensesInPeriod,
    }),
    vehicles: vehiclesRows,
    fleet: buildFleetBlock({
      vehicles,
      vehiclesRows,
      routes: routesInPeriod,
      orders: ordersInPeriod,
      expenses: expensesInPeriod,
    }),
    payments: buildPaymentsBlock(paymentOrders, now),
    data: {
      ordersInPeriod: ordersInPeriod.length,
      routesInPeriod: routesInPeriod.length,
      expensesInPeriod: expensesInPeriod.length,
      hasData: ordersInPeriod.length > 0 || routesInPeriod.length > 0 || expensesInPeriod.length > 0,
    },
  }
}
