"use client"

// components/visual/tilt-3d.tsx
//
// Карточка входа как ОБЪЕКТ ВНУТРИ 3D-сцены (просьба владельца: «форма
// прямо внутри сцены, чтобы всё плавало внутри анимации»).
//
// Раньше карточка наклонялась к курсору сама по себе — теперь она
// подчиняется КАМЕРЕ СЦЕНЫ (login-scene публикует её в
// window.__loginScene): камера поворачивается — карточка сдвигается и
// чуть доворачивается, как панель, висящая в глубине коридора. На
// телефоне камеру ведёт прокрутка — карточка «плывёт» вместе с ней,
// и форма наконец связана с фоном одним движением.
//
// Плюс парение: мягкий покачивающийся bob и придавливание при разгоне
// (клик/ворп — карточка слегка нарастает, как от встречного ветра).
// Удар по клавише — лёгкое «нажатие» (scale 0.985 с возвратом).
//
// prefers-reduced-motion — карточка неподвижна. Если сцена ещё не
// загрузилась, карточка просто парит на месте (без параллакса).

import { useEffect, useRef } from "react"

const LERP = 0.09
const SCALE_RETURN = 0.16
/** Насколько карточка сдвигается за камерой (px на радиан) */
const PARALLAX_X = 46
const PARALLAX_Y = 30
/** Доворот карточки к камере (градусов на радиан) */
const FACE_Y = 10
const FACE_X = 8

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

type SceneCamera = { yaw: number; pitch: number; speed: number }

export function Tilt3D({ children }: { children: React.ReactNode }): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return

    const current = { tx: 0, ty: 0, rx: 0, ry: 0, s: 1 }
    let keyPress = 1
    let raf = 0

    /** Удар по клавише — карточка «нажимается»; значения полей не читаем */
    const onInput = (event: Event) => {
      const t = event.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        keyPress = 0.985
      }
    }

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      // тестовая пауза (скриншоты приёмки): не пишем transform, пока
      // сцена остановлена — композитор должен успокоиться
      if ((window as Window & { __loginScenePaused?: boolean }).__loginScenePaused === true) {
        return
      }
      const t = ts / 1000
      const scene = (window as Window & { __loginScene?: SceneCamera }).__loginScene
      const yaw = scene?.yaw ?? 0
      const pitch = scene?.pitch ?? 0
      const speed = scene?.speed ?? 0

      // парение: медленный покачивающийся дрейф
      const bob = Math.sin(t * 0.8) * 7
      // разгон (клик/ворп/прилёт) — лёгкий «встречный ветер»
      const lift = Math.min(0.03, Math.max(0, (speed - 200) / 65000))

      keyPress += (1 - keyPress) * SCALE_RETURN
      current.tx += (yaw * PARALLAX_X - current.tx) * LERP
      current.ty += (pitch * PARALLAX_Y + bob - current.ty) * LERP
      current.ry += (-yaw * FACE_Y - current.ry) * LERP
      current.rx += (pitch * FACE_X - current.rx) * LERP
      current.s += (keyPress + lift - current.s) * LERP

      el.style.transform = `perspective(1100px) translate3d(${current.tx.toFixed(1)}px, ${current.ty.toFixed(1)}px, 0) rotateX(${current.rx.toFixed(2)}deg) rotateY(${current.ry.toFixed(2)}deg) scale(${current.s.toFixed(4)})`
    }

    raf = requestAnimationFrame(loop)
    document.addEventListener("input", onInput, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("input", onInput)
    }
  }, [])

  return (
    <div ref={ref} data-tilt="login-card" className="relative will-change-transform">
      {children}
    </div>
  )
}
