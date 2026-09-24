// lib/trips/history.ts
//
// История рейса (задача 7): хронология, расходы и итог.
//
// Логисту и водителю нужен один ответ на вопрос «как прошёл рейс»: что
// случилось и когда, сколько потратили (топливо в первую очередь), какие
// документы и фото остались и что в итоге заработали. Здесь это считается
// из уже существующих записей: события рейса, заказы, расходы, этапы.
//
// Модуль чистый (без Prisma и Next) — проверяется тестами без базы.

export type TimelineEventInput = {
  id: string
  type?: string | null
  status?: string | null
  message?: string | null
  description?: string | null
  createdAt?: Date | null
  lat?: number | null
  lng?: number | null
  orderId?: string | null
}

export type TimelineOrderInput = {
  id: string
  status?: string | null
  routeFrom?: string | null
  routeTo?: string | null
  cargoType?: string | null
  weight?: number | null
  price?: number | null
  agreedPrice?: number | null
  createdAt?: Date | null
  deliveredAt?: Date | null
  completedAt?: Date | null
  deadline?: Date | null
}

export type ExpenseInput = {
  id: string
  type?: string | null
  amount: number
  liters?: number | null
  odometer?: number | null
  vendor?: string | null
  spentAt?: Date | null
  note?: string | null
  source?: string | null
  photoId?: string | null
}

export type TripRouteInput = {
  id: string
  name?: string | null
  status?: string | null
  createdAt?: Date | null
  startedAt?: Date | null
  completedAt?: Date | null
  totalDistance?: number | null
  cargoWeight?: number | null
  startOdometer?: number | null
  endOdometer?: number | null
}

export type TripTimelineEntry = {
  id: string
  at: Date | null
  kind: "event" | "status" | "order" | "expense" | "start" | "finish"
  title: string
  description: string | null
  amount?: number
  orderId?: string | null
}

export type TripSummary = {
  ordersCount: number
  /** Пробег: по одометру, если его записали, иначе — плановый/расчётный. */
  distanceKm: number
  odometerDistanceKm: number | null
  plannedDistanceKm: number | null
  durationDays: number | null
  revenueRub: number
  expensesRub: number
  fuelRub: number
  fuelLiters: number
  fuelPricePerLiter: number | null
  otherRub: number
  profitRub: number
  /** Сколько денег уходит на километр и сколько приходит. */
  costPerKmRub: number | null
  revenuePerKmRub: number | null
  marginPercent: number | null
}

export const EXPENSE_TYPES = ["fuel", "toll", "repair", "other"] as const
export type ExpenseType = (typeof EXPENSE_TYPES)[number]

export const EXPENSE_TYPE_LABELS: Record<string, string> = {
  fuel: "Топливо",
  toll: "Платные дороги",
  repair: "Ремонт",
  other: "Прочее",
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  status: "Смена статуса",
  location: "Местоположение",
  note: "Заметка",
  photo: "Фото",
  sos: "SOS",
  load: "Загрузка",
  unload: "Разгрузка",
  fuel: "Заправка",
  expense: "Расход",
}

export function expenseTypeLabel(type: string | null | undefined): string {
  if (!type) return EXPENSE_TYPE_LABELS.other
  return EXPENSE_TYPE_LABELS[type] ?? type
}

export function orderAmount(order: TimelineOrderInput): number {
  return order.agreedPrice ?? order.price ?? 0
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)
}

/**
 * Пробег рейса.
 *
 * Приоритет — показания одометра: это фактические километры, которые прошла
 * машина. Если их не записали, показываем расчётный пробег модели (сумма
 * расстояний заказов), а не выдумываем число.
 */
export function tripDistanceKm(params: {
  startOdometer?: number | null
  endOdometer?: number | null
  totalDistance?: number | null
  orders?: TimelineOrderInput[]
}): { distanceKm: number; odometerDistanceKm: number | null; plannedDistanceKm: number | null } {
  const { startOdometer, endOdometer, totalDistance, orders = [] } = params

  const odometerDistanceKm =
    typeof startOdometer === "number" &&
    typeof endOdometer === "number" &&
    endOdometer >= startOdometer
      ? endOdometer - startOdometer
      : null

  const plannedFromOrders = orders.reduce((sum, order) => sum + (orderDistance(order) || 0), 0)
  const planned = totalDistance && totalDistance > 0 ? totalDistance : plannedFromOrders || null

  return {
    distanceKm: odometerDistanceKm ?? planned ?? 0,
    odometerDistanceKm,
    plannedDistanceKm: planned,
  }
}

/** Расстояние заказа, если оно есть в записи (поля может не быть). */
function orderDistance(order: TimelineOrderInput & { distance?: number | null }): number | null {
  const value = (order as { distance?: number | null }).distance
  return typeof value === "number" && value > 0 ? value : null
}

