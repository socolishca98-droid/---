// lib/dates.ts — календарная дата в зоне пользователя, а не в UTC.
//
// Два источника систематической ошибки «на день раньше»:
//
// 1. `date.toISOString().slice(0, 10)` отдаёт дату в UTC. Для Москвы локальное
//    полночь — это 21:00 предыдущего дня по Гринвичу, поэтому ключи дней в
//    отчётах и подписи периодов («27.09» вместо «28.09») уезжали назад.
// 2. `new Date("2026-09-28")` по стандарту читается как полночь UTC. В зонах
//    западнее Гринвича это вечер предыдущего дня: период отчёта начинался на
//    день раньше, а последний день выбранный пользователем терялся целиком.
//
// Здесь — общие правила для обоих случаев. Файл чистый (без Prisma и Next.js):
// его можно импортировать и в серверные роуты, и в клиентские компоненты, и в
// middleware, и проверять тестами без базы.

/** Строгая календарная дата: «2026-09-28». */
export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/** «2026-09-28» из ЛОКАЛЬНЫХ компонентов даты (не UTC, как toISOString). */
export function toLocalDateKey(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ""
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

/**
 * Дата из строки или даты.
 *
 * «2026-09-28» читаем как локальный календарный день (полночь местных суток),
 * полное значение («2026-09-28T14:03:00Z», «2026-09-28T14:03») — как есть.
 * Пусто или мусор — null, чтобы вызывающий код не продолжал с Invalid Date.
 */
export function parseDateValue(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (!trimmed) return null

  if (DATE_KEY_PATTERN.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number)
    const local = new Date(year, month - 1, day)
    // «2026-02-31» JS превратит в март — такое не принимаем
    if (Number.isNaN(local.getTime())) return null
    if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) {
      return null
    }
    return local
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Значение для `<input type="date">` из того, что пришло с сервера.
 * Календарную дату отдаём без пересчёта — иначе input показывал бы день раньше.
 */
export function toDateInputValue(value: string | Date | null | undefined): string {
  if (typeof value === "string" && DATE_KEY_PATTERN.test(value.trim())) return value.trim()
  const date = parseDateValue(value)
  return date ? toLocalDateKey(date) : ""
}
