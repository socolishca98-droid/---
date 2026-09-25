// lib/client-cache-core.ts
//
// Ядро клиентского кеша GET-запросов — без React, чтобы его можно было
// проверять юнит-тестами (tests/client-cache.test.mjs).
//
// Зачем кеш: страницы штаба заново запрашивали одни и те же справочники
// (машины, водители, клиенты, настройки) при каждом заходе и на каждой смене
// вкладки, показывая спиннер. С кешем второй заход рисуется сразу, а данные
// тихо обновляются в фоне.
//
// Источник истины по-прежнему сервер: кеш живёт в памяти вкладки, в
// localStorage ничего не пишется.

export type CacheEntry = {
  /** Последнее удачно полученное значение (undefined — данных ещё не было). */
  data: unknown
  /** Когда значение получено (мс). */
  at: number
  /** Незавершённый запрос: позволяет не дублировать параллельные вызовы. */
  promise?: Promise<unknown>
}

/** Сколько данные считаются свежими по умолчанию. */
export const DEFAULT_TTL_MS = 60_000

const store = new Map<string, CacheEntry>()

/** Данные из кеша, если они уже были получены (свежесть не проверяется). */
export function peekCache<T>(key: string): { data: T; at: number } | null {
  const entry = store.get(key)
  if (!entry || entry.data === undefined) return null
  return { data: entry.data as T, at: entry.at }
}

/** Свежи ли данные: не старше ttlMs. */
export function isFresh(key: string, ttlMs: number = DEFAULT_TTL_MS): boolean {
  const entry = store.get(key)
  if (!entry || entry.data === undefined) return false
  return Date.now() - entry.at < ttlMs
}

/** Положить готовые данные в кеш (например, после подтверждённого ответа). */
export function writeCache<T>(key: string, data: T, at: number = Date.now()): void {
  store.set(key, { data, at })
}

/**
 * Убрать данные из кеша. Без аргумента чистит всё; со строкой — все ключи,
 * начинающиеся с неё (после изменения заказов вызываем invalidateCache("/api/"))
 */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

/** Только для тестов: размер кеша. */
export function cacheSize(): number {
  return store.size
}

export type FetchJsonOptions = {
  ttlMs?: number
  /** Принудительно сходить в сеть, даже если данные свежие. */
  force?: boolean
}

/**
 * GET JSON с кешем.
 *
 *  * свежие данные отдаются без запроса;
 *  * параллельные вызовы одного адреса склеиваются в один запрос;
 *  * ошибка не кешируется — следующая попытка снова пойдёт в сеть;
 *  * старые данные остаются в кеше до успешного обновления: интерфейс не
 *    мигает пустотой при обрыве сети.
 */
export async function fetchJsonCached<T>(
  key: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS

  if (!options.force && isFresh(key, ttlMs)) {
    return peekCache<T>(key)!.data
  }

  const existing = store.get(key)
  if (existing?.promise) return existing.promise as Promise<T>

  const promise = (async () => {
    try {
      const res = await fetch(key, { cache: "no-store" })
      const payload = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
      } | null

      // Сервер отвечает { success: false, error } на бизнес-ошибках и не-2xx —
      // и то, и другое считаем неудачей, чтобы не показывать пустой список
      if (!res.ok || (payload && payload.success === false)) {
        throw new Error(payload?.error || `Запрос ${key} не удался`)
      }

      writeCache(key, payload)
      return payload as T
    } catch (error) {
      const previous = store.get(key)
      if (previous && previous.data !== undefined) {
        // данные были — оставляем их как последнее известное состояние
        store.set(key, { data: previous.data, at: previous.at })
      } else {
        store.delete(key)
      }
      throw error
    }
  })()

  store.set(key, { data: existing?.data, at: existing?.at ?? 0, promise })
  return promise
}
