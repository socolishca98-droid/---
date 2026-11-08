"use client"

// components/visual/login-world.tsx — мир входа «Ночной терминал»
//
// Фидбек владельца по и8: «карта хуже всех, надо ровно то, что связано с
// логистикой, маршрутами, заказами и нашей программой; страница входа —
// ЛИЦО продукта; поля логина-пароля — интегрировать, чтобы не закрывали
// полстраницы; после нажатия было мигание — убрать; гироскоп ещё -10%».
//
// Мир теперь — КОНТЕЙНЕРНЫЙ ТЕРМИНАЛ НОЧЬЮ:
//
//   • краны-«порталы» над штабелями контейнеров, тельфер ездит,
//     проблесковый маячок мигает, фонари льют тёплые конусы света,
//     грузовик с фарами неспешно проезжает по площадке;
//   • МАРШРУТ ЗАКАЗОВ — светящаяся пунктирная нить уходит от штабелей
//     к горизонту, по ней бегут точки-заказы;
//   • луна, звёзды плиткой, дальние огни, дымка;
//   • форма — компактный ПРОПУСК-ДОКУМЕНТ (№, штрихкод, поля) —
//     небольшой объект мира под лёгким углом, а не плита на полэкрана;
//   • мигание после нажатия УБРАНО: перспектива постоянна, клик ничего
//     не дёргает; ворп при входе — только мягкое ускорение дрейфа;
//   • гироскоп: коэффициенты 0.20/0.145 (ещё -10%), без кнопки:
//     Android — молча, iPhone — по первому касанию (политика Apple).
//
// Приёмка: window.__loginWorld {dolly, speed, yaw, pitch, gyro, routes,
// warp, plunges, frames} + __loginWorldLook + __loginWorldPaused +
// __loginWorldGyro. DOM: [data-login-world], [data-crane] ×2,
// [data-container] ×14, [data-route-dot] ×3, [data-login-panel],
// [data-login-doc].

import { useEffect, useMemo, useRef } from "react"

const PERSPECTIVE = 900

/** Дрейф сцены: время мира. Ворп/печать в поля его ускоряют — мягко. */
const SPEED_BASE = 260
const SPEED_WARP = 5200

/** Контейнеры: штабеля терминала (координаты карты 1200×800). */
const CONTAINER_COLORS = ["#24425f", "#5b3423", "#2a4c44", "#3c3a58", "#31517a"]
const CONTAINERS: ReadonlyArray<{ x: number; y: number; c: number }> = [
  { x: 60, y: 584, c: 0 },
  { x: 160, y: 584, c: 1 },
  { x: 260, y: 584, c: 2 },
  { x: 360, y: 584, c: 3 },
  { x: 110, y: 548, c: 2 },
  { x: 210, y: 548, c: 4 },
  { x: 310, y: 548, c: 0 },
  { x: 160, y: 512, c: 1 },
  { x: 260, y: 512, c: 3 },
  { x: 470, y: 596, c: 4 },
  { x: 570, y: 596, c: 1 },
  { x: 520, y: 560, c: 2 },
  { x: 745, y: 640, c: 3 },
  { x: 845, y: 640, c: 0 },
]

/** Маршрут заказов: от штабелей — к горизонту. */
const ROUTE_D =
  "M300,636 C480,560 640,500 800,452 C900,424 960,380 1028,332"

