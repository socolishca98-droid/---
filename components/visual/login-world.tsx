"use client"

// components/visual/login-world.tsx — мир входа «Живые маршруты»
//
// Смена сцены по фидбеку владельца: «звёздный рейс не понравился, цвета
// не очень, на телефоне некрасиво — может, использовать маршруты в
// анимации». Мир теперь — ЖИВАЯ КАРТА НОЧЬЮ:
//
//   • тёмная сеть дорог неспешно плывёт (бесконечная плитка — компактный
//     слой, композитор не душим, урок и7 усвоен);
//   • города-узлы светятся янтарём и пульсируют кольцами;
//   • МАРШРУТЫ прорисовываются один за другим — и по каждому едет машина;
//   • фоновый трафик течёт по магистралям;
//   • палитра: глубокий синий + циан / изумруд / янтарь;
//   • форма — прозрачное матовое стекло поверх карты, мир виден насквозь;
//   • гироскоп БЕЗ КНОПКИ: на Android включается молча при загрузке,
//     на iPhone — по первому касанию экрана (Apple требует жест, но
//     годится любой тап — например, в поле логина).
//
// Приёмка: window.__loginWorld {dolly, speed, yaw, pitch, gyro, routes,
// warp, plunges} + __loginWorldLook + __loginWorldPaused +
// __loginWorldGyro. DOM: [data-login-world], [data-login-route] ×3,
// [data-login-city] ×6, [data-login-traffic] ×5, [data-login-panel].

import { useEffect, useMemo, useRef } from "react"

const PERSPECTIVE = 900

/** Скорость «полёта над картой» — двигает плитку дорог (dolly). */
const SPEED_BASE = 260
const SPEED_WARP = 5200

/** Цикл жизни маршрута: прорисовка → машина едет → угасание. */
const ROUTE_DRAW = 1.7
const ROUTE_FADE = 0.9
const ROUTE_SPEED = 170 // px карты в секунду

const SLOT_COUNT = 3

/** Города-узлы (координаты в системе карты 1200×800). */
const CITIES: ReadonlyArray<{ name: string; x: number; y: number }> = [
  { name: "ТВЕРЬ", x: 285, y: 175 },
  { name: "МОСКВА", x: 430, y: 395 },
  { name: "ЯРОСЛАВЛЬ", x: 675, y: 215 },
  { name: "Н. НОВГОРОД", x: 890, y: 340 },
  { name: "КАЗАНЬ", x: 1010, y: 175 },
  { name: "ВОРОНЕЖ", x: 655, y: 660 },
]

/** Маршруты: кубические кривые между городами. */
const ROUTES: ReadonlyArray<string> = [
  "M430,395 C500,290 580,250 675,215",
  "M430,395 C620,300 830,260 1010,175",
  "M675,215 C750,240 820,280 890,340",
  "M430,395 C480,520 560,600 655,660",
  "M285,175 C420,120 560,140 675,215",
  "M890,340 C930,290 970,240 1010,175",
  "M285,175 C320,260 370,330 430,395",
  "M655,660 C780,560 900,380 1010,175",
  "M675,215 C790,90 910,80 1010,175",
  "M890,340 C850,450 760,560 655,660",
]

/** Цвета активных маршрутов: разные рейсы — разные ленты. */
const LOGIST_COLORS = ["#22d3ee", "#34d399", "#fbbf24"]
const DRIVER_COLORS = ["#34d399", "#38bdf8", "#fbbf24"]

/** Магистрали фонового трафика (текут всегда, чуть заметны). */
const TRAFFIC_PATHS: ReadonlyArray<string> = [
  "M-60,540 C200,470 420,560 640,500 C860,440 1080,520 1260,460",
  "M-60,240 C180,300 400,180 620,240 C840,300 1060,180 1260,220",
  "M540,-60 C500,200 580,420 520,660 C500,760 520,840 500,880",
]

/** Точки трафика: магистраль, темп, сдвиг старта. */
const TRAFFIC_DOTS: ReadonlyArray<{ p: number; speed: number; off: number }> = [
  { p: 0, speed: 0.016, off: 0.0 },
  { p: 0, speed: 0.011, off: 0.55 },
  { p: 1, speed: 0.013, off: 0.2 },
  { p: 1, speed: 0.019, off: 0.75 },
  { p: 2, speed: 0.01, off: 0.4 },
]

