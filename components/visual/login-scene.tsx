"use client"

// components/visual/login-scene.tsx — v3 «Ночная дорога»
//
// Полная смена сцены (просьба владельца: «прямо смена сцены и ракурса,
// и 3Д; всё, что видно глазу — с нуля»). Вместо абстрактного коридора —
// ночной рейс по настоящей дороге:
//
//   • небо с звёздами и тёплым заревом города на горизонте;
//   • дорога в перспективе: разметка и придорожные столбики МЧАТСЯ
//     к камере — скорость читается мгновенно, на любом экране;
//   • над дорогой проплывают порталы-указатели — как дорожные знаки
//     над трассой, с модулями программы («Живая карта», «Маршруты»…);
//   • огни города по сторонам горизонта.
//
// СМЕНА РАКУРСА: на ПК — за курсором; на телефоне — ПАЛЬЦЕМ по сцене
// (верхняя половина экрана — «лобовое стекло», компонент рисует поверх
// него невидимую площадку обзора с touch-none). Дорога уходит к линии
// горизонта в верхней части экрана — движение видно сразу, а не «улетает
// по краям».
//
// Движение: «прилёт» на разгоне при открытии → спокойный полёт;
// каждый клик/тап — рывок; печать — энергия; успешный вход — ворп.
// Техника прежняя: canvas 2D + своя перспектива, без зависимостей.
// Приёмка: window.__loginScene (+ __loginScenePaused для скриншотов,
// __loginSceneLook для площадки обзора).

import { useEffect, useRef } from "react"

const MAX_DPR = 2
const FRAME_MS_WIDE = 0 // ~60 кадров/с на ПК
const FRAME_MS_NARROW = 1000 / 30

const FOV = 620
const GROUND_Y = 200 // дорога «ниже» камеры на 200 условных единиц
const ROAD_HALF = 300
const DRAW_DIST = 5200
const DASH_STEP = 90
const POST_STEP = 150
const GANTRY_STEP = 1700
const GANTRY_COUNT = 6
const GANTRY_DEPTH = GANTRY_STEP * GANTRY_COUNT

const SPEED_BASE = 135
const SPEED_PLUNGE = 2500
const SPEED_WARP = 4800

/** Порталы-указатели над дорогой — модули программы. */
const SIGNS: ReadonlyArray<{ title: string; sub: string }> = [
  { title: "Живая карта", sub: "машины и ETA в реальном времени" },
  { title: "Маршруты OSRM", sub: "плечи и оптимизация" },
  { title: "Биржа грузов", sub: "ATI.SU · Cargomart" },
  { title: "Документы", sub: "статусы рейсов без Excel" },
  { title: "Аналитика", sub: "KPI парка в один экран" },
  { title: "Доступы и роли", sub: "у каждой стороны — своё окно" },
]

type Gantry = { z: number; sign: number; passed: boolean }
type CityLight = { x: number; z: number; rgb: string; size: number; phase: number }
type Star = { x: number; y: number; z: number; size: number; phase: number }
type Ring = { x: number; y: number; t0: number; big: boolean }

