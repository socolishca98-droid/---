// lib/reports/period.ts
//
// Границы периода отчёта — одна чистая функция для интерфейса.
// Сервер (/api/reports, /api/reports/export) понимает preset=7d|30d|90d|month|year
// и свои from/to; здесь период переводится в конкретные даты, чтобы кнопки
// экспорта (в том числе платёжный, который принимает только from/to) уходили
// с тем же интервалом, что показывает экран.

export type ReportPeriodPreset = "7d" | "30d" | "90d" | "month" | "year"

export type PeriodBounds = {
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  label: string
}

const PRESET_LABELS: Record<ReportPeriodPreset, string> = {
  "7d": "7 дней",
  "30d": "30 дней",
  "90d": "90 дней",
  month: "Месяц",
  year: "Год",
}

export function presetLabel(preset: ReportPeriodPreset): string {
  return PRESET_LABELS[preset]
}

function isoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function presetBounds(
  preset: ReportPeriodPreset,
  now: Date = new Date(),
): PeriodBounds {
  const to = isoDate(now)
  if (preset === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: isoDate(from), to, label: PRESET_LABELS.month }
  }
  if (preset === "year") {
    const from = new Date(now.getFullYear(), 0, 1)
    return { from: isoDate(from), to, label: PRESET_LABELS.year }
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  return { from: isoDate(from), to, label: PRESET_LABELS[preset] }
}
