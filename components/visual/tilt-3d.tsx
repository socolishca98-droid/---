"use client"

// components/visual/tilt-3d.tsx
//
// 3D-наклон обёртки за курсором мыши или пальцем (просьба владельца:
// «в стиле 3Д»). Карточка входа висит в перспективе и мягко поворачивается
// вслед за указателем; каждый удар по клавише в поле ввода даёт лёгкое
// «нажатие» (масштаб 0.985 с возвратом) — ввод ощущается физически.
//
// Движение сглажено lerp-ом (rAF), значение transform одно — GPU-работа.
// prefers-reduced-motion — обёртка остаётся неподвижной.

import { useEffect, useRef } from "react"

const LERP = 0.09
const SCALE_RETURN = 0.16

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

export function Tilt3D({
  children,
  maxDeg = 5,
}: {
  children: React.ReactNode
  /** Максимальный наклон в градусах */
  maxDeg?: number
}): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return

    const target = { rx: 0, ry: 0, s: 1 }
    const current = { rx: 0, ry: 0, s: 1 }
    let raf = 0

    const onPointer = (cx: number, cy: number) => {
      const nx = cx / window.innerWidth - 0.5
      const ny = cy / window.innerHeight - 0.5
      target.ry = nx * maxDeg
      target.rx = -ny * maxDeg
    }
    // Наклон — за мышью и пером. На телефоне палец листает страницу:
    // карточка, завязанная на touchmove, дёргалась бы при каждой прокрутке
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      onPointer(event.clientX, event.clientY)
    }
    // «Нажатие» карточки на удар клавиши: слушаем input (не keydown),
    // чтобы работало и мобильной клавиатурой с автокоррекцией
    const onInput = (event: Event) => {
      const t = event.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        target.s = 0.985
      }
    }

    const loop = () => {
      raf = requestAnimationFrame(loop)
      target.s += (1 - target.s) * SCALE_RETURN
      current.rx += (target.rx - current.rx) * LERP
      current.ry += (target.ry - current.ry) * LERP
      current.s += (target.s - current.s) * LERP
      el.style.transform = `perspective(1100px) rotateX(${current.rx.toFixed(2)}deg) rotateY(${current.ry.toFixed(2)}deg) scale(${current.s.toFixed(4)})`
    }

    raf = requestAnimationFrame(loop)
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    document.addEventListener("input", onInput, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("input", onInput)
    }
  }, [maxDeg])

  return (
    <div ref={ref} data-tilt="login-card" className="will-change-transform">
      {children}
    </div>
  )
}
