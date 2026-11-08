"use client"

// components/visual/login-scene.tsx
//
// Кинематографичный 3D-вход (просьба владельца: «прямо очень крутой 3Д
// вход, со сменой угла обзора, чтобы при каждом клике мы как будто
// проваливались в программу»).
//
// Вместо «обычной анимации на фоне» — ПОЛЁТ КАМЕРЫ СКВОЗЬ ПРОГРАММУ:
//  • Коридор из «ворот» — рамок-модулей, уходящих в глубину; камера
//    непрерывно летит вперёд, ворота проходят мимо и рождаются вновь.
//  • Смена угла обзора — курсор мыши или палец поворачивают камеру
//    (yaw/pitch с мягким lerp), плюс лёгкое дыхание камеры в покое.
//  • «Проваливание» — КАЖДЫЙ клик/тап даёт рывок скорости (кик FOV +
//    крен камеры + кольцо-удар из точки клика). Ввод текста подпитывает
//    полёт энергией: быстрее, ярче, живее.
//  • Ворп — событие "login:warp" (успешный вход) на ~1.2 с превращает
//    полёт в прыжок сквозь программу: максимальная скорость, широкое
//    поле зрения, частые кольца — и человек «внутри».
//  • Витрина программы — в глубине коридора проплывают таблички-модули
//    («Живая карта», «Маршруты», «Биржа грузов»…) — объём и ощущение
//    наполненности; точный список продублирован HTML-чипами на странице.
//
// Техника: canvas 2D + собственная перспективная проекция (yaw → pitch →
// persp = fov/(fov+z2)), без библиотек и новых зависимостей. Крен камеры —
// поворотом контекста вокруг центра экрана.
//
// Экономия: DPR ≤ 2, на узких экранах меньше узлов и 30 кадров/с (на ПК —
// 60), скрытая вкладка — пауза, prefers-reduced-motion — один статичный
// кадр без слушателей. Для приёмочных тестов публикуем
// window.__loginScene (счётчики кликов/ворпа, угол камеры, скорость).

import { useEffect, useRef } from "react"

const MAX_DPR = 2
const FRAME_MS_WIDE = 0 // без ограничения: ~60 кадров/с
const FRAME_MS_NARROW = 1000 / 30

// Геометрия мира
const FOV = 640
const GATE_STEP = 780
const GATE_COUNT = 10
const DEPTH = GATE_STEP * GATE_COUNT
const GATE_W = 1080
const GATE_H = 660

// Движение
const SPEED_BASE = 135
const SPEED_PLUNGE = 2500
const SPEED_WARP = 4800

const NODES_WIDE = 64
const NODES_NARROW = 38
const DUST_WIDE = 30
const DUST_NARROW = 16
const LINK_3D = 430

const COLORS = ["148, 163, 184", "56, 189, 248", "99, 102, 241", "251, 191, 36"]

type Gate = { z: number; passed: boolean; double: boolean }
type NetNode = { x: number; y: number; z: number; size: number; rgb: string; phase: number }
type Link = { a: number; b: number }
type Billboard = {
  z: number
  side: 1 | -1
  y: number
  w: number
  h: number
  title: string
  sub: string
  phase: number
}
type Dust = { x: number; y: number; z: number; rgb: string; fresh: boolean; px: number; py: number }
type Ring = { x: number; y: number; t0: number; big: boolean }

/** Что проплывает мимо в глубине коридора — витрина программы. */
const BOARDS: ReadonlyArray<{ title: string; sub: string }> = [
  { title: "Живая карта", sub: "машины, ETA и статусы в реальном времени" },
  { title: "Маршруты по дорогам", sub: "OSRM: плечи, оптимизация, прогноз" },
  { title: "Биржа грузов", sub: "ATI.SU и Cargomart в одном окне" },
  { title: "Документы и оплаты", sub: "статусы рейсов без Excel" },
  { title: "Аналитика парка", sub: "KPI, выручка и простои в один экран" },
  { title: "Доступы и роли", sub: "у каждой стороны — своё окно" },
]

