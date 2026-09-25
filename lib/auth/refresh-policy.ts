// lib/auth/refresh-policy.ts
//
// Правила поведения при проверке сессии: когда выходить, а когда подождать.
//
// Зачем отдельный модуль: раньше и кабинет, и мобильный контур на ЛЮБОЙ
// неуспешный ответ считали, что сессии нет, и выбрасывали человека на экран
// входа. Разовый 429 (rate limit), 500 или короткий обрыв сети выглядели как
// «меня разлогинило» — при живой сессии в БД. Здесь это решение собрано в одно
// место и проверяется тестами: выходить можно только тогда, когда сервер прямо
// сказал, что сессии нет.

/** Итог ответа сервера о сессии. */
export type SessionOutcome = "ok" | "unauthorized" | "transient"

/**
 * 401/403 — сессии действительно нет (истекла, отозвана, роль отозвана).
 * 429 и 5xx — сервер не смог ответить: это не повод терять сессию.
 * Прочие 4xx (например 404 при смене контура) тоже считаем «нет сессии»:
 * повторять такой запрос бессмысленно.
 */
export function classifySessionStatus(status: number): SessionOutcome {
  if (status >= 200 && status < 300) return "ok"
  if (status === 401 || status === 403) return "unauthorized"
  if (status === 429 || status >= 500) return "transient"
  return "unauthorized"
}

/** Паузы перед повторами при временной ошибке: 2 с, 5 с, дальше раз в 30 секунд. */
const RETRY_DELAYS_MS = [2000, 5000, 30000]

export function retryDelayMs(attempt: number): number {
  if (attempt < 0) return RETRY_DELAYS_MS[0]
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
}

/** Ответ сервера, который считается успешным и несёт данные сессии. */
export function isSessionPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false
  const data = payload as { success?: boolean; session?: { user?: unknown } }
  return Boolean(data.success && data.session?.user)
}