type WorldDebug = {
  dolly: number
  speed: number
  yaw: number
  pitch: number
  gyro: boolean
  routes: number
  warp: number
  plunges: number
  frames: number
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
const smooth = (p: number) => p * p * (3 - 2 * p)

/** Плитка дорожной сети: абстрактные дороги + сетка + развязки.
    Повторяется бесконечно → компактный слой покрывает весь экран. */
function netTile(): string {
  const grid = [160, 320, 480]
    .flatMap((v) => [`M0,${v} H640`, `M${v},0 V640`])
    .map((d) => `<path d="${d}" stroke="#16233c" stroke-width="1"/>`)
    .join("")
  const roads = [
    "M-20,120 C140,88 260,182 380,150 C470,127 560,182 660,158",
    "M-20,420 C120,452 300,368 430,420 C520,456 580,420 660,442",
    "M120,-20 C152,120 88,260 120,380 C148,478 112,560 138,660",
    "M420,-20 C452,140 388,300 420,440 C446,548 412,590 436,660",
    "M-20,270 C180,236 340,300 500,262 C580,244 600,270 660,258",
    "M540,-20 C510,140 570,300 540,460 C520,560 556,600 536,660",
  ]
    .map((d) => `<path d="${d}" fill="none" stroke="#2f4a6e" stroke-width="1.6" stroke-opacity="0.6"/>`)
    .join("")
  const wide = [
    "M-20,540 C160,500 320,586 480,540 C560,516 600,540 660,528",
    "M240,-20 C210,180 290,360 250,540 C230,610 258,630 244,660",
  ]
    .map((d) => `<path d="${d}" fill="none" stroke="#3b5f8f" stroke-width="2.6" stroke-opacity="0.34"/>`)
    .join("")
  const dots = [
    [96, 150], [288, 122], [424, 446], [138, 384], [512, 268], [352, 540], [544, 462], [230, 258],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#527ba8" fill-opacity="0.55"/>`)
    .join("")
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">` +
    `${grid}${roads}${wide}${dots}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export function LoginWorld({
  variant = "logist",
  headline,
  children,
  bare = false,
}: {
  variant?: "logist" | "driver"
  /** Крупный заголовок, парящий над картой */
  headline?: React.ReactNode
  /** Содержимое прозрачного экрана (форма) — объект мира */
  children: React.ReactNode
  /** Панель без плиты — страница приносит свою карточку */
  bare?: boolean
}): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const skyRef = useRef<HTMLDivElement | null>(null)
  const midRef = useRef<HTMLDivElement | null>(null)
  const nearRef = useRef<HTMLDivElement | null>(null)
  const netRef = useRef<HTMLDivElement | null>(null)
  const routeRefs = useRef<Array<SVGGElement | null>>([])
  const pathRefs = useRef<Array<SVGPathElement | null>>([])
  const glowRefs = useRef<Array<SVGPathElement | null>>([])
  const truckRefs = useRef<Array<SVGGElement | null>>([])
  const trafficPathRefs = useRef<Array<SVGPathElement | null>>([])
  const trafficRefs = useRef<Array<SVGCircleElement | null>>([])

  const tile = useMemo(() => netTile(), [])
  const colors = variant === "driver" ? DRIVER_COLORS : LOGIST_COLORS

  useEffect(() => {
    const viewport = viewportRef.current
    const sky = skyRef.current
    const mid = midRef.current
    const near = nearRef.current
    const net = netRef.current
    if (!viewport || !sky || !mid || !near || !net) return

    const routeEls = routeRefs.current.filter((el): el is SVGGElement => el != null)
    const pathEls = pathRefs.current.filter((el): el is SVGPathElement => el != null)
    const glowEls = glowRefs.current.filter((el): el is SVGPathElement => el != null)
    const truckEls = truckRefs.current.filter((el): el is SVGGElement => el != null)
    const trafficPathEls = trafficPathRefs.current.filter((el): el is SVGPathElement => el != null)
    const trafficEls = trafficRefs.current.filter((el): el is SVGCircleElement => el != null)

    // маршруты: слоты со сдвигом фаз — карта живёт сразу
    const slots = pathEls.map((path, i) => {
      path.setAttribute("d", ROUTES[i % ROUTES.length])
      glowEls[i]?.setAttribute("d", ROUTES[i % ROUTES.length])
      const len = Math.max(1, path.getTotalLength())
      path.style.strokeDasharray = `${len}`
      return {
        path,
        glow: glowEls[i] ?? null,
        truck: truckEls[i] ?? null,
        group: routeEls[i] ?? null,
        def: i % ROUTES.length,
        len,
        ride: Math.max(1.6, len / ROUTE_SPEED),
        born: -i * 2.4,
        ang: 0,
      }
    })
    const trafficPaths = trafficPathEls.map((p) => ({
      el: p,
      len: Math.max(1, p.getTotalLength()),
    }))

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true
    const narrow = window.innerWidth < 640

    let raf = 0
    let last = 0
    let running = true

    // Камера над картой
    let dolly = 0
    let speed = reduced ? 0 : 2200 // кинематографичный прилёт: карта поплывёт
    let energy = 0
    let warpT = 0
    let fovKick = 0
    let yaw = 0
    let pitch = 0
    let yawMouse = 0
    let pitchMouse = 0
    let yawDrag = 0
    let pitchDrag = 0
    let yawGyro = 0
    let pitchGyro = 0
    // гироскоп: цель (сырые показания) и сглаженное значение — без дрожи
    let yawGyroT = 0
    let pitchGyroT = 0
    let gyroCalib: { b: number; g: number } | null = null
    let gyroActive = false
    let pointer: { x: number; y: number } | null = null
    let focused = false
    let aim = 0

    const debug: WorldDebug = {
      dolly: 0,
      speed,
      yaw: 0,
      pitch: 0,
      gyro: false,
      routes: 0,
      warp: 0,
      plunges: 0,
      frames: 0,
    }
    const w = window as Window & {
      __loginWorld?: WorldDebug
      __loginWorldLook?: (dx: number, dy: number) => void
      __loginWorldPaused?: boolean
      __loginWorldGyro?: () => Promise<boolean>
    }
    w.__loginWorld = debug
    w.__loginWorldLook = (dx: number, dy: number) => {
      yawDrag = clamp(yawDrag + dx * 0.045, -22, 22)
      pitchDrag = clamp(pitchDrag + dy * 0.03, -9, 9)
    }

    // ── гироскоп БЕЗ КНОПКИ ──
    // Слушатель ставим СИНХРОННО до запроса (в headless промис висит —
    // не страшно). Android: requestPermission нет — включаем молча.
    // iPhone: Apple требует жест — просим по первому касанию экрана.
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta == null || event.gamma == null) return
      if (!gyroCalib) gyroCalib = { b: event.beta, g: event.gamma }
      yawGyroT = clamp((event.gamma - gyroCalib.g) * 0.22, -12, 12)
      pitchGyroT = clamp((event.beta - gyroCalib.b) * 0.16, -8, 8)
      if (!gyroActive) {
        gyroActive = true
        debug.gyro = true
      }
    }
    const attachGyro = () => {
      window.addEventListener("deviceorientation", onOrientation)
      const D = (
        window as unknown as {
          DeviceOrientationEvent?: { requestPermission?: () => Promise<string> }
        }
      ).DeviceOrientationEvent
      if (D && typeof D.requestPermission === "function") {
        try {
          void D.requestPermission().catch(() => {})
        } catch {
          /* без UI промпт виснет — слушатель уже стоит */
        }
      }
    }
    const onFirstTouch = () => {
      attachGyro()
      window.removeEventListener("pointerdown", onFirstTouch, true)
    }
    w.__loginWorldGyro = async () => {
      attachGyro()
      return true
    }
    const touchCapable =
      "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0
    const D = (
      window as unknown as {
        DeviceOrientationEvent?: { requestPermission?: () => Promise<string> }
      }
    ).DeviceOrientationEvent
    if (touchCapable && D) {
      if (typeof D.requestPermission !== "function") {
        attachGyro() // Android и прочие без промпта — сразу и молча
      } else {
        window.addEventListener("pointerdown", onFirstTouch, {
          capture: true,
          passive: true,
        })
      }
    }

    // ── ввод ──
    const onClick = () => {
      if (reduced) return
      debug.plunges += 1
      speed = Math.min(2400, speed + 1500)
      fovKick = Math.min(160, fovKick + 120)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      pointer = { x: event.clientX, y: event.clientY }
    }
    const isUi = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest("[data-login-panel], form, button, a, input, textarea, label") != null
    let padLast: { x: number; y: number } | null = null
    const onPadDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || isUi(event.target)) return
      padLast = { x: event.clientX, y: event.clientY }
    }
    const onPadMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !padLast) return
      w.__loginWorldLook?.(event.clientX - padLast.x, event.clientY - padLast.y)
      padLast = { x: event.clientX, y: event.clientY }
    }
    const onPadUp = () => {
      padLast = null
    }
    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA")) return
      energy = Math.min(1.2, energy + 0.5)
    }
    const onWarp = () => {
      warpT = 1
      speed = SPEED_WARP
      fovKick = 160
    }
    const onFocusIn = (event: FocusEvent) => {
      focused = event.target instanceof Element && event.target.closest("[data-login-panel]") != null
    }
    const onFocusOut = () => {
      focused = false
    }
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
      } else if (running && !reduced) {
        last = 0
        raf = requestAnimationFrame(frame)
      }
    }

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame)
      if (narrow && ts - last < 33 && last !== 0) return // 30 к/с на телефоне
      if (w.__loginWorldPaused === true) {
        last = ts
        return
      }
      const dt = Math.min(0.05, last === 0 ? 0.033 : (ts - last) / 1000)
      last = ts
      const t = ts / 1000

      // ── полёт над картой: дороги плывут, клик/ввод ускоряют ──
      energy *= Math.exp(-dt * 2)
      warpT *= Math.exp(-dt * 2)
      fovKick *= Math.exp(-dt * 3)
      const targetSpeed = warpT > 0.05 ? SPEED_WARP : SPEED_BASE * (1 + Math.min(1.2, energy) * 1.6)
      speed += (targetSpeed - speed) * Math.min(1, dt * (warpT > 0.05 ? 6 : 2.2))
      if (reduced) speed = 0
      dolly += speed * dt

      // ── ракурс: курсор + палец + гироскоп (сглаженный); в фокусе
      // поля камера мягко центруется на форме ──
      const yawT = pointer ? -(pointer.x / window.innerWidth - 0.5) * 14 : 0
      const pitchT = pointer ? -(pointer.y / window.innerHeight - 0.5) * 7 : 0
      yawMouse += (yawT - yawMouse) * Math.min(1, dt * 3)
      pitchMouse += (pitchT - pitchMouse) * Math.min(1, dt * 3)
      yawDrag *= Math.exp(-dt * 0.1)
      pitchDrag *= Math.exp(-dt * 0.1)
      yawGyro += (yawGyroT - yawGyro) * Math.min(1, dt * 5)
      pitchGyro += (pitchGyroT - pitchGyro) * Math.min(1, dt * 5)
      aim += ((focused ? 1 : 0) - aim) * Math.min(1, dt * 3)
      const swayY = Math.sin(t * 0.14) * 0.3
      const swayP = Math.sin(t * 0.17 + 1.2) * 0.18
      const blend = 1 - aim * 0.06
      yaw = (yawMouse + yawDrag + yawGyro) * blend + swayY
      pitch = (pitchMouse + pitchDrag + pitchGyro) * blend + swayP

      // ── риги: карта, города, ближний план вращаются с камерой ──
      const rot = `rotateX(${(-pitch).toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg)`
      sky.style.transform = rot
      mid.style.transform = rot
      near.style.transform = rot
      viewport.style.perspective = `${(PERSPECTIVE - warpT * 170 - fovKick * 80).toFixed(0)}px`

      // ── дорожная сеть: бесконечная плитка неспешно плывёт ──
      const px = -((dolly * 0.045) % 640)
      const py = -((dolly * 0.018) % 640)
      net.style.backgroundPosition = `${px.toFixed(1)}px ${py.toFixed(1)}px`

      // ── маршруты: прорисовка → машина → угасание → новый маршрут ──
      for (const r of slots) {
        const age = t - r.born
        if (age >= ROUTE_DRAW + r.ride + ROUTE_FADE) {
          debug.routes += 1
          r.def = (r.def + SLOT_COUNT) % ROUTES.length
          const d = ROUTES[r.def]
          r.path.setAttribute("d", d)
          r.glow?.setAttribute("d", d)
          r.len = Math.max(1, r.path.getTotalLength())
          r.path.style.strokeDasharray = `${r.len}`
          r.ride = Math.max(1.6, r.len / ROUTE_SPEED)
          r.born = t
          continue
        }
        let offset = r.len
        let truckOp = 0
        let op = 1
        if (age < ROUTE_DRAW) {
          offset = r.len * (1 - easeOut(Math.max(0, age) / ROUTE_DRAW))
          op = clamp(age / 0.35, 0, 1)
        } else if (age < ROUTE_DRAW + r.ride) {
          offset = 0
          truckOp = 1
          const e = smooth(clamp((age - ROUTE_DRAW) / r.ride, 0, 1))
          const pt = r.path.getPointAtLength(e * r.len)
          const pb = r.path.getPointAtLength(Math.max(0, e * r.len - 7))
          const dx = pt.x - pb.x
          const dy = pt.y - pb.y
          if (dx * dx + dy * dy > 0.01) r.ang = (Math.atan2(dy, dx) * 180) / Math.PI
          r.truck?.setAttribute(
            "transform",
            `translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) rotate(${r.ang.toFixed(1)})`,
          )
        } else {
          offset = 0
          truckOp = clamp(1 - (age - ROUTE_DRAW - r.ride) / ROUTE_FADE, 0, 1)
          op = truckOp
        }
        r.path.style.strokeDashoffset = `${offset.toFixed(1)}`
        if (r.group) r.group.style.opacity = op.toFixed(3)
        if (r.truck) r.truck.style.opacity = truckOp.toFixed(3)
      }

      // ── фоновый трафик по магистралям ──
      for (let i = 0; i < trafficEls.length; i++) {
        const dot = TRAFFIC_DOTS[i % TRAFFIC_DOTS.length]
        const lane = trafficPaths[dot.p % trafficPaths.length]
        if (!lane) continue
        const p = (t * dot.speed + dot.off) % 1
        const pt = lane.el.getPointAtLength(p * lane.len)
        trafficEls[i].setAttribute("cx", pt.x.toFixed(1))
        trafficEls[i].setAttribute("cy", pt.y.toFixed(1))
      }

      debug.frames += 1
      debug.dolly = dolly
      debug.speed = speed
      debug.yaw = yaw
      debug.pitch = pitch
      debug.warp = warpT
    }

    window.addEventListener("click", onClick, { passive: true })
    window.addEventListener("pointermove", onPointerMove, { passive: true })
    window.addEventListener("pointerdown", onPadDown, { passive: true })
    window.addEventListener("pointermove", onPadMove, { passive: true })
    window.addEventListener("pointerup", onPadUp, { passive: true })
    window.addEventListener("pointercancel", onPadUp, { passive: true })
    document.addEventListener("input", onInput, { passive: true })
    window.addEventListener("login:warp", onWarp)
    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("focusout", onFocusOut)
    document.addEventListener("visibilitychange", onVisibility)

    if (reduced) {
      // статичный кадр: карта есть, маршруты прорисованы, всё замерло
      const rot = "rotateX(0deg) rotateY(0deg)"
      sky.style.transform = rot
      mid.style.transform = rot
      near.style.transform = rot
      for (const r of slots) {
        r.path.style.strokeDashoffset = "0"
        if (r.group) r.group.style.opacity = "0.9"
        if (r.truck) r.truck.style.opacity = "0"
      }
    } else {
      raf = requestAnimationFrame(frame)
    }

    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener("click", onClick)
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerdown", onPadDown)
      window.removeEventListener("pointermove", onPadMove)
      window.removeEventListener("pointerup", onPadUp)
      window.removeEventListener("pointercancel", onPadUp)
      document.removeEventListener("input", onInput)
      window.removeEventListener("login:warp", onWarp)
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("focusout", onFocusOut)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("deviceorientation", onOrientation)
      window.removeEventListener("pointerdown", onFirstTouch, true)
    }
  }, [variant, tile])

  return (
    <div
      ref={viewportRef}
      data-login-world
      className="fixed inset-0 touch-none overflow-hidden bg-[radial-gradient(50%_40%_at_18%_16%,rgba(14,116,144,0.20),transparent_70%),radial-gradient(42%_34%_at_82%_12%,rgba(99,102,241,0.14),transparent_70%),radial-gradient(46%_38%_at_78%_84%,rgba(245,158,11,0.10),transparent_72%),radial-gradient(120%_95%_at_50%_30%,#0a1526_0%,#060c18_55%,#04070f_100%)]"
      style={{ perspective: "900px", perspectiveOrigin: "50% 45%" }}
    >
      {/* ── ДАЛЬНИЙ ПЛАН: дорожная сеть — бесконечная плитка ── */}
      <div ref={skyRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        <div
          ref={netRef}
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[165vh] w-[165vw]"
          style={{
            backgroundImage: tile,
            backgroundSize: "640px 640px",
            transform: "translate(-50%,-50%) translateZ(-340px)",
          }}
        />
      </div>

      {/* ── СЕРЕДИНА: города, МАРШРУТЫ и трафик (вращается с камерой) ── */}
      <div ref={midRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        <svg
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[150vh] w-[150vw]"
          viewBox="0 0 1200 800"
          preserveAspectRatio="xMidYMid slice"
          style={{ transform: "translate(-50%,-50%) translateZ(-200px)" }}
        >
          {/* магистрали фонового трафика */}
          {TRAFFIC_PATHS.map((d, i) => (
            <path
              key={i}
              ref={(el) => {
                trafficPathRefs.current[i] = el
              }}
              d={d}
              fill="none"
              stroke="#24466e"
              strokeWidth="2"
              strokeOpacity="0.45"
            />
          ))}

          {/* активные маршруты: прорисовываются, по ним едут машины */}
          {colors.map((color, i) => (
            <g
              key={i}
              ref={(el) => {
                routeRefs.current[i] = el
              }}
              data-login-route
              opacity="0"
            >
              <path
                ref={(el) => {
                  glowRefs.current[i] = el
                }}
                fill="none"
                stroke={color}
                strokeWidth="7"
                strokeOpacity="0.13"
                strokeLinecap="round"
              />
              <path
                ref={(el) => {
                  pathRefs.current[i] = el
                }}
                fill="none"
                stroke={color}
                strokeWidth="2.6"
                strokeLinecap="round"
                style={{ filter: `drop-shadow(0 0 5px ${color}aa)` }}
              />
              <g
                ref={(el) => {
                  truckRefs.current[i] = el
                }}
                opacity="0"
              >
                <circle r="9" fill={color} opacity="0.16" />
                <rect x="-6" y="-3.5" width="12" height="7" rx="2" fill={color} stroke="#0b1120" strokeWidth="0.8" />
              </g>
            </g>
          ))}

          {/* города-узлы: янтарные ядра с пульсирующими кольцами */}
          {CITIES.map((c, i) => (
            <g key={c.name} data-login-city transform={`translate(${c.x},${c.y})`}>
              <circle
                className="city-pulse"
                r="10"
                fill="none"
                stroke="#fbbf24"
                strokeOpacity="0.5"
                strokeWidth="1.5"
                style={{ animationDelay: `${i * 0.53}s` }}
              />
              <circle r="14" fill="#fbbf24" opacity="0.07" />
              <circle r="4.5" fill="#fcd34d" />
              <circle r="9" fill="none" stroke="#fbbf24" strokeOpacity="0.25" />
              <text
                y="-15"
                textAnchor="middle"
                fontSize="13.5"
                letterSpacing="2.5"
                fill="#a9bdd9"
                opacity="0.9"
                style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", fontWeight: 600 }}
              >
                {c.name}
              </text>
            </g>
          ))}

          {/* фоновый трафик */}
          {TRAFFIC_DOTS.map((_, i) => (
            <circle
              key={i}
              ref={(el) => {
                trafficRefs.current[i] = el
              }}
              data-login-traffic
              r="2.4"
              fill="#9bd8f7"
              opacity="0.85"
            />
          ))}
        </svg>
      </div>

      {/* ── БЛИЖНИЙ ПЛАН: заголовок и ПРОЗРАЧНЫЙ экран формы ── */}
      <div ref={nearRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {headline && (
          <div
            className="absolute left-1/2 top-[18%] w-[min(92vw,560px)] text-center lg:left-[26%] lg:top-[44%] lg:w-[560px] lg:text-left"
            style={{ transform: "translate(-50%,-50%) translateZ(-160px)" }}
          >
            {headline}
          </div>
        )}

        {/* тёплое свечение за экраном формы — глубина и читаемость */}
        {!bare && (
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-[56%] h-[620px] w-[620px] lg:left-[71%] lg:top-[50%]"
            style={{
              transform: "translate(-50%,-50%) translateZ(-260px)",
              background:
                "radial-gradient(50% 50% at 50% 50%, rgba(245,158,11,0.12), transparent 70%)",
            }}
          />
        )}

        {/* форма: экран-матовое стекло поверх живой карты */}
        <div
          data-login-panel
          className="pointer-events-auto absolute left-1/2 top-[56%] w-[min(92vw,440px)] touch-auto lg:left-[71%] lg:top-[50%]"
          style={{ transform: "translate(-50%,-50%) translateZ(-120px)" }}
        >
          <div className="world-bob">
            <div className="world-panel-in">
              {bare ? (
                children
              ) : (
                <div className="relative rounded-3xl border border-white/15 bg-[#0a1424]/60 px-5 pb-5 pt-4 shadow-[0_50px_110px_-30px_rgba(0,0,0,0.85)] backdrop-blur-xl">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent"
                  />
                  {children}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
