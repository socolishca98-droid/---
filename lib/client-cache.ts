"use client"

// lib/client-cache.ts
//
// React-обёртка над ядром кеша (lib/client-cache-core.ts).
//
// Главный приём — «показать кеш сразу, обновить в фоне»: если данные уже
// приносили, страница рисуется без спиннера в первом же кадре, а свежие
// значения подставляются, когда придут. Так разделы штаба открываются
// мгновенно при повторном заходе и при переключении вкладок.

import { useCallback, useEffect, useRef, useState } from "react"

import {
  DEFAULT_TTL_MS,
  fetchJsonCached,
  peekCache,
  writeCache,
  type FetchJsonOptions,
} from "@/lib/client-cache-core"

// Реэкспорт ядра: компонентам достаточно одного импорта
export {
  DEFAULT_TTL_MS,
  fetchJsonCached,
  invalidateCache,
  isFresh,
  peekCache,
  writeCache,
} from "@/lib/client-cache-core"

export type AsyncResource<T> = {
  data: T | null
  /** Текст ошибки последней попытки (старые данные при этом сохраняются). */
  error: string | null
  /** Данных нет и идёт первая загрузка — самое время показать скелетон. */
  isLoading: boolean
  /** Данные есть, но идёт тихое обновление. */
  isRevalidating: boolean
  /** Перезапросить (force — мимо кеша). */
  reload: (options?: { force?: boolean }) => Promise<void>
  /** Изменить данные на клиенте сразу (после PATCH) без лишнего запроса. */
  setData: (updater: T | ((previous: T | null) => T | null)) => void
}

/**
 * Данные по адресу с кешем и обновлением в фоне.
 *
 * `url === null` — запрос не нужен (например, фильтр ещё не выбран).
 */
export function useCachedJson<T>(
  url: string | null,
  options: FetchJsonOptions = {},
): AsyncResource<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS

  const cached = url ? peekCache<T>(url) : null
  const [data, setDataState] = useState<T | null>(cached?.data ?? null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(Boolean(url) && cached === null)
  const [isRevalidating, setIsRevalidating] = useState(false)

  // Смена адреса не должна затирать показ: остаёмся на прежних данных, пока
  // не придут новые (иначе вкладки мигали бы пустотой)
  const activeUrl = useRef(url)

  useEffect(() => {
    let alive = true
    activeUrl.current = url

    if (!url) {
      setDataState(null)
      setIsLoading(false)
      return
    }

    const known = peekCache<T>(url)
    if (known) {
      setDataState(known.data)
      setIsLoading(false)
      setIsRevalidating(true)
    } else {
      setIsLoading(true)
      setIsRevalidating(false)
    }
    setError(null)

    void (async () => {
      try {
        const payload = await fetchJsonCached<T>(url, { ttlMs })
        if (!alive || activeUrl.current !== url) return
        setDataState(payload)
        setError(null)
      } catch (caught) {
        if (!alive || activeUrl.current !== url) return
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить данные")
      } finally {
        if (!alive || activeUrl.current !== url) return
        setIsLoading(false)
        setIsRevalidating(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [url, ttlMs])

  const reload = useCallback(
    async (reloadOptions?: { force?: boolean }) => {
      if (!url) return
      try {
        const payload = await fetchJsonCached<T>(url, {
          ttlMs,
          force: reloadOptions?.force,
        })
        if (activeUrl.current !== url) return
        setDataState(payload)
        setError(null)
      } catch (caught) {
        if (activeUrl.current !== url) return
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить данные")
      } finally {
        setIsLoading(false)
        setIsRevalidating(false)
      }
    },
    [url, ttlMs],
  )

  const setData = useCallback(
    (updater: T | ((previous: T | null) => T | null)) => {
      setDataState((previous) => {
        const next =
          typeof updater === "function"
            ? (updater as (value: T | null) => T | null)(previous)
            : updater
        // кеш обновляем тем же значением: иначе при возврате на страницу
        // показалось бы старое состояние
        if (next !== null && activeUrl.current) writeCache(activeUrl.current, next)
        return next
      })
    },
    [],
  )

  return { data, error, isLoading, isRevalidating, reload, setData }
}
