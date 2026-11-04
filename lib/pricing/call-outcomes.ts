// lib/pricing/call-outcomes.ts
//
// Шесть исходов звонка «Уточнить стоимость».
//
// Список живёт отдельным файлом, потому что нужен и серверу (проверка
// значения), и экрану (подписи кнопок). Серверный модуль тянет Prisma, а
// клиентский компонент — нет: держим чистое определение в одном месте, чтобы
// формулировки на экране и в базе не разъезжались.

export type CallOutcome =
  | "confirmed"
  | "proposed_other"
  | "refused"
  | "undecided"
  | "no_answer"
  | "callback"

export const CALL_OUTCOMES: Array<{ value: CallOutcome; label: string }> = [
  { value: "confirmed", label: "Стоимость подтверждена" },
  { value: "proposed_other", label: "Предложена другая стоимость" },
  { value: "refused", label: "Перевозчик отказался" },
  { value: "undecided", label: "Заказчик ещё не определился" },
  { value: "no_answer", label: "Не удалось дозвониться" },
  { value: "callback", label: "Требуется повторный звонок" },
]

/** Исходы, после которых в базе появляется согласованная сумма. */
export const AMOUNT_OUTCOMES: CallOutcome[] = ["confirmed", "proposed_other"]

export function callOutcomeLabel(value: string): string {
  return CALL_OUTCOMES.find((item) => item.value === value)?.label ?? value
}
