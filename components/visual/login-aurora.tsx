"use client"

// components/visual/login-aurora.tsx
//
// ⚠ НЕ ПОДКЛЮЧЁН: экран входа использует components/visual/login-scene.tsx
// (кинематографичный 3D-коридор). Файл оставлен как работающий запасной
// вариант — можно удалить после приёмки новой сцены.
//
// Канвас-слой экрана входа, версия 2 — «сдержанно-премиально» с настоящей
// глубиной (просьба владельца: 3D-вкус и живой отклик на ввод данных).
//
// Картина (дальний план → ближний):
//  1. «Полярное сияние» — три мягких цветовых пятна, дрейф по синусоиде;
//  2. Пыль — разреженные мелкие частицы по всему экрану (глубина фона);
//  3. Сфера-«сеть логистики» — 3D-облако точек, медленно вращается вокруг
//     вертикальной оси с перспективной проекцией: дальние точки мельче и
//     тусклее, ближние — крупнее и ярче. Сфера стоит за центром карточки
//     входа и просвечивает сквозь её матовое стекло (backdrop-blur).
//
// Отклик на ввод — главная просьба владельца: каждый удар по клавише в
// поле входа — это энергия. Сфера ускоряет вращение, точки разгораются,
// связи наливаются цветом, и от карточки расходится кольцо-импульс.
// Слушаем событие "input" на документе и НЕ читаем значений полей:
// что именно печатает человек, канвасу неизвестно и не нужно.
//
// Экономия: 30 кадров/с, DPR ≤ 2, на узких экранах точек меньше,
// скрытая вкладка — пауза, prefers-reduced-motion — один статичный кадр
// (без цикла и без отклика: движение человек отключил сам).

import { useEffect, useRef } from "react"

const FRAME_MS = 1000 / 30
const MAX_DPR = 2
const ORB_PARTICLES_WIDE = 88
const ORB_PARTICLES_NARROW = 56
const DUST_COUNT = 26
const LINK_PX = 92
const RIPPLE_MS = 900

/** Мягкое цветовое пятно («сияние»), которое медленно плывёт по фону. */
type AuroraBlob = {
  rgb: readonly [number, number, number]
  radius: number
  cx: number
  cy: number
  ampX: number
  ampY: number
  speed: number
  phase: number
  alpha: number
}

const BLOBS: readonly AuroraBlob[] = [
  { rgb: [56, 130, 246], radius: 0.85, cx: 0.18, cy: 0.16, ampX: 0.09, ampY: 0.07, speed: 0.03, phase: 0, alpha: 0.1 },
  { rgb: [245, 158, 11], radius: 0.7, cx: 0.86, cy: 0.88, ampX: 0.08, ampY: 0.09, speed: 0.021, phase: 2.1, alpha: 0.06 },
  { rgb: [99, 102, 241], radius: 0.9, cx: 0.72, cy: 0.12, ampX: 0.11, ampY: 0.08, speed: 0.016, phase: 4.2, alpha: 0.07 },
]

type OrbPoint = { x: number; y: number; z: number; size: number; rgb: string }
type Dust = { x: number; y: number; vx: number; vy: number; r: number; rgb: string }
type Ripple = { x: number; y: number; t0: number }

const COLORS = ["148, 163, 184", "56, 189, 248", "99, 102, 241", "251, 191, 36"]

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