/** Мягкие пятна сияния — дальний свет «города» за коридором. */
const BLOBS = [
  { rgb: [56, 130, 246] as const, cx: 0.16, cy: 0.14, r: 0.9, speed: 0.03, phase: 0, alpha: 0.1 },
  { rgb: [245, 158, 11] as const, cx: 0.88, cy: 0.9, r: 0.7, speed: 0.021, phase: 2.1, alpha: 0.06 },
  { rgb: [99, 102, 241] as const, cx: 0.78, cy: 0.1, r: 0.85, speed: 0.016, phase: 4.2, alpha: 0.07 },
]

type SceneDebug = {
  plunges: number
  warps: number
  yaw: number
  pitch: number
  speed: number
  energy: number
  warp: number
  /** Сколько раз сцена пересобиралась (должно быть 1 после загрузки) */
  resets: number
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

export function LoginScene(): React.ReactElement {
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
    let narrow = false
    // Геометрия коридора подбирается под экран: на телефоне ворота меньше
    // и чаще — рамки видны ЦЕЛИКОМ и обрамляют форму входа, а не режутся
    // краями экрана (именно это давало «фон непонятно движется»)
    let gateHalfW = GATE_W / 2
    let gateHalfH = GATE_H / 2
    let gateStep = GATE_STEP
    let depth = DEPTH
    // Куда смотрит камера: ось коридора идёт через ФОРМУ входа —
    // точка схода и ворота привязаны к карточке, форма «висит» внутри
    // сцены, а не приклеена к экрану
    let originX = 0
    let originY = 0
    let frameMs = FRAME_MS_WIDE
    let raf = 0
    let last = 0
    let lastPlungeMs = 0
    let frameNo = 0

    // Камера
    const cam = { yaw: 0, pitch: 0, roll: 0, z: 0 }
    let speed = SPEED_BASE
    let energy = 0
    let fovKick = 0
    let rollKick = 0
    let warpT = 0
    let pointer: { x: number; y: number } | null = null

    let gates: Gate[] = []
    let nodes: NetNode[] = []
    let links: Link[] = []
    let boards: Billboard[] = []
    let dust: Dust[] = []
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
    ;(window as Window & { __loginScene?: SceneDebug }).__loginScene = debug

    const randSide = () => (Math.random() < 0.5 ? -1 : 1)

    const seed = () => {
      debug.resets += 1
      narrow = width < 640
      frameMs = narrow ? FRAME_MS_NARROW : FRAME_MS_WIDE
      gateHalfW = narrow ? 330 : GATE_W / 2
      gateHalfH = narrow ? 235 : GATE_H / 2
      gateStep = narrow ? 620 : GATE_STEP
      depth = gateStep * GATE_COUNT

      gates = Array.from({ length: GATE_COUNT }, (_, i) => ({
        z: 120 + i * gateStep,
        passed: false,
        double: i % 2 === 0,
      }))

      const nodeCount = narrow ? NODES_NARROW : NODES_WIDE
      nodes = Array.from({ length: nodeCount }, () => ({
        x: randSide() * (gateHalfW + 70 + Math.random() * 420),
        y: (Math.random() * 2 - 1) * (gateHalfH + 60 + Math.random() * 330),
        z: Math.random() * depth,
        size: 0.7 + Math.random() * 1.4,
        rgb: COLORS[Math.floor(Math.random() * COLORS.length)],
        phase: Math.random() * Math.PI * 2,
      }))
      // связи считаем один раз по стартовым позициям; при перерождении
      // узла связь просто натягивается — рядом с камерой всё равно невидимо
      links = []
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i]
          const b = nodes[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dz = a.z - b.z
          if (dx * dx + dy * dy + dz * dz < LINK_3D * LINK_3D) links.push({ a: i, b: j })
          if (links.length > 150) break
        }
      }

      boards = BOARDS.map((b, i) => ({
        z: 900 + (i * depth) / BOARDS.length,
        side: i % 2 === 0 ? 1 : -1,
        y: (i % 4 < 2 ? -1 : 1) * (narrow ? 170 : 120),
        w: narrow ? 370 : 470,
        h: narrow ? 132 : 152,
        title: b.title,
        sub: b.sub,
        phase: Math.random() * Math.PI * 2,
      }))

      const dustCount = narrow ? DUST_NARROW : DUST_WIDE
      dust = Array.from({ length: dustCount }, () => ({
        x: (Math.random() * 2 - 1) * (narrow ? 780 : 1150),
        y: (Math.random() * 2 - 1) * (narrow ? 520 : 750),
        z: Math.random() * depth,
        rgb: COLORS[Math.floor(Math.random() * COLORS.length)],
        fresh: true,
        px: 0,
        py: 0,
      }))
    }

    let seeded = false
    let anchorDirty = true

    /** Центр формы входа — ось коридора. Меряем внешний контейнер
     *  карточки (без 3D-трансформаций), чтобы не было обратной связи.
     *  Читаем раскладку только по грязному флагу (прокрутка/ресайз):
     *  ежекадровые замеры душат страницу постоянным reflow. */
    const measureAnchor = () => {
      const el =
        document.querySelector("[data-card-anchor]") ??
        document.querySelector(".login-card-glow") ??
        document.querySelector("form")
      if (!el || width === 0) {
        originX = width / 2
        originY = height / 2
        return
      }
      const rect = el.getBoundingClientRect()
      originX = rect.left + rect.width / 2
      originY = rect.top + rect.height / 2
    }

    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Сцену собираем один раз при старте. На телефоне адресная строка и
      // клавиатура постоянно меняют высоту viewport: пересборка на каждый
      // resize — это скачки и мерцание, которые выглядят как поломка
      if (!seeded) {
        seed()
        seeded = true
      }
      measureAnchor()
    }

    /** Проекция точки мира на экран с учётом поворота камеры. */
    const project = (x: number, y: number, z: number, sinYaw: number, cosYaw: number, sinP: number, cosP: number, fov: number) => {
      const dz = z - cam.z
      const x1 = x * cosYaw - dz * sinYaw
      const z1 = x * sinYaw + dz * cosYaw
      const y1 = y * cosP - z1 * sinP
      const z2 = y * sinP + z1 * cosP
      const persp = fov / (fov + z2)
      return { sx: originX + x1 * persp, sy: originY + y1 * persp, persp, z2 }
    }

    const draw = (t: number, dt: number, nowMs: number) => {
      ctx.clearRect(0, 0, width, height)
      // форма может двигаться по экрану (прокрутка на телефоне) —
      // держим ось коридора на ней
      if (anchorDirty || frameNo % 60 === 0) {
        anchorDirty = false
        measureAnchor()
      }

      // ── движение камеры ──
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
      rollKick *= Math.exp(-dt * 2.6)

      // Угол обзора: на ПК — за курсором; на телефоне палец занят
      // прокруткой, поэтому камеру там ведёт сама прокрутка — сцена
      // «едет» вместе с содержимым, без дёрганья от свайпов
      const scrollNorm = Math.max(
        0,
        Math.min(1, window.scrollY / Math.max(1, window.innerHeight * 0.8)),
      )
      const yawT = pointer ? -(pointer.x / width - 0.5) * 0.46 : scrollNorm * 0.16
      const pitchT = pointer ? -(pointer.y / height - 0.5) * 0.3 : scrollNorm * 0.3
      cam.yaw += (yawT - cam.yaw) * Math.min(1, dt * 2.2)
      cam.pitch += (pitchT - cam.pitch) * Math.min(1, dt * 2.2)

      const swayY = Math.sin(t * 0.13) * 0.055
      const swayP = Math.sin(t * 0.16 + 1.3) * 0.035
      const yaw = cam.yaw + swayY
      const pitch = cam.pitch + swayP
      const sinYaw = Math.sin(yaw)
      const cosYaw = Math.cos(yaw)
      const sinP = Math.sin(pitch)
      const cosP = Math.cos(pitch)
      const fov = FOV + fovKick
      const roll = cam.roll + rollKick

      // точка схода — куда летим: у самой ФОРМЫ; свет «города»
      // смещается вместе с обзором
      const vpx = originX - fov * Math.tan(yaw)
      const vpy = originY - fov * Math.tan(pitch)

      const bright = 0.8 + Math.min(1.2, energy) * 0.5 + warpT * 1.1

      ctx.save()
      // крен камеры — весь мир чуть наклоняется при рывке
      if (Math.abs(roll) > 0.0005) {
        // крен вращает мир вокруг формы — карточка стоит на месте
        ctx.translate(originX, originY)
        ctx.rotate(roll)
        ctx.translate(-originX, -originY)
      }

      // ── 1. дальнее сияние ──
      ctx.globalCompositeOperation = "lighter"
      const min = Math.min(width, height) || 1
      for (const b of BLOBS) {
        const x = (b.cx + Math.sin(t * b.speed + b.phase) * 0.07) * width
        const y = (b.cy + Math.cos(t * b.speed * 0.8 + b.phase) * 0.06) * height
        const r = b.r * min
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
        gradient.addColorStop(0, `rgba(${b.rgb[0]}, ${b.rgb[1]}, ${b.rgb[2]}, ${b.alpha})`)
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)")
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      // свет в точке схода — «вход в программу»
      const vpR = 240 + fovKick * 1.6 + warpT * 420
      const vpGrad = ctx.createRadialGradient(vpx, vpy, 0, vpx, vpy, vpR)
      vpGrad.addColorStop(0, `rgba(56, 189, 248, ${0.12 * bright})`)
      vpGrad.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = vpGrad
      ctx.beginPath()
      ctx.arc(vpx, vpy, vpR, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = "source-over"

      // ── 2. ворота коридора ──
      const corners = [-gateHalfW, gateHalfW]
      const ys = [-gateHalfH, gateHalfH]
      const gatePts = gates.map((g) => {
        const pts = [
          project(corners[0], ys[0], g.z, sinYaw, cosYaw, sinP, cosP, fov),
          project(corners[1], ys[0], g.z, sinYaw, cosYaw, sinP, cosP, fov),
          project(corners[1], ys[1], g.z, sinYaw, cosYaw, sinP, cosP, fov),
          project(corners[0], ys[1], g.z, sinYaw, cosYaw, sinP, cosP, fov),
        ]
        return { g, pts, avg: (pts[0].persp + pts[2].persp) / 2 }
      })
      gatePts.sort((a, b) => b.g.z - a.g.z)

      // рельсы: угол ворот → угол следующих ворот
      for (let i = 0; i < gatePts.length - 1; i += 1) {
        const a = gatePts[i]
        const b = gatePts[i + 1]
        const alpha = 0.08 * Math.min(a.avg, b.avg) * bright
        if (alpha < 0.008) continue
        ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`
        ctx.lineWidth = 0.7
        ctx.beginPath()
        for (let k = 0; k < 4; k += 1) {
          ctx.moveTo(a.pts[k].sx, a.pts[k].sy)
          ctx.lineTo(b.pts[k].sx, b.pts[k].sy)
        }
        ctx.stroke()
      }

      for (const { g, pts, avg } of gatePts) {
        // ворота прошли камеру → кольцо-удар из точки схода
        if (!g.passed && g.z - cam.z < 30) {
          g.passed = true
          if (rings.length < 8) rings.push({ x: vpx, y: vpy, t0: nowMs, big: false })
        }
        if (g.z - cam.z < -240) {
          g.z += depth
          g.passed = false
          continue
        }
        let alpha = Math.max(0, Math.min(0.5, (avg - 0.1) * 1.4)) * bright
        alpha *= Math.max(0, Math.min(1, (1.04 - avg) * 6)) // не вспыхиваем у лица
        if (alpha < 0.006) continue
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha * 0.8})`
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.moveTo(pts[0].sx, pts[0].sy)
        for (let k = 1; k < 4; k += 1) ctx.lineTo(pts[k].sx, pts[k].sy)
        ctx.closePath()
        ctx.stroke()
        // засечки по углам — «технический» вид рамки
        ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`
        ctx.lineWidth = 1.4
        for (let k = 0; k < 4; k += 1) {
          const p = pts[k]
          const nx = (pts[(k + 1) % 4].sx - p.sx) * 0.12
          const ny = (pts[(k + 1) % 4].sy - p.sy) * 0.12
          ctx.beginPath()
          ctx.moveTo(p.sx, p.sy)
          ctx.lineTo(p.sx + nx, p.sy + ny)
          ctx.stroke()
        }
        // каждая вторая рамка — двойная (внутренний контур)
        if (g.double && avg > 0.16) {
          ctx.strokeStyle = `rgba(148, 163, 184, ${alpha * 0.45})`
          ctx.lineWidth = 0.7
          ctx.beginPath()
          for (let k = 0; k < 4; k += 1) {
            const cx = (pts[k].sx + pts[(k + 1) % 4].sx) / 2
            const cy = (pts[k].sy + pts[(k + 1) % 4].sy) / 2
            const mx = (cx + originX) / 2
            const my = (cy + originY) / 2
            if (k === 0) ctx.moveTo(mx, my)
            else ctx.lineTo(mx, my)
          }
          ctx.closePath()
          ctx.stroke()
        }
      }

      // ── 3. боковая сеть (узлы + связи) ──
      const proj = nodes.map((n) => {
        const bob = Math.sin(t * 0.7 + n.phase) * 26
        return {
          ...project(n.x, n.y + bob, n.z, sinYaw, cosYaw, sinP, cosP, fov),
          size: n.size,
          rgb: n.rgb,
        }
      })
      for (const n of nodes) {
        if (n.z - cam.z < -200) {
          n.z += depth
        }
      }
      for (const l of links) {
        const a = proj[l.a]
        const b = proj[l.b]
        if (a.z2 < -80 || b.z2 < -80) continue
        const depth = Math.min(a.persp, b.persp)
        const alpha = 0.12 * depth * bright
        if (alpha < 0.006) continue
        ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(a.sx, a.sy)
        ctx.lineTo(b.sx, b.sy)
        ctx.stroke()
      }
      proj.sort((a, b) => a.persp - b.persp)
      for (const q of proj) {
        if (q.z2 < -80) continue
        const alpha = Math.min(0.9, (0.14 + (q.persp - 0.6) * 0.85) * bright)
        if (alpha < 0.01) continue
        const r = q.size * (0.5 + q.persp * 0.85) * (1 + Math.min(1, energy) * 0.2)
        ctx.fillStyle = `rgba(${q.rgb}, ${alpha})`
        ctx.beginPath()
        ctx.arc(q.sx, q.sy, r, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── 4. витрина: таблички-модули в глубине ──
      const boardDraws = boards.map((b) => {
        const bob = Math.sin(t * 0.5 + b.phase) * 16
        const p = project(b.side * (narrow ? 320 : 540), b.y + bob, b.z, sinYaw, cosYaw, sinP, cosP, fov)
        return { b, p }
      })
      boardDraws.sort((a, b) => a.p.persp - b.p.persp)
      for (const { b, p } of boardDraws) {
        if (b.z - cam.z < -140) {
          b.z += depth
          continue
        }
        if (p.z2 < -60) continue
        const s = p.persp
        let a = Math.max(0, Math.min(0.85, (s - 0.17) * 2.4)) * bright
        a *= Math.max(0, Math.min(1, (0.98 - s) * 6))
        if (a < 0.01) continue
        const w = b.w * s
        const h = b.h * s
        const x = p.sx - w / 2
        const y = p.sy - h / 2
        // стеклянная панель
        ctx.fillStyle = `rgba(9, 14, 26, ${0.42 * a})`
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10 * s)
        else ctx.rect(x, y, w, h)
        ctx.fill()
        ctx.strokeStyle = `rgba(148, 163, 184, ${0.32 * a})`
        ctx.lineWidth = 1
        ctx.stroke()
        // акцентная полоса
        ctx.fillStyle = `rgba(56, 189, 248, ${0.75 * a})`
        ctx.fillRect(x + 8 * s, y + 10 * s, Math.max(1, 3 * s), h - 20 * s)
        // заголовок и подпись
        ctx.textBaseline = "alphabetic"
        ctx.fillStyle = `rgba(226, 232, 240, ${0.95 * a})`
        ctx.font = `600 ${Math.max(9, 30 * s)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
        ctx.fillText(b.title, x + 22 * s, y + h * 0.42)
        ctx.fillStyle = `rgba(148, 163, 184, ${0.85 * a})`
        ctx.font = `400 ${Math.max(8, 19 * s)}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
        ctx.fillText(b.sub, x + 22 * s, y + h * 0.68)
      }

      // ── 5. пыль: при разгоне превращается в штрихи скорости ──
      for (const d of dust) {
        if (d.z - cam.z < -160) {
          d.z += depth
          d.fresh = true
        }
        const p = project(d.x, d.y, d.z, sinYaw, cosYaw, sinP, cosP, fov)
        if (p.z2 < -60 || p.persp > 1.3) {
          d.fresh = true
          continue
        }
        const streak = Math.min(90, Math.max(0, (speed - SPEED_BASE) * 0.05))
        if (!d.fresh && streak > 2) {
          const dx = p.sx - d.px
          const dy = p.sy - d.py
          const len = Math.hypot(dx, dy)
          if (len > 2 && len < 220) {
            const k = streak / 24
            ctx.strokeStyle = `rgba(${d.rgb}, ${0.4 * p.persp})`
            ctx.lineWidth = Math.max(0.6, 1.1 * p.persp)
            ctx.beginPath()
            ctx.moveTo(p.sx, p.sy)
            ctx.lineTo(p.sx - dx * k, p.sy - dy * k)
            ctx.stroke()
          }
        } else {
          ctx.fillStyle = `rgba(${d.rgb}, ${0.3 * p.persp})`
          ctx.beginPath()
          ctx.arc(p.sx, p.sy, Math.max(0.5, 0.9 * p.persp), 0, Math.PI * 2)
          ctx.fill()
        }
        d.px = p.sx
        d.py = p.sy
        d.fresh = false
      }

      // ── 6. кольца: проход ворот, клики, ворп ──
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

      ctx.restore()

      // ── 7. виньетка: фокус к центру, глубина по краям ──
      const vig = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.42,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.75,
      )
      vig.addColorStop(0, "rgba(0, 0, 0, 0)")
      vig.addColorStop(1, "rgba(0, 0, 0, 0.42)")
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, width, height)

      // отладочная поверхность для приёмочных тестов
      debug.yaw = cam.yaw
      debug.pitch = cam.pitch
      debug.speed = speed
      debug.energy = energy
      debug.warp = warpT
    }

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      if (frameMs > 0 && ts - last < frameMs) return
      if ((window as Window & { __loginScenePaused?: boolean }).__loginScenePaused === true) {
        last = ts
        return
      }
      const dt = Math.min(0.1, last === 0 ? 0.033 : (ts - last) / 1000)
      last = ts
      frameNo += 1
      draw(ts / 1000, dt, ts)
    }

    /** Каждый клик/тап — «проваливание» в программу на шаг глубже. */
    const plunge = (x: number, y: number, nowMs: number) => {
      if (nowMs - lastPlungeMs < 220) return
      lastPlungeMs = nowMs
      debug.plunges += 1
      speed = Math.min(SPEED_PLUNGE, speed + 1500)
      fovKick = Math.min(240, fovKick + 150)
      rollKick = (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.05)
      if (rings.length < 8) rings.push({ x, y, t0: nowMs, big: false })
    }

    /** Каждый клик/тап — «проваливание». Слушаем именно click: его дают
     *  клик мышью и тап пальцем, но НЕ даёт прокрутка — раньше на
     *  pointerdown ловился рывок от каждого свайпа (на телефоне выглядело
     *  как подлагивание). */
    const onClick = (event: MouseEvent) => {
      plunge(event.clientX, event.clientY, performance.now())
    }
    /** Угол обзора — за мышью и пером; тач-указатель игнорируем. */
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      pointer = { x: event.clientX, y: event.clientY }
    }
    /** Печать в полях входа — энергия полёта (значения не читаем). */
    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA")) return
      energy = Math.min(1.3, energy + 0.4)
    }
    /** Прокрутка двигает форму по экрану — ось коридора нужно обновить */
    const onScroll = () => {
      anchorDirty = true
    }

    /** Успешный вход — ворп: на секунду полёт превращается в прыжок. */
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

    resize()
    if (reduced) {
      draw(0, 0.033, performance.now())
    } else {
      // Старт: мы «прилетаем» — ворота проносятся мимо на большой
      // скорости, свет разгорается и всё оседает в спокойный полёт
      speed = 3200
      fovKick = 220
      rollKick = 0.05
      energy = 0.5
      raf = requestAnimationFrame(loop)
      window.addEventListener("click", onClick, { passive: true })
      window.addEventListener("pointermove", onPointerMove, { passive: true })
      document.addEventListener("input", onInput, { passive: true })
      window.addEventListener("login:warp", onWarp)
      window.addEventListener("scroll", onScroll, { passive: true })
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
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      data-login-scene
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  )
}
