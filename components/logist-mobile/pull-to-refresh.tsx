// components/logist-mobile/pull-to-refresh.tsx
//
// Обновление списка жестом сверху вниз (пункт 1.8 чек-листа).
//
// На телефоне кнопка «Обновить» в углу — лишний тап: привычнее потянуть
// список вниз. Жест слушаем нативно (passive: false), потому что React
// регистрирует touchmove пассивно и preventDefault там не сработает.

"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

/** Порог срабатывания (в пикселях тяги) */
const TRIGGER = 56
/** Максимальная высота «резинки» */
const MAX_PULL = 84

export function PullToRefresh({
  onRefresh,
  children,
  className,
}: {
  /** Что сделать при обновлении (синхронная функция или промис) */
  onRefresh: () => void | Promise<void>
  children: ReactNode
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [distance, setDistance] = useState(0)
  const [busy, setBusy] = useState(false)

  // Значения для обработчиков: они навешиваются один раз и не должны
  // переподключаться на каждый рендер.
  const distanceRef = useRef(0)
  const busyRef = useRef(false)
  const refreshRef = useRef(onRefresh)
  const startYRef = useRef(0)
  const activeRef = useRef(false)

  refreshRef.current = onRefresh
  busyRef.current = busy

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const onTouchStart = (event: TouchEvent) => {
      if (busyRef.current || window.scrollY > 1 || event.touches.length !== 1) {
        activeRef.current = false
        return
      }
      startYRef.current = event.touches[0].clientY
      activeRef.current = true
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!activeRef.current) return
      const delta = event.touches[0].clientY - startYRef.current
      // Тянут вверх или страница уже уехала вниз — это обычная прокрутка.
      if (delta <= 0 || window.scrollY > 1) {
        activeRef.current = false
        setDistance(0)
        return
      }
      // Гасим нативное «обновление страницы» и «резинку» браузера
      if (event.cancelable) event.preventDefault()
      const next = Math.min(delta * 0.5, MAX_PULL)
      distanceRef.current = next
      setDistance(next)
    }

    const finish = () => {
      if (!activeRef.current) return
      activeRef.current = false
      const pulled = distanceRef.current
      distanceRef.current = 0

      if (pulled >= TRIGGER && !busyRef.current) {
        // Индикатор держим видимым, пока не вернулся ответ
        setBusy(true)
        setDistance(TRIGGER)
        Promise.resolve(refreshRef.current())
          .catch(() => undefined)
          .finally(() => {
            // Небольшая задержка, чтобы «крутилка» не мигала впустую
            setTimeout(() => {
              setBusy(false)
              setDistance(0)
            }, 250)
          })
        return
      }

      setDistance(0)
    }

    host.addEventListener("touchstart", onTouchStart, { passive: true })
    host.addEventListener("touchmove", onTouchMove, { passive: false })
    host.addEventListener("touchend", finish)
    host.addEventListener("touchcancel", finish)

    return () => {
      host.removeEventListener("touchstart", onTouchStart)
      host.removeEventListener("touchmove", onTouchMove)
      host.removeEventListener("touchend", finish)
      host.removeEventListener("touchcancel", finish)
    }
  }, [])

  const ready = distance >= TRIGGER

  return (
    <div ref={hostRef} className={className}>
      <div
        className="flex items-center justify-center overflow-hidden text-zinc-400"
        style={{ height: distance }}
        aria-hidden={distance === 0}
      >
        <Loader2
          className={`h-4 w-4 ${busy || ready ? "animate-spin text-orange-400" : ""}`}
          style={{ opacity: Math.min(1, distance / TRIGGER) }}
        />
        <span className="ml-2 text-[12px]" style={{ opacity: Math.min(1, distance / TRIGGER) }}>
          {busy ? "Обновляем…" : ready ? "Отпустите" : "Потяните вниз"}
        </span>
      </div>
      {children}
    </div>
  )
}
