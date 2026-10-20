// lib/orders/archive-policy.ts
//
// Чистая политика: что делать с заказом, когда пришёл DELETE (этап
// «сохранность данных»). Без Prisma и без Next — чтобы правило можно было
// тестировать и менять, не трогая обработчик.
//
// Правила (согласованы с владельцем продукта):
//   1. Оплаченный или доставленный заказ удалять нельзя — 409 с текстом,
//      предлагающим архив. Деньги и факт доставки не должны исчезать.
//   2. Если у заказа есть история (переговоры, расходы, фото) — не удаляем,
//      а архивируем: запись уходит из рабочих списков, но остаётся в деньгах.
//   3. Полностью «чистый» заказ (создан по ошибке, без следов) — удаляем
//      физически, как раньше.

export type OrderHistoryCounts = {
  negotiations: number
  expenses: number
  photos: number
  /** Этапы рейсов, ссылающиеся на заказ (RouteStage.orderId, onDelete: SetNull). */
  routeStages?: number
}

export type OrderDeleteDecision =
  | { action: "reject"; reason: string }
  | { action: "archive" }
  | { action: "delete" }

/** Статусы, при которых заказ удалять нельзя: деньги или факт уже есть. */
const UNDELETABLE_STATUSES = ["delivered"] as const

export function decideOrderDeletion(order: {
  status: string | null | undefined
  isPaid?: boolean | null
  history?: OrderHistoryCounts
}): OrderDeleteDecision {
  if (order.isPaid) {
    return {
      action: "reject",
      reason:
        "Заказ оплачен — удаление невозможно, иначе пропадут платёжные данные. " +
        "Вместо удаления архивируйте заказ: он уйдёт из рабочих списков, но останется в отчётах для бухгалтерии.",
    }
  }

  const status = String(order.status ?? "")
  if ((UNDELETABLE_STATUSES as readonly string[]).includes(status)) {
    return {
      action: "reject",
      reason:
        "Заказ доставлен — удаление невозможно, иначе исчезнет история доставки. " +
        "Вместо удаления архивируйте заказ: он уйдёт из рабочих списков, но останется в отчётах.",
    }
  }

  const history = order.history
  const hasHistory =
    !!history &&
    (history.negotiations > 0 ||
      history.expenses > 0 ||
      history.photos > 0 ||
      // Заказ в рейсе: RouteStage.orderId привязан onDelete: SetNull — физическое
      // удаление оставит этап рейса без заказа (погрузка/выгрузка без груза).
      // Такой заказ тоже архивируем, а не удаляем.
      (history.routeStages ?? 0) > 0)

  return hasHistory ? { action: "archive" } : { action: "delete" }
}

/** Можно ли снять архив (вернуть заказ в работу). */
export function canRestoreOrder(order: {
  archivedAt?: Date | string | null
}): boolean {
  return order.archivedAt != null
}
