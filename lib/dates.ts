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

/**
 * ISO-8601 дата со временем: «2026-09-28T21:00:00.000Z», «2026-09-28 21:00»,
 * «2026-09-28T21:00+03:00».
 *
 * Всё, что не похоже ни на календарную дату, ни на ISO-момент, не принимается.
 * Иначе `new Date("05.10.2026")` молча превращается в 10 мая (V8 читает такую
 * строку как MM.DD.YYYY), и в базе оказывается срок на пять месяцев раньше
 * выбранного — без единой ошибки в логах.
 */
export const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/

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
 * Пусто, мусор и «05.10.2026» — null, чтобы вызывающий код не продолжал ни с
 * Invalid Date, ни с молча перетолкованным днём.
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

  // Не ISO и не календарная дата — не угадываем («05.10.2026», «пятница»)
  if (!ISO_DATETIME_PATTERN.test(trimmed)) return null

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

/** Начало местных суток (00:00:00.000). */
export function startOfLocalDay(value: Date): Date {
  const copy = new Date(value)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/** Конец местных суток (23:59:59.999) — граница «по этот день включительно». */
export function endOfLocalDay(value: Date): Date {
  const copy = new Date(value)
  copy.setHours(23, 59, 59, 999)
  return copy
}

/**
 * «28.09.2026» — календарная дата в зоне пользователя.
 *
 * Отличается от `new Date(value).toLocaleDateString(…)`: строку «2026-09-28»
 * читает как местный день, а не как полночь UTC (иначе в зонах западнее
 * Гринвича дата показывалась на день раньше). Пусто и мусор — пустая строка.
 */
export function formatLocalDate(
  value: string | Date | null | undefined,
  locale = "ru-RU",
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = parseDateValue(value)
  if (!date) return ""
  return options ? date.toLocaleDateString(locale, options) : date.toLocaleDateString(locale)
}
