// lib/pagination.ts
//
// Одна pagination на все списки.
//
// Зачем: часть эндпоинтов молча брала «take: 100» или вообще не ограничивала
// выборку. Пользователь видел 100 строк и не знал, что есть ещё сто; а список
// водителей с вложенными заказами и фото рос без предела и тормозил страницу.
//
// Правило проекта: список ВСЕГДА отдаёт pageSize, offset и total — тогда
// интерфейс может честно написать «показано 50 из 340» и показать «ещё».
//
// Функции чистые: их можно проверить без базы и вызывать из любого роута.

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

export interface Pagination {
  /** Сколько строк вернуть */
  limit: number
  /** Сколько пропустить */
  offset: number
  /** Номер страницы, начиная с 1 (для интерфейса) */
  page: number
  /** Размер страницы после ограничений */
  pageSize: number
}

export interface PaginationParams {
  /** Поддержка page/pageSize (как в /api/auth/users) */
  page?: string | null
  pageSize?: string | null
  /** Поддержка limit/offset (как в /api/orders) */
  limit?: string | null
  offset?: string | null
}

function positiveInt(value: string | null | undefined, fallback: number): number | null {
  if (value == null || value === "") return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

/**
 * Разбор параметров страницы. Некорректные значения не роняют запрос:
 * подставляются значения по умолчанию, размер страницы зажимается сверху.
 */
export function parsePagination(
  params: PaginationParams,
  options: { defaultSize?: number; maxSize?: number } = {},
): Pagination {
  const defaultSize = options.defaultSize ?? DEFAULT_PAGE_SIZE
  const maxSize = options.maxSize ?? MAX_PAGE_SIZE

  const limit =
    positiveInt(params.limit, 0) ?? positiveInt(params.pageSize, 0) ?? defaultSize
  const safeLimit = Math.min(maxSize, Math.max(1, limit))

  // page без offset — обычная постраничка: смещение = (страница − 1) × размер
  const page = positiveInt(params.page, 0) ?? 1
  const fromPage = (page - 1) * safeLimit
  const safeOffset = Math.max(0, positiveInt(params.offset, 0) ?? fromPage)

  return {
    limit: safeLimit,
    offset: safeOffset,
    page: Math.floor(safeOffset / safeLimit) + 1,
    pageSize: safeLimit,
  }
}

export interface PaginationMeta {
  /** Всего строк по фильтру (без ограничений) */
  total: number
  /** Сколько строк в этом ответе */
  shown: number
  limit: number
  offset: number
  page: number
  pageSize: number
  /** Есть ли ещё строки после этой порции */
  hasMore: boolean
}

/** Мета для ответа: по ней интерфейс рисует «показано N из M» и кнопку «ещё». */
export function paginationMeta(total: number, pagination: Pagination, shown?: number): PaginationMeta {
  const actualShown = shown ?? Math.min(pagination.limit, Math.max(0, total - pagination.offset))
  return {
    total,
    shown: actualShown,
    limit: pagination.limit,
    offset: pagination.offset,
    page: pagination.page,
    pageSize: pagination.pageSize,
    hasMore: pagination.offset + actualShown < total,
  }
}

/** «показано 50 из 340» — коротко, как в интерфейсе. */
export function paginationLabel(meta: PaginationMeta): string {
  if (meta.total <= meta.shown) return `всего ${meta.total}`
  return `показано ${meta.shown} из ${meta.total}`
}
