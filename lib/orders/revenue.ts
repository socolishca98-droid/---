// lib/orders/revenue.ts — какие заказы попадают в выручку.
//
// Формула одна на всё приложение: выручка = сумма price по доставленным
// заказам плюс те, что ещё в работе (машина и водитель заняты, деньги
// ожидаются). Отменённые, отклонённые и истёкшие заказы в выручку не идут.
//
// До появления этого файла формула была зашита прямо в /api/dashboard/stats,
// а /api/drivers/locations отдавал в ответе зашитые `revenue: 0` и
// `alerts: 0` — сводка карты показывала ноль рублей при живой работе.
// Теперь набор статусов объявлен один раз, рядом с каноном жизненного цикла
// заказа (lib/orders/stages.ts).

import { OCCUPYING_ORDER_STATUSES, type OrderStatus } from "@/lib/orders/stages"

/** Статусы заказов, сумма которых считается выручкой. */
export const REVENUE_ORDER_STATUSES: readonly OrderStatus[] = [
  ...OCCUPYING_ORDER_STATUSES,
  "delivered",
]

/** Попадает ли статус заказа в выручку. */
export function isRevenueStatus(value: unknown): boolean {
  return typeof value === "string" && (REVENUE_ORDER_STATUSES as readonly string[]).includes(value)
}
