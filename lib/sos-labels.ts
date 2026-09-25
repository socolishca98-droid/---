/**
 * Справочник типов SOS-сигналов.
 *
 * Единый источник для мобильного приложения водителя (POST /api/m/sos)
 * и штабных экранов логиста (GET/PATCH /api/sos) — раньше метки жили
 * внутри одного из роутов и были недоступны второму.
 */

export const SOS_LABELS: Record<string, string> = {
  accident: "🚨 ДТП / Авария",
  breakdown: "🔧 Поломка ТС",
  medical: "🏥 Проблемы со здоровьем",
  robbery: "🚔 Ограбление / Угроза",
  cargo: "📦 Проблема с грузом",
  other: "⚠️ Другая ситуация",
}

export const SOS_TYPES = [
  "accident",
  "breakdown",
  "medical",
  "robbery",
  "cargo",
  "other",
] as const

export type SosType = (typeof SOS_TYPES)[number]

export const SOS_STATUSES = ["active", "responding", "resolved", "false_alarm"] as const
export type SosStatus = (typeof SOS_STATUSES)[number]

export function sosLabel(type: string): string {
  return SOS_LABELS[type] || type
}
