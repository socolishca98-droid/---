// lib/routes/complete-policy.ts
//
// Чистая политика идемпотентного завершения рейса (этап «сохранность данных»).
// Без Prisma — тестируется отдельно.
//
// Правило: повторный вызов завершения для уже завершённого рейса — no-op.
// Не переписываем completedAt, не пересчитываем топливо и итоги, не создаём
// новых событий. Защита от двух одновременных запросов обеспечивается в
// lib/routes/complete-route.ts условным обновлением внутри транзакции
// (UPDATE ... WHERE status <> 'completed'), а здесь — только решение.

export type RouteCompletionDecision =
  | { kind: "noop"; reason: string }
  | { kind: "complete" }

/** Нормализованный статус рейса: канон — lib/routes/model.ts. */
export function normalizeRouteStatusLoose(
  value: string | null | undefined,
): string {
  const status = String(value ?? "").trim()
  if (status === "in_progress") return "in_transit" // историческое значение
  return status
}

export function decideRouteCompletion(input: {
  status: string | null | undefined
}): RouteCompletionDecision {
  const status = normalizeRouteStatusLoose(input.status)
  if (status === "completed") {
    return {
      kind: "noop",
      reason:
        "Рейс уже завершён — повторное завершение ничего не меняет (время финиша, топливо и итоги сохранены).",
    }
  }
  return { kind: "complete" }
}
