"use client"

// components/visual/animated-number.tsx
//
// Число, которое «докручивается»: при смене значения плавно проходит от
// старого к новому (rAF, ~700 мс, easeOutCubic). Первый рендер отчёт
// идёт от нуля — статистика на дашборде «оживает» при открытии, а при
// обновлении данных (раз в 15 секунд) видно, ЧТО изменилось и в какую
// сторону, а не просто мгновенная подмена цифры.
//
// prefers-reduced-motion — без анимации: значение показывается сразу.

import { useEffect, useRef, useState } from "react"

const DURATION_MS = 700

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number
  /** Как превратить промежуточное число в показываемый текст */
  format?: (value: number) => string
  className?: string
}) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!Number.isFinite(value)) {
      setDisplay(value)
      fromRef.current = Number.isFinite(value) ? value : 0
      return
    }
    if (prefersReducedMotion()) {
      fromRef.current = value
      setDisplay(value)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    cancelAnimationFrame(rafRef.current)
    const step = (ts: number) => {
      const t = Math.min(1, (ts - start) / DURATION_MS)
      setDisplay(from + (value - from) * easeOutCubic(t))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        fromRef.current = value
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value])

  const text = format ? format(display) : Math.round(display).toString()
  return <span className={className}>{text}</span>
}
