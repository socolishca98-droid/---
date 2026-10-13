// lib/polling.ts
//
// Адаптивный опрос сервера: когда стоит спрашивать, когда — помолчать.
//
// Зачем: чат опрашивался раз в 5 секунд всегда — даже если вкладка закрыта
// (браузер будит телефон и сажает батарею) и даже если сервер лежит (тогда
// опросы только добивают его). Правило простое:
//   * вкладка скрыта или нет сети — не опрашиваем вовсе;
//   * после ошибки — интервал растёт вдвое, до потолка;
//   * после успеха — возвращаемся к обычному интервалу.
//
// Математика отделена от браузера: её видно в тестах, а в хуке только таймеры.

export interface PollingConditions {
  /** Вкладка видима (document.visibilityState === "visible") */
  visible: boolean
  /** Есть сеть (navigator.onLine) */
  online: boolean
  /** Сколько опросов подряд завершились ошибкой */
  failures: number
}

export interface PollingOptions {
  /** Интервал в обычном режиме, мс */
  baseMs?: number
  /** Потолок после ошибок, мс */
  maxMs?: number
  /** Во сколько раз растёт интервал после каждой ошибки */
  factor?: number
}

const DEFAULTS = { baseMs: 5000, maxMs: 60_000, factor: 2 }

/**
 * Через сколько миллисекунд делать следующий опрос.
 * `null` — опрос выключен: вкладка скрыта или сети нет.
 */
export function nextPollDelay(
  conditions: PollingConditions,
  options: PollingOptions = {},
): number | null {
  const { baseMs, maxMs, factor } = { ...DEFAULTS, ...options }

  if (!conditions.visible || !conditions.online) return null

  const failures = Math.max(0, Math.floor(conditions.failures))
  if (failures === 0) return baseMs

  const grown = baseMs * Math.pow(factor, failures)
  return Math.min(maxMs, Math.round(grown))
}

/** Подпись для интерфейса: почему опрос молчит. */
export function pollingStatusLabel(conditions: PollingConditions): string | null {
  if (!conditions.online) return "Нет сети — сообщения подтянутся, когда связь вернётся"
  if (!conditions.visible) return "Чат на паузе: вкладка скрыта"
  if (conditions.failures > 0) return "Сервер не отвечает — повторяем реже"
  return null
}
