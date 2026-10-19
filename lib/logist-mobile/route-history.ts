// lib/logist-mobile/route-history.ts
//
// История рейсов: что и когда возили, и кто из клиентов ещё не заплатил.
//
// Зачем отдельный модуль: вопрос «чем мы везли месяц назад и кто не заплатил»
// логист задаёт постоянно — при разборе платежей, при споре с клиентом, при
// плановом обзоре автопарка. Собирать это вручную по карточкам рейсов нельзя:
// рейсов десятки, заказов сотни.
//
// Здесь только чистые вычисления (без базы и Next) — их проверяют юнит-тесты.
// Расчёт сроков оплаты и просрочки берём из общего модуля платежей, чтобы
// цифры в истории и в разделе «Платежи» не расходились.
//
// Модуль чистый (без Next, без Prisma, без React) — его проверяют юнит-тесты
// tests/logist-mobile-route-history.test.mjs.

import {
  buildPaymentRow,
  overdueDaysFor,
  orderAmount,
  paymentStateLabel,
  type PaymentOrderInput,
} from "../payments/summary"
import { formatDateShort, shortCity } from "./format"

// ---------------------------------------------------------------------------
// Вход и выход
// ---------------------------------------------------------------------------

/** Заказ рейса глазами истории. */
export interface HistoryOrder {
  id: string
  clientName: string | null
  clientContact: string | null
  /** ИНН клиента — по нему бухгалтерия находит организацию */
  clientInn?: string | null
  clientId?: string | null
  routeFrom: string
  routeTo: string
  distance: number | null
  cargoType?: string | null
  weight?: number | null
  status: string
  deliveredAt?: Date | null
  price?: number | null
  agreedPrice?: number | null
  paymentType?: string | null
  deferredDays?: number | null
  isPaid?: boolean | null
  paidAt?: Date | null
}

/** Рейс глазами истории. */
export interface HistoryRoute {
  id: string
  name: string | null
  status: string
  createdAt?: Date | null
  startedAt?: Date | null
  completedAt?: Date | null
  driverId?: string | null
  driverName?: string | null
  vehicleId?: string | null
  vehiclePlate?: string | null
  totalDistance?: number | null
  cargoWeight?: number | null
  orders: HistoryOrder[]
}

/** Период истории: за сколько дней назад показывать рейсы. */
export interface HistoryFilters {
  /** null — за всё время */
  days: number | null
  /** Показать рейсы только этой машины */
  vehicleId?: string | null
  /** Показать рейсы только этого водителя */
  driverId?: string | null
}

/** Варианты периода — то, что логист выбирает на экране. */
export const HISTORY_PERIODS = [
  { days: 7, label: "Неделя" },
  { days: 30, label: "Месяц" },
  { days: 90, label: "3 месяца" },
  { days: null, label: "Всё время" },
] as const

/** Состояние рейса словами. */
const ROUTE_STATE_LABELS: Record<string, string> = {
  planned: "Запланирован",
  active: "В пути",
  in_transit: "В пути",
  completed: "Завершён",
  cancelled: "Отменён",
}

export function routeStateLabel(status: string | null | undefined): string {
  if (!status) return "Без статуса"
  return ROUTE_STATE_LABELS[status] ?? status
}

/**
 * Дата рейса для списка: когда его реально везли.
 *
 * Берём фактическое начало, иначе фактическое окончание, иначе дату создания:
 * рейс могли создать заранее и повёзти позже — в истории важна дата поездки,
 * а не дата записи в базе.
 */
export function routeHistoryDate(route: HistoryRoute): Date | null {
  return route.startedAt ?? route.completedAt ?? route.createdAt ?? null
}

/** Подпись даты рейса: «12 октября», с годом — если рейс не из этого года. */
export function routeHistoryDateLabel(route: HistoryRoute, now: Date = new Date()): string {
  const date = routeHistoryDate(route)
  if (!date) return "дата неизвестна"
  const sameYear = date.getFullYear() === now.getFullYear()
  const label = formatDateShort(date.toISOString())
  return sameYear ? label : `${label} ${date.getFullYear()}`
}

/** Куда ехал рейс: точки по порядку, без повторов. */
export function routeHistoryWaypoints(route: HistoryRoute): string[] {
  const points: string[] = []
  for (const order of route.orders) {
    for (const value of [order.routeFrom, order.routeTo]) {
      const city = shortCity(value)
      if (city && city !== "—" && !points.includes(city)) points.push(city)
    }
  }
  return points
}

/** «Москва — Тула — Воронеж» — одной строкой для списка. */
export function routeHistoryLine(route: HistoryRoute): string {
  const points = routeHistoryWaypoints(route)
  if (points.length === 0) return route.name?.replace(/^Рейс:\s*/, "") || "маршрут не указан"
  return points.join(" — ")
}

// ---------------------------------------------------------------------------
// Оплата по заказу рейса
// ---------------------------------------------------------------------------

/** Состояние оплаты заказа: подпись и её тон. */
export interface OrderPaymentState {
  label: string
  tone: "paid" | "wait" | "overdue" | "unknown"
  amount: number
  dueDate: Date | null
  overdueDays: number
}

/**
 * Состояние оплаты одного заказа рейса.
 *
 * Тон «unknown» — когда по заказу нет условий оплаты: не «оплачен» и не
 * «долг», а «непонятно». Показывать его как просрочку нельзя — это вранье.
 */