type SceneDebug = {
  plunges: number
  warps: number
  yaw: number
  pitch: number
  speed: number
  energy: number
  warp: number
  resets: number
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export function LoginScene(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const padRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduced = prefersReducedMotion()
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)

    let width = 0
    let height = 0
    let narrow = false
    let frameMs = FRAME_MS_WIDE
    let raf = 0
    let last = 0
    let frameNo = 0
    let lastPlungeMs = 0

    // Камера
    const cam = { z: 0 }
    let speed = SPEED_BASE
    let energy = 0
    let fovKick = 0
    let warpT = 0
    // ракурс: мышь (ПК) + палец (телефон, площадка обзора) + базовый наклон
    let yawMouse = 0
    let pitchMouse = 0
    let yawDrag = 0
    let pitchDrag = 0
    let pointer: { x: number; y: number } | null = null

    let gantries: Gantry[] = []
    let lights: CityLight[] = []
    let stars: Star[] = []
    let rings: Ring[] = []
    let lastWarpRing = 0

    const debug: SceneDebug = {
      plunges: 0,
      warps: 0,
      yaw: 0,
      pitch: 0,
      speed: SPEED_BASE,
      energy: 0,
      warp: 0,
      resets: 0,
    }
    const w = window as Window & {
      __loginScene?: SceneDebug
      __loginSceneLook?: (dx: number, dy: number) => void
      __loginScenePaused?: boolean
    }
    w.__loginScene = debug

    const seed = () => {
      debug.resets += 1
      narrow = width < 640
      frameMs = narrow ? FRAME_MS_NARROW : FRAME_MS_WIDE

      gantries = Array.from({ length: GANTRY_COUNT }, (_, i) => ({
        z: 700 + i * GANTRY_STEP,
        sign: i % SIGNS.length,
        passed: false,
      }))

      lights = Array.from({ length: narrow ? 18 : 30 }, () => {
        const warm = Math.random() < 0.45
        return {
          x: (Math.random() < 0.5 ? -1 : 1) * (520 + Math.random() * 2100),
          z: 3200 + Math.random() * 1900,
          rgb: warm ? "251, 191, 36" : "125, 211, 252",
          size: 1 + Math.random() * 1.4,
          phase: Math.random() * Math.PI * 2,
        }
      })

      stars = Array.from({ length: narrow ? 26 : 42 }, () => ({
        x: (Math.random() * 2 - 1) * 2500,
        y: -(350 + Math.random() * 1500),
        z: 2800 + Math.random() * 2400,
        size: 0.6 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
      }))
    }

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
    }

    /** Проекция точки мира (x — вправо, y — ВНИЗ, z — вперёд). */
    const project = (
      x: number,
      y: number,
      z: number,
      sinYaw: number,
      cosYaw: number,
      sinP: number,
      cosP: number,
      fov: number,
    ) => {
      const dz = z - cam.z
      const x1 = x * cosYaw - dz * sinYaw
      const z1 = x * sinYaw + dz * cosYaw
      const y1 = y * cosP - z1 * sinP
      const z2 = y * sinP + z1 * cosP
      const persp = fov / (fov + z2)
      return { sx: width / 2 + x1 * persp, sy: height / 2 + y1 * persp, persp, z2 }
    }

    const draw = (t: number, dt: number, nowMs: number) => {
      ctx.clearRect(0, 0, width, height)

      // ── движение ──
      energy *= Math.exp(-dt * 2.0)
      warpT *= Math.exp(-dt * 2.1)
      if (warpT > 0.05) {
        speed = Math.max(speed, SPEED_WARP)
      } else {
        const target = SPEED_BASE * (1 + Math.min(1.2, energy) * 1.5)
        speed += (target - speed) * Math.min(1, dt * 2.4)
      }
      cam.z += speed * dt
      fovKick *= Math.exp(-dt * 3.0)

      // ── ракурс ──
      // ПК: камера смотрит за курсором; телефон: за пальцем (площадка
      // обзора) + горизонт поднят в «лобовое стекло»
      const yawT = pointer ? -(pointer.x / width - 0.5) * 0.4 : 0
      const pitchT = pointer ? -(pointer.y / height - 0.5) * 0.22 : 0
      yawMouse += (yawT - yawMouse) * Math.min(1, dt * 2.2)
      pitchMouse += (pitchT - pitchMouse) * Math.min(1, dt * 2.2)
      // палец отпустили — ракурс медленно возвращается к дороге
      yawDrag *= Math.exp(-dt * 0.12)
      pitchDrag *= Math.exp(-dt * 0.12)

      const basePitch = narrow ? 0.16 : 0.09
      const swayY = Math.sin(t * 0.13) * 0.02
      const swayP = Math.sin(t * 0.16 + 1.3) * 0.012
      const yaw = yawMouse + yawDrag + swayY
      const pitch = basePitch + pitchMouse + pitchDrag + swayP
      const sinYaw = Math.sin(yaw)
      const cosYaw = Math.cos(yaw)
      const sinP = Math.sin(pitch)
      const cosP = Math.cos(pitch)
      const fov = FOV + fovKick

      // точка схода дороги
      const vpx = width / 2 - fov * Math.tan(yaw)
      const vpy = height / 2 - fov * Math.tan(pitch)

      const bright = 0.85 + Math.min(1.2, energy) * 0.5 + warpT * 1.1
      const P = (x: number, y: number, z: number) => project(x, y, z, sinYaw, cosYaw, sinP, cosP, fov)

      // ── 1. небо ──
      const sky = ctx.createLinearGradient(0, 0, 0, height)
      sky.addColorStop(0, "#05070e")
      sky.addColorStop(0.62, "#0a1122")
      sky.addColorStop(1, "#141d36")
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, width, height)

      // звёзды
      for (const s of stars) {
        const q = P(s.x, s.y, s.z)
        if (q.z2 < 0) continue
        const tw = 0.35 + 0.3 * Math.sin(t * 0.9 + s.phase)
        ctx.fillStyle = `rgba(226, 232, 240, ${tw * q.persp})`
        ctx.beginPath()
        ctx.arc(q.sx, q.sy, s.size, 0, Math.PI * 2)
        ctx.fill()
      }

      // зарево города на горизонте: тёплое + холодное
      ctx.globalCompositeOperation = "lighter"
      const glowR = (narrow ? 300 : 380) + warpT * 300
      const warm = ctx.createRadialGradient(vpx, vpy, 0, vpx, vpy, glowR)
      warm.addColorStop(0, `rgba(251, 146, 60, ${0.13 * bright})`)
      warm.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = warm
      ctx.beginPath()
      ctx.arc(vpx, vpy, glowR, 0, Math.PI * 2)
      ctx.fill()
      const cool = ctx.createRadialGradient(vpx, vpy, 0, vpx, vpy, glowR * 1.6)
      cool.addColorStop(0, `rgba(56, 130, 246, ${0.1 * bright})`)
      cool.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = cool
      ctx.beginPath()
      ctx.arc(vpx, vpy, glowR * 1.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = "source-over"

      // ── 2. земля и дорога ──
      const far = cam.z + DRAW_DIST
      const near = cam.z + 30
      const gFL = P(-3200, GROUND_Y, far)
      const gFR = P(3200, GROUND_Y, far)
      const gNR = P(3200, GROUND_Y, near)
      const gNL = P(-3200, GROUND_Y, near)
      ctx.fillStyle = "#04060c"
      ctx.beginPath()
      ctx.moveTo(gFL.sx, gFL.sy)
      ctx.lineTo(gFR.sx, gFR.sy)
      ctx.lineTo(gNR.sx, gNR.sy)
      ctx.lineTo(gNL.sx, gNL.sy)
      ctx.closePath()
      ctx.fill()

      const rFL = P(-ROAD_HALF, GROUND_Y, far)
      const rFR = P(ROAD_HALF, GROUND_Y, far)
      const rNR = P(ROAD_HALF, GROUND_Y, near)
      const rNL = P(-ROAD_HALF, GROUND_Y, near)
      ctx.fillStyle = "#0c1424"
      ctx.beginPath()
      ctx.moveTo(rFL.sx, rFL.sy)
      ctx.lineTo(rFR.sx, rFR.sy)
      ctx.lineTo(rNR.sx, rNR.sy)
      ctx.lineTo(rNL.sx, rNL.sy)
      ctx.closePath()
      ctx.fill()

      // кромки дороги
      ctx.strokeStyle = `rgba(148, 163, 184, ${0.4 * bright})`
      ctx.lineWidth = 1.6
      for (const edgeX of [-ROAD_HALF, ROAD_HALF]) {
        const a = P(edgeX, GROUND_Y, far)
        const b = P(edgeX, GROUND_Y, near)
        ctx.beginPath()
        ctx.moveTo(a.sx, a.sy)
        ctx.lineTo(b.sx, b.sy)
        ctx.stroke()
      }

      // ── 3. разметка: мчится к камере — главный сигнал скорости ──
      const dashStart = cam.z - (cam.z % DASH_STEP) + DASH_STEP
      for (const laneX of [-100, 100]) {
        for (let z = dashStart; z < far; z += DASH_STEP) {
          const p1 = P(laneX - 7, GROUND_Y, z)
          const p2 = P(laneX + 7, GROUND_Y, z)
          const p3 = P(laneX + 7, GROUND_Y, z + 36)
          const p4 = P(laneX - 7, GROUND_Y, z + 36)
          if (p1.z2 < 0 || p1.persp > 1.25) continue
          const a = Math.min(0.85, 0.15 + p1.persp * 0.75) * bright
          ctx.fillStyle = `rgba(191, 219, 254, ${a})`
          ctx.beginPath()
          ctx.moveTo(p1.sx, p1.sy)
          ctx.lineTo(p2.sx, p2.sy)
          ctx.lineTo(p3.sx, p3.sy)
          ctx.lineTo(p4.sx, p4.sy)
          ctx.closePath()
          ctx.fill()
        }
      }

      // ── 4. столбики по обочинам ──
      const postStart = cam.z - (cam.z % POST_STEP) + POST_STEP
      for (let z = postStart; z < far; z += POST_STEP) {
        for (const side of [-1, 1]) {
          const x = side * (ROAD_HALF + 60)
          const base = P(x, GROUND_Y, z)
          const top = P(x, GROUND_Y - 64, z)
          if (base.z2 < 0 || base.persp > 1.2) continue
          const a = Math.min(0.8, 0.1 + base.persp * 0.8) * bright
          ctx.strokeStyle = `rgba(56, 189, 248, ${a * 0.55})`
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.moveTo(base.sx, base.sy)
          ctx.lineTo(top.sx, top.sy)
          ctx.stroke()
          ctx.fillStyle = `rgba(125, 211, 252, ${a})`
          ctx.beginPath()
          ctx.arc(top.sx, top.sy, Math.max(0.8, 2.2 * top.persp), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // ── 5. порталы-указатели с модулями программы ──
      const gantrySorted = [...gantries].sort((a, b) => b.z - a.z)
      for (const g of gantrySorted) {
        if (!g.passed && g.z - cam.z < 40) {
          g.passed = true
          if (rings.length < 8) rings.push({ x: vpx, y: vpy, t0: nowMs, big: false })
        }
        if (g.z - cam.z < -320) {
          g.z += GANTRY_DEPTH
          g.passed = false
          continue
        }
        const rel = g.z - cam.z
        if (rel < 30) continue
        const s = fov / (fov + rel * cosP)
        if (s < 0.16) continue

        const sign = SIGNS[g.sign]
        // опоры и перекладина
        const legL = P(-(ROAD_HALF + 110), GROUND_Y, g.z)
        const legLT = P(-(ROAD_HALF + 110), -230, g.z)
        const legR = P(ROAD_HALF + 110, GROUND_Y, g.z)
        const legRT = P(ROAD_HALF + 110, -230, g.z)
        const alpha = Math.min(0.9, (s - 0.16) * 2.2) * Math.min(1, (1.05 - s) * 5) * bright
        if (alpha < 0.01) continue
        ctx.strokeStyle = `rgba(100, 116, 139, ${alpha * 0.7})`
        ctx.lineWidth = Math.max(1, 5 * s)
        ctx.beginPath()
        ctx.moveTo(legL.sx, legL.sy)
        ctx.lineTo(legLT.sx, legLT.sy)
        ctx.moveTo(legR.sx, legR.sy)
        ctx.lineTo(legRT.sx, legRT.sy)
        ctx.moveTo(legLT.sx, legLT.sy)
        ctx.lineTo(legRT.sx, legRT.sy)
        ctx.stroke()

        // щит-указатель над дорогой
        const center = P(0, -330, g.z)
        const pw = 470 * s
        const ph = 150 * s
        const x = center.sx - pw / 2
        const y = center.sy - ph / 2
        ctx.fillStyle = `rgba(13, 20, 38, ${0.74 * alpha})`
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(x, y, pw, ph, 12 * s)
        else ctx.rect(x, y, pw, ph)
        ctx.fill()
        ctx.strokeStyle = `rgba(148, 163, 184, ${0.42 * alpha})`
        ctx.lineWidth = Math.max(0.8, 1.6 * s)
        ctx.stroke()
        // «дорожная» кромка щита
        ctx.fillStyle = `rgba(56, 189, 248, ${0.6 * alpha})`
        ctx.fillRect(x, y + ph - Math.max(1, 4 * s), pw, Math.max(1, 4 * s))
        ctx.textBaseline = "alphabetic"
        ctx.fillStyle = `rgba(226, 232, 240, ${0.95 * alpha})`
        ctx.font = `600 ${Math.max(9, 40 * s)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
        ctx.fillText(sign.title, x + 20 * s, y + ph * 0.42)
        ctx.fillStyle = `rgba(148, 163, 184, ${0.85 * alpha})`
        ctx.font = `400 ${Math.max(8, 21 * s)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
        ctx.fillText(sign.sub, x + 20 * s, y + ph * 0.72)
      }

      // ── 6. огни города у горизонта ──
      for (const c of lights) {
        const q = P(c.x, GROUND_Y - 4, c.z)
        if (q.z2 < 0) continue
        const tw = 0.45 + 0.35 * Math.sin(t * 1.3 + c.phase)
        ctx.fillStyle = `rgba(${c.rgb}, ${tw * 0.75 * bright})`
        ctx.beginPath()
        ctx.arc(q.sx, q.sy, c.size, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── 7. кольца: клики, порталы, ворп ──
      if (warpT > 0.12 && nowMs - lastWarpRing > 160 && rings.length < 8) {
        lastWarpRing = nowMs
        rings.push({ x: vpx, y: vpy, t0: nowMs, big: true })
      }
      rings = rings.filter((r) => nowMs - r.t0 < (r.big ? 850 : 700))
      for (const r of rings) {
        const life = r.big ? 850 : 700
        const pr = (nowMs - r.t0) / life
        const radius = 30 + pr * (r.big ? Math.max(width, height) * 0.9 : Math.max(width, height) * 0.55)
        ctx.strokeStyle = `rgba(125, 211, 252, ${(1 - pr) * (r.big ? 0.3 : 0.18)})`
        ctx.lineWidth = r.big ? 2 : 1.3
        ctx.beginPath()
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2)
        ctx.stroke()
      }

      // ── 8. виньетка ──
      const vig = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.44,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.78,
      )
      vig.addColorStop(0, "rgba(0, 0, 0, 0)")
      vig.addColorStop(1, "rgba(0, 0, 0, 0.46)")
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, width, height)

      debug.yaw = yaw
      debug.pitch = pitch
      debug.speed = speed
      debug.energy = energy
      debug.warp = warpT
    }

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      if (frameMs > 0 && ts - last < frameMs) return
      if (w.__loginScenePaused === true) {
        last = ts
        return
      }
      const dt = Math.min(0.1, last === 0 ? 0.033 : (ts - last) / 1000)
      last = ts
      frameNo += 1
      draw(ts / 1000, dt, ts)
    }

    /** Каждый клик/тап — рывок вперёд (click не срабатывает от свайпа). */
    const onClick = (event: MouseEvent) => {
      if (performance.now() - lastPlungeMs < 220) return
      lastPlungeMs = performance.now()
      debug.plunges += 1
      speed = Math.min(SPEED_PLUNGE, speed + 1500)
      fovKick = Math.min(240, fovKick + 150)
      if (rings.length < 8) rings.push({ x: event.clientX, y: event.clientY, t0: performance.now(), big: false })
    }
    /** Ракурс за мышью/пером (телефон водит пальцем по площадке обзора). */
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      pointer = { x: event.clientX, y: event.clientY }
    }
    /** Печать в полях — энергия полёта (значения не читаем). */
    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA")) return
      energy = Math.min(1.3, energy + 0.4)
    }
    /** Успешный вход — ворп. */
    const onWarp = () => {
      debug.warps += 1
      warpT = 1
      speed = SPEED_WARP
      fovKick = 240
    }
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
      } else if (!reduced) {
        last = 0
        raf = requestAnimationFrame(loop)
      }
    }
    const onResize = () => {
      resize()
      if (reduced) draw(0, 0.033, performance.now())
    }

    // Площадка обзора: палец по «лобовому стеклу» поворачивает камеру.
    // Слушаем ОКНО (прозрачные слои кабины не должны перехватывать палец),
    // но игнорируем касания по консоли и элементам формы
    let padLast: { x: number; y: number } | null = null
    w.__loginSceneLook = (dx: number, dy: number) => {
      yawDrag = clamp(yawDrag + dx * 0.0035, -0.55, 0.55)
      pitchDrag = clamp(pitchDrag + dy * 0.0026, -0.34, 0.34)
    }
    const isUi = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest("[data-login-console], form, button, a, input, textarea, label") != null
    const onPadDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || isUi(event.target)) return
      padLast = { x: event.clientX, y: event.clientY }
    }
    const onPadMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !padLast) return
      w.__loginSceneLook?.(event.clientX - padLast.x, event.clientY - padLast.y)
      padLast = { x: event.clientX, y: event.clientY }
    }
    const onPadUp = () => {
      padLast = null
    }

    resize()
    if (reduced) {
      draw(0, 0.033, performance.now())
    } else {
      // Кинематографичный старт: «прилетаем» на разгоне
      speed = 3200
      fovKick = 220
      energy = 0.5
      raf = requestAnimationFrame(loop)
      window.addEventListener("click", onClick, { passive: true })
      window.addEventListener("pointermove", onPointerMove, { passive: true })
      document.addEventListener("input", onInput, { passive: true })
      window.addEventListener("login:warp", onWarp)
      window.addEventListener("pointerdown", onPadDown, { passive: true })
      window.addEventListener("pointermove", onPadMove, { passive: true })
      window.addEventListener("pointerup", onPadUp, { passive: true })
      window.addEventListener("pointercancel", onPadUp, { passive: true })
    }
    window.addEventListener("resize", onResize)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onResize)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("click", onClick)
      window.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("input", onInput)
      window.removeEventListener("login:warp", onWarp)
      window.removeEventListener("pointerdown", onPadDown)
      window.removeEventListener("pointermove", onPadMove)
      window.removeEventListener("pointerup", onPadUp)
      window.removeEventListener("pointercancel", onPadUp)
      }
  }, [])

  return (
    <>
      <canvas
        ref={canvasRef}
        data-login-scene
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      />
      {/* «Лобовое стекло»: палец здесь поворачивает камеру (только телефон;
          на ПК ракурс ведёт курсор). Клик по площадке тоже проваливает. */}
      <div
        ref={padRef}
        data-lookpad
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-[5] h-[52vh] touch-none lg:hidden"
      />
    </>
  )
}
