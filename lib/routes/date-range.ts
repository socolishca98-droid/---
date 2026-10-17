// lib/routes/date-range.ts
// Период для выборки рейсов (история): разбор query-параметров и условие для БД.
//
// Чистые функции без Prisma и Next — их можно проверять тестами напрямую.
// Зачем модуль, а не функция внутри route.ts: в роуте Next.js разрешены только
// известные экспорты (HTTP-методы, dynamic, revalidate…), а разбор дат нужно
// и протестировать, и переиспользовать.

/** Граница периода: ok=false — параметр есть, но это не дата. */
export type DateParamResult = { ok: true; value: Date | null } | { ok: false }

/**
 * Граница периода из query: «YYYY-MM-DD» или полный ISO-дата.
 * Конец дня (endOfDay) дописывает 23:59:59.999 — иначе «по 17.10» отсекало бы
 * весь 17-ый день и период «за неделю» терял бы сегодняшние рейсы.
 */
export function parseDateParam(raw: string | null | undefined, endOfDay: boolean): DateParamResult {
  const value = (raw ?? "").trim()
  if (!value) return { ok: true, value: null }
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`
    : value
  const date = new Date(iso)
  // new Date("32.01.2026") даёт Invalid Date, но new Date("2026") — не ошибка,
  // поэтому проверяем ещё и год: periodo из одной цифры — это не период.
  if (Number.isNaN(date.getTime())) return { ok: false }
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) && !/^\d{4}-\d{2}-\d{2}T/.test(value)) return { ok: false }
  return { ok: true, value: date }
}

/**
 * Условие периода для where: рейс попадает в выборку, если закрылся в период,
 * а у отменённого рейса даты завершения может не быть — тогда смотрим на дату
 * создания, иначе отменённые выпадали бы из истории по периоду совсем.
 */
export function routePeriodWhere(
  from: Date | null,
  to: Date | null,
): Record<string, unknown> | null {
  if (!from && !to) return null
  const range: Record<string, unknown> = {}
  if (from) range.gte = from
  if (to) range.lte = to
  return { OR: [{ completedAt: range }, { completedAt: null, createdAt: range }] }
}