export function orderPaymentState(
  order: HistoryOrder,
  now: Date = new Date(),
): OrderPaymentState {
  const row = buildPaymentRow(order as PaymentOrderInput, now)
  const amount = orderAmount(order as PaymentOrderInput)

  if (row.isPaid) {
    return { label: "Оплачен", tone: "paid", amount, dueDate: row.dueDate, overdueDays: 0 }
  }
  if (row.isOverdue) {
    return {
      label: `Просрочка ${row.overdueDays} дн.`,
      tone: "overdue",
      amount,
      dueDate: row.dueDate,
      overdueDays: row.overdueDays,
    }
  }
  if (row.isDeferred) {
    return {
      label: "Ждём оплату",
      tone: "wait",
      amount,
      dueDate: row.dueDate,
      overdueDays: 0,
    }
  }
  return { label: "Без условий оплаты", tone: "unknown", amount, dueDate: row.dueDate, overdueDays: 0 }
}

/** Подпись состояния оплаты словами — общая с разделом «Платежи». */
export function orderPaymentStateText(
  order: HistoryOrder,
  now: Date = new Date(),
): string {
  const row = buildPaymentRow(order as PaymentOrderInput, now)
  return paymentStateLabel(row)
}

/** Сколько дней просрочки у заказа (0 — не просрочен). */
export function orderOverdueDays(order: HistoryOrder, now: Date = new Date()): number {
  return overdueDaysFor(order as PaymentOrderInput, now)
}

// ---------------------------------------------------------------------------
// Фильтр и сводка
// ---------------------------------------------------------------------------

/** Попадает ли рейс в выбранный период. */
export function inHistoryPeriod(
  route: HistoryRoute,
  days: number | null,
  now: Date = new Date(),
): boolean {
  if (days === null) return true
  const date = routeHistoryDate(route)
  if (!date) return true // без даты не прячем: логист должен увидеть рейс
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  from.setHours(0, 0, 0, 0)
  return date.getTime() >= from.getTime()
}

/**
 * Отбор рейсов по фильтрам: период, машина, водитель.
 * Сначала свежие — история читается сверху вниз.
 */
export function filterHistoryRoutes(
  routes: readonly HistoryRoute[],
  filters: HistoryFilters,
  now: Date = new Date(),
): HistoryRoute[] {
  const filtered = routes.filter((route) => {
    if (!inHistoryPeriod(route, filters.days, now)) return false
    if (filters.vehicleId && route.vehicleId !== filters.vehicleId) return false
    if (filters.driverId && route.driverId !== filters.driverId) return false
    return true
  })
  return [...filtered].sort((a, b) => {
    const aDate = routeHistoryDate(a)?.getTime() ?? 0
    const bDate = routeHistoryDate(b)?.getTime() ?? 0
    return bDate - aDate
  })
}

/** Итог по истории: что за период было и сколько денег ещё ждём. */
export interface HistorySummary {
  routes: number
  orders: number
  distanceKm: number
  cargoWeightKg: number
  /** Всего денег по заказам периода */
  amount: number
  /** Оплачено */
  paidAmount: number
  /** Ждём оплаты (отсрочка, срок не прошёл) */
  waitingAmount: number
  /** Просрочено — с этого начинать разговор */
  overdueAmount: number
  /** Сколько заказов без условий оплаты */
  unknownCount: number
  /** Сколько разных клиентов должны */
  debtorClients: number
  /** Заказы с просрочкой — чтобы было видно масштаб, а не только рубли */
  overdueCount: number
}

export function historySummary(
  routes: readonly HistoryRoute[],
  now: Date = new Date(),
): HistorySummary {
  const summary: HistorySummary = {
    routes: routes.length,
    orders: 0,
    distanceKm: 0,
    cargoWeightKg: 0,
    amount: 0,
    paidAmount: 0,
    waitingAmount: 0,
    overdueAmount: 0,
    unknownCount: 0,
    debtorClients: 0,
    overdueCount: 0,
  }

  const debtors = new Set<string>()

  for (const route of routes) {
    summary.distanceKm += route.totalDistance ?? 0
    summary.cargoWeightKg += route.cargoWeight ?? 0
    for (const order of route.orders) {
      summary.orders += 1
      const state = orderPaymentState(order, now)
      summary.amount += state.amount
      if (state.tone === "paid") summary.paidAmount += state.amount
      else if (state.tone === "overdue") {
        summary.overdueAmount += state.amount
        summary.overdueCount += 1
        debtors.add(order.clientId || order.clientName || order.id)
      } else if (state.tone === "wait") summary.waitingAmount += state.amount
      else summary.unknownCount += 1
    }
  }

  summary.debtorClients = debtors.size
  return summary
}

/**
 * Заказы рейса в порядке, в каком их везли.
 * Номер точки берём из routeSequence, если он есть, иначе из порядка в списке.
 */
export function historyOrdersInOrder(route: HistoryRoute): HistoryOrder[] {
  return [...route.orders].sort((a, b) => {
    const aSeq = (a as { routeSequence?: number | null }).routeSequence ?? 0
    const bSeq = (b as { routeSequence?: number | null }).routeSequence ?? 0
    return aSeq - bSeq
  })
}
