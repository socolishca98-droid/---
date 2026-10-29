// lib/orders/route-link.ts
//
// Заказ, который уже едет, но не привязан ни к одному рейсу.
//
// Проверка приёмки: логист доводил заказ до «Отправить в рейс», статус менялся,
// а водитель не получал ничего — приложение водителя показывает точки рейса из
// Route, а заказ оставался с пустым routeId. Кнопка обещала «появится у
// водителя», и обещание не выполнялось.
//
// Здесь только решение (чистая функция, её проверяют тесты); создание рейса —
// в обработчике PATCH /api/orders/[id].

import { CLOSED_ORDER_STATUSES, normalizeOrderStatus } from "./stages"

/** Статусы, в которых заказ уже считается едущим: водитель должен его видеть. */
export const TRIP_STATUSES = ["in_route", "documents", "assigned", "control"] as const

export interface RouteLinkInput {
  status: string | null | undefined
  assignedDriverId?: string | null
  routeId?: string | null
}

/**
 * Нужен ли заказу собственный рейс.
 *
 * Да — если заказ в едущем статусе, у него есть водитель и он ещё ни в одном
 * рейсе. Нет — если он закрыт, без водителя (некому ехать) или уже привязан.
 */
export function needsOwnRoute(order: RouteLinkInput): boolean {
  const status = normalizeOrderStatus(order.status)
  if (!status) return false
  if ((CLOSED_ORDER_STATUSES as readonly string[]).includes(status)) return false
  if (!(TRIP_STATUSES as readonly string[]).includes(status)) return false
  if (order.routeId) return false
  return Boolean(order.assignedDriverId)
}

/**
 * Можно ли перевести заказ в «Назначен» — то есть передать работу водителю.
 *
 * Без водителя переводить нечего: заказ повиснет в статусе, где «машина в
 * пути», а ехать некому и в приложении водителя пусто.
 */
export function canAssignToDriver(input: {
  nextStatus: string | null | undefined
  driverId?: string | null
}): boolean {
  const status = normalizeOrderStatus(input.nextStatus)
  if (status !== "assigned") return true
  return Boolean(input.driverId)
}