/** Итог рейса: заработок, расходы и что осталось. */
export function buildTripSummary(params: {
  route: TripRouteInput
  orders?: TimelineOrderInput[]
  expenses?: ExpenseInput[]
}): TripSummary {
  const { route, orders = [], expenses = [] } = params

  const { distanceKm, odometerDistanceKm, plannedDistanceKm } = tripDistanceKm({
    startOdometer: route.startOdometer,
    endOdometer: route.endOdometer,
    totalDistance: route.totalDistance,
    orders: orders as TimelineOrderInput[],
  })

  const revenueRub = orders.reduce((sum, order) => sum + orderAmount(order), 0)
  const expensesRub = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0)

  const fuel = expenses.filter((expense) => (expense.type ?? "fuel") === "fuel")
  const fuelRub = fuel.reduce((sum, expense) => sum + (expense.amount || 0), 0)
  const fuelLiters = fuel.reduce((sum, expense) => sum + (expense.liters ?? 0), 0)
  const fuelPricePerLiter = fuelLiters > 0 ? Math.round((fuelRub / fuelLiters) * 100) / 100 : null

  const profitRub = revenueRub - expensesRub

  // Длительность считается по календарю и включая день выезда: рейс
  // «выехали 2-го, вернулись 4-го» — это три дня в пути, как и говорят вслух.
  const from = route.startedAt ?? route.createdAt ?? null
  const to = route.completedAt ?? null
  const durationDays = from && to ? Math.max(1, daysBetween(from, to) + 1) : null

  return {
    ordersCount: orders.length,
    distanceKm,
    odometerDistanceKm,
    plannedDistanceKm,
    durationDays,
    revenueRub,
    expensesRub,
    fuelRub,
    fuelLiters: Math.round(fuelLiters * 100) / 100,
    fuelPricePerLiter,
    otherRub: expensesRub - fuelRub,
    profitRub,
    costPerKmRub: distanceKm > 0 ? Math.round((expensesRub / distanceKm) * 100) / 100 : null,
    revenuePerKmRub: distanceKm > 0 ? Math.round((revenueRub / distanceKm) * 100) / 100 : null,
    marginPercent:
      revenueRub > 0 ? Math.round(((revenueRub - expensesRub) / revenueRub) * 1000) / 10 : null,
  }
}

/**
 * Хронология рейса: события, смены статусов заказов, расходы и границы рейса —
 * в одном списке по времени. Так «что было» читается сверху вниз, без перехода
 * между разными экранами.
 */
export function buildTripTimeline(params: {
  route: TripRouteInput
  events?: TimelineEventInput[]
  orders?: TimelineOrderInput[]
  expenses?: ExpenseInput[]
  orderStatusLabel?: (status: string) => string
  eventTypeLabel?: (type: string | null | undefined) => string
  eventTitle?: (event: TimelineEventInput) => string
}): TripTimelineEntry[] {
  const {
    route,
    events = [],
    orders = [],
    expenses = [],
    orderStatusLabel,
    eventTypeLabel,
    eventTitle,
  } = params

  const entries: TripTimelineEntry[] = []

  if (route.createdAt) {
    entries.push({
      id: `${route.id}-created`,
      at: route.createdAt,
      kind: "start",
      title: "Рейс создан",
      description: route.name ?? null,
    })
  }

  if (route.startedAt) {
    entries.push({
      id: `${route.id}-started`,
      at: route.startedAt,
      kind: "start",
      title: "Рейс начат",
      description: route.startOdometer ? `Одометр: ${route.startOdometer} км` : null,
    })
  }

  for (const event of events) {
    const title = eventTitle
      ? eventTitle(event)
      : event.message ||
        event.description ||
        (event.status && orderStatusLabel ? orderStatusLabel(event.status) : null) ||
        (eventTypeLabel ? eventTypeLabel(event.type) : null) ||
        "Событие рейса"

    entries.push({
      id: event.id,
      at: event.createdAt ?? null,
      kind: event.status ? "status" : "event",
      title: String(title),
      description: event.description && event.description !== title ? event.description : null,
      orderId: event.orderId ?? null,
    })
  }

  for (const order of orders) {
    const at = order.deliveredAt ?? order.completedAt ?? order.createdAt ?? null
    const label = order.status && orderStatusLabel ? orderStatusLabel(order.status) : order.status

    entries.push({
      id: `${order.id}-order`,
      at,
      kind: "order",
      title: `${order.routeFrom ?? ""} → ${order.routeTo ?? ""}`.trim() || "Заказ",
      description: [label, order.cargoType].filter(Boolean).join(" · ") || null,
      amount: orderAmount(order),
      orderId: order.id,
    })
  }

  for (const expense of expenses) {
    entries.push({
      id: expense.id,
      at: expense.spentAt ?? null,
      kind: "expense",
      title: expenseTypeLabel(expense.type),
      description: [
        expense.vendor,
        expense.liters ? `${expense.liters} л` : null,
        expense.odometer ? `одометр ${expense.odometer}` : null,
        expense.note,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      amount: expense.amount || 0,
    })
  }

  if (route.completedAt) {
    entries.push({
      id: `${route.id}-completed`,
      at: route.completedAt,
      kind: "finish",
      title: "Рейс завершён",
      description: route.endOdometer ? `Одометр: ${route.endOdometer} км` : null,
    })
  }

  return entries.sort((a, b) => {
    const aTime = a.at ? new Date(a.at).getTime() : 0
    const bTime = b.at ? new Date(b.at).getTime() : 0
    return aTime - bTime
  })
}

/** Расходы, сгруппированные по видам: сколько ушло на топливо, ремонт и прочее. */
export function groupExpensesByType(expenses: ExpenseInput[]): Array<{
  type: string
  label: string
  amount: number
  liters: number
  count: number
}> {
  const groups = new Map<string, { type: string; label: string; amount: number; liters: number; count: number }>()

  for (const expense of expenses) {
    const type = expense.type ?? "other"
    const current =
      groups.get(type) ??
      { type, label: expenseTypeLabel(type), amount: 0, liters: 0, count: 0 }

    current.amount += expense.amount || 0
    current.liters += expense.liters ?? 0
    current.count += 1

    groups.set(type, current)
  }

  return [...groups.values()].sort((a, b) => b.amount - a.amount)
}

/** Средний расход топлива на 100 км — по чекам и фактическому пробегу. */
export function fuelConsumptionPer100Km(params: {
  liters: number
  distanceKm: number
}): number | null {
  const { liters, distanceKm } = params
  if (liters <= 0 || distanceKm <= 0) return null
  return Math.round((liters / distanceKm) * 100 * 10) / 10
}
