// hooks/use-adaptive-polling.ts
//
// Опрос с адаптивным интервалом.
//
// Обычный setInterval опрашивает сервер всегда: и когда вкладка закрыта, и
// когда сервер уже упал. Этот хук:
//   * молчит, пока вкладка скрыта или нет сети;
//   * опрашивает сразу, когда вкладка снова видима (чат выглядит живым);
//   * замедляется вдвое после каждой ошибки, до потолка, и возвращается
//     к обычному темпу после успеха.
//
// Математика интервалов — в lib/polling.ts, здесь только таймеры и события
// браузера.

"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { nextPollDelay, pollingStatusLabel, type PollingConditions } from "@/lib/polling"

export interface UseAdaptivePollingOptions {
  /** Интервал в обычном режиме, мс (по умолчанию 5000) */
  baseMs?: number
  /** Потолок после ошибок, мс (по умолчанию 60000) */
  maxMs?: number
  /** Начинать опрос сразу при монтировании (по умолчанию true) */
  immediate?: boolean
}

export interface AdaptivePolling {
  /** Вызвать опрос прямо сейчас (после отправки сообщения, при возврате на вкладку) */
  pollNow: () => void
  /** Условия опроса — можно показать причину паузы в интерфейсе */
  conditions: PollingConditions
  /** Готовая подпись причины паузы или null */
  statusLabel: string | null
}

export function useAdaptivePolling(
  task: () => void | Promise<void>,
  options: UseAdaptivePollingOptions = {},
): AdaptivePolling {
  const { baseMs = 5000, maxMs = 60_000, immediate = true } = options

  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  )
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  )
  const [failures, setFailures] = useState(0)

  const failuresRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taskRef = useRef(task)
  taskRef.current = task

  const conditions: PollingConditions = { visible, online, failures }

  // ── События браузера ───────────────────────────────────────────────────
  useEffect(() => {
    const onVisibility = () => {
      const isVisible = document.visibilityState !== "hidden"
      setVisible(isVisible)
      // Возврат на вкладку — сразу свежие данные, без ожидания таймера
      if (isVisible) {
        failuresRef.current = 0
        setFailures(0)
        void taskRef.current()
      }
    }
    const onOnline = () => {
      setOnline(true)
      void taskRef.current()
    }
    const onOffline = () => setOnline(false)

    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)

    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [])

  // ── Цепочка таймеров ───────────────────────────────────────────────────
  useEffect(() => {
    const delay = nextPollDelay({ visible, online, failures: failuresRef.current }, { baseMs, maxMs })

    if (delay === null) {
      // Пауза: ждём события, а не крутим таймер вхолостую
      return
    }

    timerRef.current = setTimeout(() => {
      void (async () => {
        try {
          await taskRef.current()
          // Успех — сбрасываем замедление
          if (failuresRef.current !== 0) {
            failuresRef.current = 0
            setFailures(0)
          }
        } catch {
          // Ошибка — следующий интервал вдвое больше
          failuresRef.current += 1
          setFailures(failuresRef.current)
        }
      })()
    }, delay)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [visible, online, failures, baseMs, maxMs])

  // Первый опрос — сразу, не ждём интервал
  useEffect(() => {
    if (!immediate) return
    void (async () => {
      try {
        await taskRef.current()
      } catch {
        failuresRef.current += 1
        setFailures(failuresRef.current)
      }
    })()
    // только при монтировании: дальше цепочку ведёт эффект выше
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pollNow = useCallback(() => {
    failuresRef.current = 0
    setFailures(0)
    void (async () => {
      try {
        await taskRef.current()
      } catch {
        failuresRef.current += 1
        setFailures(failuresRef.current)
      }
    })()
  }, [])

  return { pollNow, conditions, statusLabel: pollingStatusLabel(conditions) }
}
