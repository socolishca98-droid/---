// hooks/use-json-api.ts
//
// Минимальный клиент для мобильных экранов: GET с повторами и мутации.
//
// Почему не SWR/react-query: в проекте их нет, а тянуть библиотеку ради
// четырёх экранов — лишний вес бандла. Зато здесь есть то, что реально нужно
// на телефоне: повтор при обрыве сети (мобильный интернет рвётся постоянно)
// и понятная ошибка вместо бесконечного скелетона.
//
// Важно про медленную связь: одновременные запросы не запускаются. Раньше
// опрос раз в 5 секунд отменял ещё не завершившийся запрос (эффект
// перезапускался и «отменял» предыдущий), и на слабой сети экран мог вечно
// показывать скелетоны — в том числе в чате. Теперь новый запрос встаёт в
// очередь и стартует после ответа на текущий.
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export interface JsonApiState<T> {
  data: T | null
  error: string | null
  loading: boolean
  /** Первая загрузка (для скелетонов); при обновлении false */
  firstLoad: boolean
  reload: () => void
}

/** Временная ошибка сети или сервера — есть смысл повторить. */
function isTransient(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500
}

export function useJsonApi<T>(url: string | null): JsonApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(url))
  const [tick, setTick] = useState(0)
  const loadedOnce = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Идёт запрос: второй параллельно не запускаем */
  const inFlightRef = useRef(false)
  /** Во время запроса попросили обновление — повторим сразу после ответа */
  const queuedRef = useRef(false)

  const reload = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    if (!url) {
      setLoading(false)
      return
    }

    // Скелетон только на первой загрузке: при обновлении данные уже на
    // экране, и подменять их заглушками нельзя (иначе «мигает»).
    if (!loadedOnce.current) setLoading(true)

    let cancelled = false
    let attempt = 0

    const finish = () => {
      inFlightRef.current = false
      if (!cancelled) {
        loadedOnce.current = true
        setLoading(false)
      }
      // Пока шёл запрос, могли попросить обновление (жест «потянуть вниз»
      // или опрос чата) — выполняем его одним дополнительным заходом.
      if (queuedRef.current) {
        queuedRef.current = false
        setTick((value) => value + 1)
      }
    }

    if (inFlightRef.current) {
      queuedRef.current = true
      return () => {
        cancelled = true
      }
    }

    inFlightRef.current = true

    const load = async (): Promise<void> => {
      // Пока идёт повтор после временной ошибки, экран не должен показывать
      // пустые данные как окончательные: держим скелетон до ответа.
      let retryScheduled = false
      try {
        const res = await fetch(url, { cache: "no-store", credentials: "include" })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          const message = (body as { error?: string }).error || `Ошибка ${res.status}`
          if (isTransient(res.status) && attempt < 2) {
            attempt += 1
            throw new Error(`${message}||retry`)
          }
          throw new Error(message)
        }

        const json = (await res.json()) as T
        if (cancelled) return
        setData(json)
        setError(null)
      } catch (caught) {
        if (cancelled) return
        const raw = caught instanceof Error ? caught.message : "Не удалось загрузить данные"
        // Обрыв сети на телефоне («Failed to fetch») — такой же повод повторить,
        // как и 5xx: без этого экран показывал ошибку при мигании связи.
        const networkFailure = caught instanceof TypeError
        if (raw.endsWith("||retry") || (networkFailure && attempt < 2)) {
          attempt += 1
          if (timerRef.current) clearTimeout(timerRef.current)
          retryScheduled = true
          timerRef.current = setTimeout(() => {
            void load()
          }, 1200 * (attempt + 1))
          return
        }
        setError(
          networkFailure ? "Нет соединения. Проверьте интернет и повторите." : raw.replace("||retry", ""),
        )
      } finally {
        // Ошибка уже показана, повтор запланирован — иначе закрываем запрос:
        // скелетон гасим, очередь проверяем.
        if (!retryScheduled) finish()
      }
    }

    void load()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [url, tick])

  return { data, error, loading, firstLoad: loading && !loadedOnce.current, reload }
}

export interface ApiMutationResult<T> {
  ok: boolean
  data?: T
  error?: string
}

/**
 * Мутация (POST/PATCH/DELETE). CSRF-заголовок подставляет глобальный
 * CsrfProvider (components/csrf-provider.tsx), поэтому здесь о нём думать не нужно.
 */
export async function apiSend<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<ApiMutationResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    const json = (await res.json().catch(() => ({}))) as { error?: string } & T

    if (!res.ok) {
      return { ok: false, error: json?.error || `Ошибка ${res.status}` }
    }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, error: "Нет соединения. Проверьте интернет и повторите." }
  }
}