export function LoginAurora(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduced = prefersReducedMotion()
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)

    let width = 0
    let height = 0
    let raf = 0
    let last = 0
    let angle = 0
    let energy = 0
    let frameNo = 0
    let orb: OrbPoint[] = []
    let dust: Dust[] = []
    let ripples: Ripple[] = []
    let orbR = 0
    let cardX = 0
    let cardY = 0

    const seed = () => {
      const narrow = width < 640
      const count = narrow ? ORB_PARTICLES_NARROW : ORB_PARTICLES_WIDE
      orbR = Math.min(width, height) * (narrow ? 0.34 : 0.32)
      orb = Array.from({ length: count }, () => {
        // 72% точек — близко к поверхности сферы (читается «оболочка»),
        // остальные — внутри: сфера получается объёмной, а не полой
        const onShell = Math.random() < 0.72
        const r = onShell ? orbR * (0.9 + Math.random() * 0.18) : orbR * Math.random() * 0.85
        const u = Math.random() * 2 - 1
        const th = Math.random() * Math.PI * 2
        const rr = Math.sqrt(1 - u * u)
        return {
          x: rr * Math.cos(th) * r * 1.14,
          y: rr * Math.sin(th) * r * 0.94,
          z: u * r,
          size: 0.7 + Math.random() * 1.3,
          rgb: COLORS[Math.floor(Math.random() * COLORS.length)],
        }
      })
      dust = Array.from({ length: DUST_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: 0.6 + Math.random() * 0.9,
        rgb: COLORS[Math.floor(Math.random() * COLORS.length)],
      }))
    }

    /** Центр карточки входа — там стоит сфера и оттуда расходятся импульсы. */
    const measureCard = () => {
      const form = document.querySelector("form")
      if (!form) {
        cardX = width / 2
        cardY = height / 2
        return
      }
      const rect = form.getBoundingClientRect()
      cardX = rect.left + rect.width / 2
      cardY = rect.top + rect.height / 2
    }

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
      measureCard()
    }

    // Постоянный лёгкий наклон оси вращения — сфера видна «сверху-сбоку»
    const TILT = 0.16
    const sinTilt = Math.sin(TILT)
    const cosTilt = Math.cos(TILT)

    const draw = (t: number, dt: number, nowMs: number) => {
      ctx.clearRect(0, 0, width, height)

      // 1. Сияние
      ctx.globalCompositeOperation = "lighter"
      const min = Math.min(width, height) || 1
      for (const b of BLOBS) {
        const x = (b.cx + Math.sin(t * b.speed + b.phase) * b.ampX) * width
        const y = (b.cy + Math.cos(t * b.speed * 0.8 + b.phase) * b.ampY) * height
        const r = b.radius * min
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
        gradient.addColorStop(0, `rgba(${b.rgb[0]}, ${b.rgb[1]}, ${b.rgb[2]}, ${b.alpha})`)
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)")
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = "source-over"

      // 2. Пыль
      for (const d of dust) {
        d.x += d.vx
        d.y += d.vy
        if (d.x < -12) d.x = width + 12
        if (d.x > width + 12) d.x = -12
        if (d.y < -12) d.y = height + 12
        if (d.y > height + 12) d.y = -12
        ctx.fillStyle = `rgba(${d.rgb}, 0.3)`
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fill()
      }

      // 3. Сфера: вращение ускоряется энергией ввода
      angle += dt * (0.05 + Math.min(1, energy) * 0.3)
      energy *= 0.96

      const sinY = Math.sin(angle)
      const cosY = Math.cos(angle)
      const fov = orbR * 3.4
      const projected = orb.map((p) => {
        const x1 = p.x * cosY + p.z * sinY
        const z1 = -p.x * sinY + p.z * cosY
        const y2 = p.y * cosTilt - z1 * sinTilt
        const z2 = p.y * sinTilt + z1 * cosTilt
        const persp = fov / (fov + z2)
        return { x: cardX + x1 * persp, y: cardY + y2 * persp, persp, size: p.size, rgb: p.rgb }
      })
      // дальние точки рисуем первыми — ближние ложатся поверх
      projected.sort((a, b) => a.persp - b.persp)

      const bright = 0.78 + Math.min(1, energy) * 0.55

      // связи между близкими (на экране) точками
      for (let i = 0; i < projected.length; i += 1) {
        const a = projected[i]
        for (let j = i + 1; j < projected.length; j += 1) {
          const b = projected[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 > LINK_PX * LINK_PX) continue
          const depth = Math.min(a.persp, b.persp)
          const alpha = 0.13 * (1 - Math.sqrt(d2) / LINK_PX) * depth * bright
          ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`
          ctx.lineWidth = 0.6
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      // сами точки: размер и яркость растут с «близостью» к зрителю
      for (const q of projected) {
        const alpha = Math.min(0.95, (0.16 + (q.persp - 0.7) * 0.9) * bright)
        const r = q.size * (0.55 + q.persp * 0.8) * (1 + Math.min(1, energy) * 0.18)
        ctx.fillStyle = `rgba(${q.rgb}, ${alpha})`
        ctx.beginPath()
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2)
        ctx.fill()
      }

      // 4. Кольца-импульсы: отклик на каждый удар клавиши
      ripples = ripples.filter((rp) => nowMs - rp.t0 < RIPPLE_MS)
      for (const rp of ripples) {
        const p = (nowMs - rp.t0) / RIPPLE_MS
        const radius = 26 + p * orbR * 2.1
        ctx.strokeStyle = `rgba(125, 211, 252, ${(1 - p) * 0.22})`
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(rp.x, rp.y, radius, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      if (ts - last < FRAME_MS) return
      const dt = Math.min(0.12, last === 0 ? FRAME_MS / 1000 : (ts - last) / 1000)
      last = ts
      frameNo += 1
      if (frameNo % 60 === 0) measureCard()
      draw(ts / 1000, dt, ts)
    }

    const onResize = () => {
      resize()
      if (reduced) draw(0, 0, performance.now())
    }

    /** Удар по клавише в поле ввода → энергия + импульс от карточки. */
    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA")) return
      energy = Math.min(1.15, energy + 0.42)
      measureCard()
      if (ripples.length < 4) ripples.push({ x: cardX, y: cardY, t0: performance.now() })
    }

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
      } else if (!reduced) {
        last = 0
        raf = requestAnimationFrame(loop)
      }
    }

    resize()
    if (reduced) {
      draw(0, 0, performance.now())
    } else {
      raf = requestAnimationFrame(loop)
      document.addEventListener("input", onInput, { passive: true })
    }
    window.addEventListener("resize", onResize)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibility)
      document.removeEventListener("input", onInput)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}
