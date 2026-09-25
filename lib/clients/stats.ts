// lib/clients/stats.ts
//
// Статистика по клиенту: сколько заказов, сколько денег, платит ли в срок
// (задача 5). Считается по уже имеющимся данным заказов — ничего не заводим
// второй раз и не выдумываем.
//
// Оплата живёт на заказе: Order.isPaid / paidAt / dueDate, сумма — согласованная
// цена, иначе прайс. НДС и форма оплаты — условия клиента, но если они заданы
// в конкретном заказе, приоритет у заказа.
//
// Модуль чистый: без Prisma и Next.js — проверяется тестами без базы.

// относительный импорт, а не "@/…": модуль компилируется и тестируется в Node
// без Next.js (см. tests/tsconfig.json)
import { CLOSED_ORDER_STATUSES, normalizeOrderStatus } from "../orders/stages"

/** Заказ в том виде, в каком он нужен статистике клиента. */
export type ClientOrderLike = {
  id: string
  status: string
  price?: number | null
  agreedPrice?: number | null
  isPaid?: boolean | null
  paidAt?: Date | null
  dueDate?: Date | null
  deadline?: Date | null
  createdAt?: Date | null
  updatedAt?: Date | null
  routeFrom?: string | null
  routeTo?: string | null
  routeId?: string | null
}

export type ClientStats = {
  total: number
  /** Выполненные (delivered). */
  delivered: number
  /** Отменённые и отклонённые + истёкшие. */
  cancelled: number
  /** Ещё в работе. */
  active: number
  /** Сумма всех заказов, кроме отменённых — то, что клиент заказывал. */
  revenueRub: number
  paidRub: number
  unpaidRub: number
  /** Просроченная оплата: срок прошёл, деньги не пришли. */
  overdueRub: number
  overdueCount: number
  /** Средний срок оплаты в днях — по заказам с известной датой оплаты. */
  avgPaymentDays: number | null
  /** Доля выполненных от закрытых, 0..100. */
  reliabilityPercent: number | null
  lastOrderAt: Date | null
}

/** Сумма заказа: согласованная цена важнее прайса. */
export function orderAmount(order: ClientOrderLike): number {
  if (typeof order.agreedPrice === "number" && order.agreedPrice > 0) return order.agreedPrice
  if (typeof order.price === "number" && order.price > 0) return order.price
  return 0
}

function isCancelled(status: string): boolean {
  const normalized = normalizeOrderStatus(status)
  if (!normalized) return false
  return normalized === "cancelled" || normalized === "rejected" || normalized === "expired"
}

function isDelivered(status: string): boolean {
  return normalizeOrderStatus(status) === "delivered"
}

function isClosed(status: string): boolean {
  const normalized = normalizeOrderStatus(status)
  return normalized !== null && (CLOSED_ORDER_STATUSES as readonly string[]).includes(normalized)
}

/** Дней между двумя датами (округление вниз, отрицательное → 0). */
export function daysBetween(from: Date, to: Date): number {
  const diff = to.getTime() - from.getTime()
  if (diff <= 0) return 0
  return Math.floor(diff / (24 * 60 * 60 * 1000))
}

export function buildClientStats(orders: ClientOrderLike[], now: Date = new Date()): ClientStats {
  let delivered = 0
  let cancelled = 0
  let active = 0
  let revenueRub = 0
  let paidRub = 0
  let unpaidRub = 0
  let overdueRub = 0
  let overdueCount = 0
  let lastOrderAt: Date | null = null

  const paymentDurations: number[] = []

  for (const order of orders) {
    const amount = orderAmount(order)
    const cancelledOrder = isCancelled(order.status)

    if (isDelivered(order.status)) delivered += 1
    else if (cancelledOrder) cancelled += 1
    else if (!isClosed(order.status)) active += 1

    if (!cancelledOrder) revenueRub += amount

    if (order.isPaid) {
      paidRub += amount
    } else if (!cancelledOrder && amount > 0) {
      unpaidRub += amount

      const due = order.dueDate ?? null
      if (due && due.getTime() < now.getTime()) {
        overdueRub += amount
        overdueCount += 1
      }
    }

    if (order.isPaid && order.paidAt) {
      const start = order.createdAt ?? null
      if (start) paymentDurations.push(daysBetween(start, order.paidAt))
    }

    const orderDate = order.createdAt ?? order.updatedAt ?? null
    if (orderDate && (!lastOrderAt || orderDate.getTime() > lastOrderAt.getTime())) {
      lastOrderAt = orderDate
    }
  }

  const closed = delivered + cancelled
  const reliabilityPercent = closed > 0 ? Math.round((delivered / closed) * 100) : null
  const avgPaymentDays =
    paymentDurations.length > 0
      ? Math.round(paymentDurations.reduce((sum, value) => sum + value, 0) / paymentDurations.length)
      : null

  return {
    total: orders.length,
    delivered,
    cancelled,
    active,
    revenueRub,
    paidRub,
    unpaidRub,
    overdueRub,
    overdueCount,
    avgPaymentDays,
    reliabilityPercent,
    lastOrderAt,
  }
}

/** Одной строкой — как клиент выглядит в списке. */
export function clientReliabilityLabel(stats: ClientStats): string {
  if (stats.reliabilityPercent === null) return "нет закрытых заказов"
  if (stats.reliabilityPercent >= 90) return "надёжный"
  if (stats.reliabilityPercent >= 70) return "работает, бывают отказы"
  return "часто отказывается"
}