/** Точки-заказы на маршруте: темп и сдвиг старта. */
const ROUTE_DOTS: ReadonlyArray<{ speed: number; off: number }> = [
  { speed: 0.085, off: 0.0 },
  { speed: 0.062, off: 0.42 },
  { speed: 0.1, off: 0.78 },
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

/** Плитка звёзд: повторяется → компактный слой покрывает весь экран. */
function starTile(): string {
  const rnd = (() => {
    let s = 20261012 >>> 0
    return () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = Math.imul(s ^ (s >>> 15), 1 | s)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  })()
  const parts: string[] = []
  for (let i = 0; i < 9; i++) {
    const x = (rnd() * 100).toFixed(2)
    const y = (rnd() * 100).toFixed(2)
    const r = (0.6 + rnd() * 0.7).toFixed(2)
    const a = (0.22 + rnd() * 0.5).toFixed(2)
    parts.push(
      `radial-gradient(${r}px ${r}px at ${x}% ${y}%, rgba(226,232,240,${a}) 40%, transparent 100%)`,
    )
  }
  return parts.join(", ")
}

/** Штрихкод пропуска: детерминированные полосы. */
const BARCODE: ReadonlyArray<number> = [
  2, 1, 3, 1, 2, 2, 1, 4, 1, 2, 3, 3, 1, 2, 1, 3, 2, 1, 4, 1, 2, 2, 3, 1, 2, 1,
]

export function LoginWorld({
  variant = "logist",
  headline,
  children,
  bare = false,
}: {
  variant?: "logist" | "driver"
  /** Крупный заголовок, парящий над терминалом */
  headline?: React.ReactNode
  /** Содержимое пропуска-документа (форма) — объект мира */
  children: React.ReactNode
  /** Без рамки документа — страница приносит свою карточку */
  bare?: boolean
}): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const skyRef = useRef<HTMLDivElement | null>(null)
  const midRef = useRef<HTMLDivElement | null>(null)
  const nearRef = useRef<HTMLDivElement | null>(null)
  const routePathRef = useRef<SVGPathElement | null>(null)
  const routeDotRefs = useRef<Array<SVGCircleElement | null>>([])

  const stars = useMemo(() => starTile(), [])
  /** Тёплая или холодная сигнатура акцентов — вход логиста/водителя. */
  const accent = variant === "driver" ? "#f59e0b" : "#22d3ee"

  useEffect(() => {
    const viewport = viewportRef.current
    const sky = skyRef.current
    const mid = midRef.current
    const near = nearRef.current
    const routePath = routePathRef.current
    if (!viewport || !sky || !mid || !near || !routePath) return

    const dots = routeDotRefs.current.filter((el): el is SVGCircleElement => el != null)
    const routeLen = Math.max(1, routePath.getTotalLength())
    const dotState = ROUTE_DOTS.map((d, i) => ({ ...d, prev: (i * 0.31) % 1 }))

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true
    const narrow = window.innerWidth < 640

    let raf = 0
    let last = 0
    let running = true

    // Камера над терминалом
    let dolly = 0
    let speed = reduced ? 0 : 1600 // мягкий старт: дрейф разгоняется
    let energy = 0
    let warpT = 0
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
    // Чувствительность снижена ещё на ~10% (0.20/0.145).
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta == null || event.gamma == null) return
      if (!gyroCalib) gyroCalib = { b: event.beta, g: event.gamma }
      yawGyroT = clamp((event.gamma - gyroCalib.g) * 0.2, -12, 12)
      pitchGyroT = clamp((event.beta - gyroCalib.b) * 0.145, -8, 8)
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
    // Клик по миру НИЧЕГО не дёргает (просьба владельца: без мигания
    // после нажатия) — перспектива постоянна, рывков нет.
    const onClick = () => {
      debug.plunges += 1
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
      // ворп при входе: только мягкое ускорение дрейфа — без скачка
      // перспективы, чтобы экран не мигал
      warpT = 1
      speed = SPEED_WARP
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

      // ── дрейф камеры над терминалом ──
      energy *= Math.exp(-dt * 2)
      warpT *= Math.exp(-dt * 2)
      const targetSpeed = warpT > 0.05 ? SPEED_WARP : SPEED_BASE * (1 + Math.min(1.2, energy) * 0.4)
      speed += (targetSpeed - speed) * Math.min(1, dt * (warpT > 0.05 ? 6 : 2.2))
      if (reduced) speed = 0
      dolly += speed * dt

      // ── ракурс: курсор + палец + гироскоп (сглаженный); в фокусе
      // поля камера мягко центруется на документе ──
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

      // ── риги: лёгкий дыхательный дрейф + поворот с камерой ──
      const rot = `rotateX(${(-pitch).toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg)`
      const phase = dolly * 0.0004
      const driftSky = (5 * Math.sin(phase)).toFixed(1)
      const driftMid = (9 * Math.sin(phase + 0.7)).toFixed(1)
      sky.style.transform = `translateX(${driftSky}px) ${rot}`
      mid.style.transform = `translateX(${driftMid}px) ${rot}`
      near.style.transform = rot
      // перспектива ПОСТОЯННАЯ — никаких скачков и миганий

      // ── точки-заказы бегут по маршруту ──
      for (let i = 0; i < dots.length; i++) {
        const d = dotState[i % dotState.length]
        const p = (t * d.speed + d.off) % 1
        if (p < d.prev) debug.routes += 1
        d.prev = p
        const pt = routePath.getPointAtLength(p * routeLen)
        dots[i].setAttribute("cx", pt.x.toFixed(1))
        dots[i].setAttribute("cy", pt.y.toFixed(1))
        dots[i].style.opacity = (0.35 + 0.6 * Math.sin(Math.PI * p)).toFixed(3)
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
      // статичный кадр: терминал есть, всё замерло
      const rot = "rotateX(0deg) rotateY(0deg)"
      sky.style.transform = rot
      mid.style.transform = rot
      near.style.transform = rot
      for (let i = 0; i < dots.length; i++) {
        const d = dotState[i % dotState.length]
        const pt = routePath.getPointAtLength(d.off * routeLen)
        dots[i].setAttribute("cx", pt.x.toFixed(1))
        dots[i].setAttribute("cy", pt.y.toFixed(1))
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
  }, [variant])

  return (
    <div
      ref={viewportRef}
      data-login-world
      className="fixed inset-0 touch-none overflow-hidden bg-[radial-gradient(48%_38%_at_20%_14%,rgba(21,94,117,0.16),transparent_70%),radial-gradient(44%_34%_at_84%_10%,rgba(99,102,241,0.10),transparent_72%),radial-gradient(52%_40%_at_72%_88%,rgba(245,158,11,0.09),transparent_74%),radial-gradient(125%_95%_at_50%_30%,#0a1322_0%,#060b16_55%,#03060d_100%)]"
      style={{ perspective: "900px", perspectiveOrigin: "50% 45%" }}
    >
      {/* ── НЕБО: звёзды плиткой + луна + дальние огни ── */}
      <div ref={skyRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[165vh] w-[165vw]"
          style={{
            backgroundImage: stars,
            backgroundSize: "340px 340px",
            transform: "translate(-50%,-50%) translateZ(-420px)",
          }}
        />
        <svg
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[155vh] w-[155vw]"
          viewBox="0 0 1200 800"
          preserveAspectRatio="xMidYMid slice"
          style={{ transform: "translate(-50%,-50%) translateZ(-300px)" }}
        >
          <defs>
            <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* луна с ореолом */}
          <circle cx="300" cy="132" r="66" fill="rgba(232,237,246,0.06)" />
          <circle cx="300" cy="132" r="28" fill="#e8edf6" opacity="0.9" />
          <circle cx="290" cy="124" r="6" fill="#cdd6e4" opacity="0.5" />
          <circle cx="310" cy="142" r="4" fill="#cdd6e4" opacity="0.4" />
          {/* дымка над горизонтом */}
          <rect x="-100" y="470" width="1400" height="130" fill="url(#haze)" />
          {/* дальний план: silhouettes и огни города */}
          <g fill="#0e1830">
            <rect x="-100" y="540" width="1400" height="90" />
            <rect x="60" y="522" width="46" height="20" />
            <rect x="150" y="510" width="30" height="32" />
            <rect x="620" y="516" width="52" height="36" />
            <rect x="700" y="528" width="26" height="24" />
            <rect x="1020" y="512" width="40" height="34" />
          </g>
          <g fill="#fbbf24">
            <circle cx="90" cy="548" r="1.8" opacity="0.55" />
            <circle cx="230" cy="552" r="1.6" opacity="0.45" />
            <circle cx="420" cy="546" r="1.8" opacity="0.5" />
            <circle cx="648" cy="550" r="1.6" opacity="0.45" />
            <circle cx="860" cy="546" r="1.8" opacity="0.5" />
            <circle cx="1040" cy="552" r="1.6" opacity="0.45" />
          </g>
        </svg>
      </div>

      {/* ── ТЕРМИНАЛ: краны, контейнеры, фонари, маршрут заказов ── */}
      <div ref={midRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        <svg
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[145vh] w-[145vw]"
          viewBox="0 0 1200 800"
          preserveAspectRatio="xMidYMid slice"
          style={{ transform: "translate(-50%,-50%) translateZ(-180px)" }}
        >
          <defs>
            <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f5b942" stopOpacity="0.13" />
              <stop offset="100%" stopColor="#f5b942" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="endglow">
              <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* площадка */}
          <rect x="-100" y="618" width="1400" height="220" fill="#0a101d" />
          <rect x="-100" y="618" width="1400" height="1.5" fill="rgba(251,191,36,0.12)" />
          <g fill="rgba(255,255,255,0.03)">
            <rect x="40" y="700" width="56" height="1.4" />
            <rect x="240" y="706" width="56" height="1.4" />
            <rect x="460" y="700" width="56" height="1.4" />
            <rect x="700" y="708" width="56" height="1.4" />
            <rect x="920" y="702" width="56" height="1.4" />
          </g>
          {/* лужи-отражения */}
          <ellipse cx="200" cy="688" rx="70" ry="7" fill="rgba(120,170,220,0.045)" />
          <ellipse cx="560" cy="716" rx="90" ry="8" fill="rgba(120,170,220,0.04)" />

          {/* штабеля контейнеров */}
          {CONTAINERS.map((c, i) => (
            <g key={i} data-container>
              <rect x={c.x} y={c.y} width="92" height="36" fill={CONTAINER_COLORS[c.c]} />
              <rect x={c.x} y={c.y} width="92" height="3" fill="rgba(255,255,255,0.06)" />
              <rect x={c.x} y={c.y + 33} width="92" height="3" fill="rgba(0,0,0,0.3)" />
              <rect x={c.x + 18} y={c.y + 4} width="2.5" height="28" fill="rgba(0,0,0,0.24)" />
              <rect x={c.x + 46} y={c.y + 4} width="2.5" height="28" fill="rgba(0,0,0,0.24)" />
              <rect x={c.x + 74} y={c.y + 4} width="2.5" height="28" fill="rgba(0,0,0,0.24)" />
            </g>
          ))}

          {/* кран-портал №1: тельфер ездит, маячок мигает */}
          <g data-crane>
            <rect x="128" y="336" width="16" height="304" fill="#131d36" />
            <rect x="466" y="336" width="16" height="304" fill="#131d36" />
            <rect x="88" y="322" width="440" height="26" fill="#131d36" />
            <path
              d="M96,348 L150,324 M176,348 L230,324 M256,348 L310,324 M336,348 L390,324 M416,348 L470,324"
              stroke="#131d36"
              strokeWidth="5"
            />
            <rect x="430" y="346" width="26" height="18" fill="#182745" />
            <rect x="435" y="350" width="13" height="9" fill="#f59e0b" opacity="0.85" />
          </g>
          <circle cx="308" cy="316" r="4" fill="#ef4444" className="beacon" />
          <g className="crane-trolley">
            <rect x="196" y="348" width="28" height="14" fill="#182745" />
            <rect x="208" y="362" width="3" height="118" fill="#0e1730" />
            <rect x="188" y="480" width="54" height="8" fill="#182745" />
          </g>

          {/* дальний кран №2 */}
          <g data-crane fill="#0f1830">
            <rect x="880" y="430" width="10" height="210" />
            <rect x="1030" y="430" width="10" height="210" />
            <rect x="856" y="420" width="280" height="18" />
          </g>
          <circle cx="1005" cy="414" r="3" fill="#ef4444" className="beacon" style={{ animationDelay: "1.1s" }} />

          {/* фонари с конусами тёплого света */}
          <g>
            <rect x="238" y="462" width="6" height="178" fill="#182742" />
            <rect x="226" y="455" width="30" height="8" fill="#182742" />
            <circle cx="241" cy="466" r="3" fill="#fbbf24" opacity="0.9" />
            <polygon points="241,468 148,662 334,662" fill="url(#cone)" />
          </g>
          <g>
            <rect x="612" y="462" width="6" height="178" fill="#182742" />
            <rect x="600" y="455" width="30" height="8" fill="#182742" />
            <circle cx="615" cy="466" r="3" fill="#fbbf24" opacity="0.9" />
            <polygon points="615,468 536,662 694,662" fill="url(#cone)" />
          </g>

          {/* МАРШРУТ ЗАКАЗОВ: нить к горизонту, точки-заказы бегут */}
          <path
            ref={routePathRef}
            d={ROUTE_D}
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2"
            strokeOpacity="0.55"
            strokeDasharray="1 9"
            strokeLinecap="round"
          />
          <circle cx="1028" cy="332" r="12" fill="url(#endglow)" />
          <circle cx="1028" cy="332" r="3.5" fill="#67e8f9" />
          {ROUTE_DOTS.map((_, i) => (
            <circle
              key={i}
              ref={(el) => {
                routeDotRefs.current[i] = el
              }}
              data-route-dot
              r="3.2"
              fill="#67e8f9"
              opacity="0.9"
              style={{ filter: "drop-shadow(0 0 4px #22d3ee)" }}
            />
          ))}

          {/* грузовик с фарами неспешно проезжает площадку */}
          <g className="truck-pass">
            <polygon points="0,704 96,688 96,724" fill="rgba(253,230,138,0.10)" />
            <circle cx="0" cy="703" r="2.6" fill="#fde68a" />
            <circle cx="0" cy="712" r="2.6" fill="#fde68a" />
          </g>
        </svg>
      </div>

      {/* ── БЛИЖНИЙ ПЛАН: заголовок и ПРОПУСК-документ формы ── */}
      <div ref={nearRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {headline && (
          <div
            className="absolute left-1/2 top-[15%] w-[min(90vw,520px)] text-center lg:left-[24%] lg:top-[42%] lg:w-[520px] lg:text-left"
            style={{ transform: "translate(-50%,-50%) translateZ(-150px)" }}
          >
            {headline}
          </div>
        )}

        {/* свечение за документом — глубина и читаемость */}
        {!bare && (
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-[57%] h-[520px] w-[520px] lg:left-[68%] lg:top-[48%]"
            style={{
              transform: "translate(-50%,-50%) translateZ(-130px)",
              background: `radial-gradient(50% 50% at 50% 50%, ${variant === "driver" ? "rgba(245,158,11,0.10)" : "rgba(34,211,238,0.10)"}, transparent 70%)`,
            }}
          />
        )}

        {/* форма: компактный ПРОПУСК — документ мира, не плита на
            полэкрана. Номер, поля, штрихкод — язык терминала */}
        <div
          data-login-panel
          className="pointer-events-auto absolute left-1/2 top-[57%] w-[min(86vw,340px)] touch-auto lg:left-[68%] lg:top-[48%]"
          style={{ transform: "translate(-50%,-50%) translateZ(-110px) rotateY(-4deg)" }}
        >
          <div className="world-bob">
            <div className="world-panel-in">
              {bare ? (
                children
              ) : (
                <div
                  data-login-doc
                  className="relative rounded-2xl border border-white/15 bg-[#0c1526]/72 px-5 pb-4 pt-3.5 shadow-[0_40px_90px_-25px_rgba(0,0,0,0.9)] backdrop-blur-xl"
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-5 top-0 h-px"
                    style={{ background: `linear-gradient(90deg, transparent, ${accent}b3, transparent)` }}
                  />
                  {/* шапка пропуска */}
                  <div className="flex items-center justify-between border-b border-dashed border-white/15 pb-2">
                    <p
                      className="text-[10px] font-bold tracking-[0.28em]"
                      style={{ color: variant === "driver" ? "#fbbf24" : "#67e8f9" }}
                    >
                      {variant === "driver" ? "ПРОПУСК · ВОДИТЕЛЬ" : "ПРОПУСК · ДОСТУП"}
                    </p>
                    <p className="font-mono text-[10px] text-slate-500">№ 042-ЯР</p>
                  </div>
                  {children}
                  {/* низ пропуска: штрихкод */}
                  <div className="mt-3 flex items-end justify-between border-t border-dashed border-white/15 pt-2.5">
                    <div className="flex h-6 items-end gap-[2px]" aria-hidden="true">
                      {BARCODE.map((wd, i) => (
                        <span key={i} className="bg-white/25" style={{ width: wd, height: i % 3 === 0 ? 24 : 17 }} />
                      ))}
                    </div>
                    <p className="font-mono text-[9px] tracking-wider text-slate-500">ЯРОСЛАВЛЬ · 24/7</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
