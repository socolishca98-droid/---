"use client"

// components/visual/login-world.tsx — мир входа «Терминал в объёме»
//
// Фидбек владельца по и10: «гироскоп сломали — работал же хоть и не
// четко, теперь уведомление чтобы я что-то открывал. Сцена не
// нравится, хочется больше объёма и 3D».
//
// Что changed:
//   • УВЕДОМЛЕНИЕ УБРАНО ПОЛНОСТЬЮ — никаких подсказок «откройте
//     вкладку»: владелец прав, оно выскакивало раньше времени (системный
//     диалог Apple читается дольше таймера) и залипало;
//   • ГИРОСКОП ЧЁТЧЕ: 0.32/0.24 (было 0.20/0.145 — «не четко»; когда-то
//     0.6 — «слишком»); запрос разрешения висит на трёх жестах сразу;
//   • ОБЪЁМ: камера ЛЕТИТ ВПЕРЁД сквозь терминал — штабеля контейнеров,
//     краны-порталы и фонари пролетают мимо на разных глубинах и
//     перерабатываются впереди (система, которая давала объём в и6/и7);
//     земля — настоящая плоскость в перспективе с бегущей разметкой и
//     центральной ниткой маршрута; искры-частицы у самой камеры;
//     точки-заказы бегут по нитке навстречу.
//
// Приёмка: window.__loginWorld {dolly, speed, yaw, pitch, gyro, passed,
// warp, plunges, frames} + __loginWorldLook + __loginWorldPaused +
// __loginWorldGyro. DOM: [data-login-world], [data-stack] ×10,
// [data-crane] ×3, [data-pole] ×6, [data-login-mote] ×14,
// [data-route-dot] ×5, [data-ground], [data-login-panel],
// [data-login-doc].

import { useEffect, useMemo, useRef } from "react"

const PERSPECTIVE = 900

/** Полёт сквозь терминал. Ворп при входе — мягкое ускорение, БЕЗ
    скачков перспективы (мигание после нажатия исключено). */
const SPEED_BASE = 520
const SPEED_WARP = 5400

/** Двор: суммарная «длина» цикла переработки элементов (px мира). */
const YARD_TOTAL = 7500
const MOTE_TOTAL = 4200

const CONTAINER_COLORS = ["#24425f", "#5b3423", "#2a4c44", "#3c3a58", "#31517a"]

/** Штабеля контейнеров: x у оси полёта (y подбирается по высоте). */
const STACK_X: ReadonlyArray<number> = [
  -780, -560, -330, -120, 90, 300, 520, 700, -450, 420,
]
/** Краны-порталы: выше и реже. */
const CRANE_X: ReadonlyArray<number> = [-520, 560, -260]
/** Фонари с тёплыми конусами. */
const POLE_X: ReadonlyArray<number> = [-140, 180, -420, 460, -660, 660]
/** Точки-заказы: по центральной нитке маршрута. */
const DOT_X: ReadonlyArray<number> = [-50, 0, 40, -30, 20]

type WorldDebug = {
  dolly: number
  speed: number
  yaw: number
  pitch: number
  gyro: boolean
  passed: number
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

/** Штабель контейнеров — узор рядов (детерминированные варианты). */
function StackArt({ variant }: { variant: number }) {
  const rows =
    variant % 3 === 0
      ? [
          [0, 1, 2],
          [1, 2],
        ]
      : variant % 3 === 1
        ? [
            [0, 1],
            [1, 2, 0],
          ]
        : [
            [1, 2],
            [0],
            [1],
          ]
  return (
    <svg width="240" height="160" viewBox="0 0 240 160" aria-hidden="true">
      {rows.map((row, r) =>
        row.map((c, i) => {
          const x = 8 + (variant % 3 === 2 ? i * 82 : i * 82) + (r % 2) * 20
          const y = 118 - r * 40
          return (
            <g key={`${r}-${i}`}>
              <rect x={x} y={y} width="76" height="36" fill={CONTAINER_COLORS[(c + variant) % 5]} />
              <rect x={x} y={y} width="76" height="3" fill="rgba(255,255,255,0.07)" />
              <rect x={x} y={y + 33} width="76" height="3" fill="rgba(0,0,0,0.32)" />
              <rect x={x + 15} y={y + 4} width="2.5" height="28" fill="rgba(0,0,0,0.26)" />
              <rect x={x + 38} y={y + 4} width="2.5" height="28" fill="rgba(0,0,0,0.26)" />
              <rect x={x + 61} y={y + 4} width="2.5" height="28" fill="rgba(0,0,0,0.26)" />
            </g>
          )
        }),
      )}
      <ellipse cx="120" cy="150" rx="110" ry="7" fill="rgba(0,0,0,0.4)" />
    </svg>
  )
}

/** Кран-портал: тельфер ездит, маячок мигает. */
function CraneArt() {
  return (
    <svg width="460" height="330" viewBox="0 0 460 330" aria-hidden="true">
      <rect x="60" y="66" width="14" height="264" fill="#131d36" />
      <rect x="386" y="66" width="14" height="264" fill="#131d36" />
      <rect x="20" y="46" width="440" height="26" fill="#131d36" />
      <path
        d="M28,72 L74,48 M104,72 L150,48 M180,72 L226,48 M256,72 L302,48 M332,72 L378,48 M408,72 L454,48"
        stroke="#131d36"
        strokeWidth="5"
      />
      <rect x="352" y="70" width="24" height="16" fill="#182745" />
      <rect x="356" y="73" width="12" height="8" fill="#f59e0b" opacity="0.85" />
      <g className="crane-trolley">
        <rect x="120" y="72" width="26" height="13" fill="#182745" />
        <rect x="131" y="85" width="3" height="110" fill="#0e1730" />
        <rect x="112" y="195" width="52" height="8" fill="#182745" />
      </g>
      <circle cx="230" cy="38" r="4.5" fill="#ef4444" className="beacon" />
    </svg>
  )
}

/** Фонарь: столб + лампа + тёплый конус света (один SVG — дёшево). */
function PoleArt() {
  return (
    <svg width="180" height="280" viewBox="0 0 180 280" aria-hidden="true">
      <rect x="87" y="26" width="6" height="254" fill="#182742" />
      <rect x="76" y="18" width="28" height="10" rx="3" fill="#182742" />
      <polygon points="86,36 94,36 176,280 4,280" fill="rgba(245,185,66,0.09)" />
      <circle cx="90" cy="32" r="7" fill="rgba(251,191,36,0.25)" />
      <circle cx="90" cy="32" r="3.5" fill="#fbbf24" />
    </svg>
  )
}

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
  const moveRef = useRef<HTMLDivElement | null>(null)
  const nearRef = useRef<HTMLDivElement | null>(null)
  const groundRef = useRef<HTMLDivElement | null>(null)
  const lineRef = useRef<HTMLDivElement | null>(null)
  const yardRefs = useRef<Array<HTMLDivElement | null>>([])

  const stars = useMemo(() => starTile(), [])
  /** Тёплая или холодная сигнатура акцентов — вход логиста/водителя. */
  const accent = variant === "driver" ? "#f59e0b" : "#22d3ee"

  useEffect(() => {
    const viewport = viewportRef.current
    const sky = skyRef.current
    const mid = midRef.current
    const move = moveRef.current
    const near = nearRef.current
    const ground = groundRef.current
    const line = lineRef.current
    if (!viewport || !sky || !mid || !move || !near || !ground || !line) return

    // Двор: все элементы, которые пролетают мимо камеры и рождаются
    // впереди. y — по высоте (земля на +96 мира), z — впереди по оси.
    const els = yardRefs.current.filter((el): el is HTMLDivElement => el != null)
    const yard: Array<{
      el: HTMLDivElement
      baseX: number
      x: number
      y: number
      z: number
      total: number
      i: number
    }> = []
    let k = 0
    STACK_X.forEach((x, i) => {
      yard.push({ el: els[k], baseX: x, x, y: 16, z: 500 + i * 750, total: YARD_TOTAL, i: k })
      k += 1
    })
    CRANE_X.forEach((x, i) => {
      yard.push({ el: els[k], baseX: x, x, y: -69, z: 1200 + i * 2500, total: YARD_TOTAL, i: k })
      k += 1
    })
    POLE_X.forEach((x, i) => {
      yard.push({ el: els[k], baseX: x, x, y: -44, z: 400 + i * 1250, total: YARD_TOTAL, i: k })
      k += 1
    })
    DOT_X.forEach((x, i) => {
      yard.push({ el: els[k], baseX: x, x, y: 90, z: 300 + i * 1500, total: YARD_TOTAL, i: k })
      k += 1
    })
    // искры-частицы у самой камеры (скорость полёта читается сразу)
    const MOTE_COLORS = ["rgba(251,191,36,0.9)", "rgba(103,232,249,0.85)", "rgba(226,232,240,0.8)"]
    for (let m = 0; m < 14; m++) {
      const el = els[k]
      if (!el) break
      const color = MOTE_COLORS[m % 3]
      const s = 3 + ((m * 7) % 5)
      el.style.width = `${s}px`
      el.style.height = `${s}px`
      el.style.background = color
      el.style.boxShadow = `0 0 ${s * 3}px ${color}`
      const mx = -900 + ((m * 367) % 1800)
      const my = -140 + ((m * 431) % 480)
      yard.push({ el, baseX: mx, x: mx, y: my, z: 240 + m * 300, total: MOTE_TOTAL, i: k })
      k += 1
    }
    const yardTransform = (e: { x: number; y: number; z: number }) =>
      `translate3d(${Math.round(e.x)}px, ${Math.round(e.y)}px, ${-Math.round(e.z)}px)`

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true
    const narrow = window.innerWidth < 640

    let raf = 0
    let last = 0
    let running = true

    // Камера: летит сквозь терминал
    let dolly = 0
    let speed = reduced ? 0 : 2600 // кинематографичный прилёт на разгоне
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
      passed: 0,
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

    // ── гироскоп: БЕЗ КНОПКИ и БЕЗ УВЕДОМЛЕНИЙ ──
    // Чувствительность поднята до «чётко»: 0.32/0.24 (после 0.20 «не
    // четко», когда-то 0.6 «слишком»). Запрос разрешения — на трёх
    // жестах сразу (Safari капризен), сам вызов одноразовый.
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta == null || event.gamma == null) return
      if (!gyroCalib) gyroCalib = { b: event.beta, g: event.gamma }
      yawGyroT = clamp((event.gamma - gyroCalib.g) * 0.32, -14, 14)
      pitchGyroT = clamp((event.beta - gyroCalib.b) * 0.24, -9, 9)
      if (!gyroActive) {
        gyroActive = true
        debug.gyro = true
      }
    }
    let gyroRequested = false
    const attachGyro = () => {
      window.addEventListener("deviceorientation", onOrientation)
      if (gyroRequested) return
      gyroRequested = true
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
    const gestures: ReadonlyArray<"pointerdown" | "touchend" | "click"> = [
      "pointerdown",
      "touchend",
      "click",
    ]
    if (touchCapable && D) {
      if (typeof D.requestPermission !== "function") {
        attachGyro() // Android и прочие без промпта — сразу и молча
      } else {
        for (const g of gestures) {
          window.addEventListener(g, onFirstTouch, { capture: true, passive: true })
        }
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
      // ворп при входе: только мягкое ускорение полёта — без скачка
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

      // ── полёт сквозь терминал ──
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
      yawGyro += (yawGyroT - yawGyro) * Math.min(1, dt * 5.5)
      pitchGyro += (pitchGyroT - pitchGyro) * Math.min(1, dt * 5.5)
      aim += ((focused ? 1 : 0) - aim) * Math.min(1, dt * 3)
      const swayY = Math.sin(t * 0.14) * 0.3
      const swayP = Math.sin(t * 0.17 + 1.2) * 0.18
      const blend = 1 - aim * 0.06
      yaw = (yawMouse + yawDrag + yawGyro) * blend + swayY
      pitch = (pitchMouse + pitchDrag + pitchGyro) * blend + swayP

      // ── риги: камера летит (move), остальные вращаются с ней ──
      const rot = `rotateX(${(-pitch).toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg)`
      sky.style.transform = rot
      mid.style.transform = rot
      near.style.transform = rot
      move.style.transform = `translateZ(${dolly.toFixed(1)}px) ${rot}`
      // перспектива ПОСТОЯННАЯ — никаких скачков и миганий

      // ── земля: разметка полосы-«взлётки» бежит под камерой ──
      line.style.backgroundPositionY = `${-((dolly * 0.9) % 72).toFixed(1)}px`

      // ── двор: штабеля, краны, фонари, точки и искры пролетают
      // мимо и рождаются впереди — объём и скорость ──
      for (const e of yard) {
        if (dolly - e.z > -380) {
          e.z += e.total
          debug.passed += 1
          e.x = e.baseX + (((debug.passed + e.i) % 3) - 1) * 70
          e.el.style.transform = yardTransform(e)
        }
        const depth = e.z - dolly
        e.el.style.opacity = clamp(depth / 420, 0, 1).toFixed(3)
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
      move.style.transform = rot
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
      for (const g of gestures) {
        window.removeEventListener(g, onFirstTouch, true)
      }
    }
  }, [variant])

  return (
    <div
      ref={viewportRef}
      data-login-world
      className="fixed inset-0 touch-none overflow-hidden bg-[radial-gradient(48%_38%_at_20%_14%,rgba(21,94,117,0.16),transparent_70%),radial-gradient(44%_34%_at_84%_10%,rgba(99,102,241,0.10),transparent_72%),radial-gradient(52%_40%_at_72%_88%,rgba(245,158,11,0.09),transparent_74%),radial-gradient(125%_95%_at_50%_30%,#0a1322_0%,#060b16_55%,#03060d_100%)]"
      style={{ perspective: "900px", perspectiveOrigin: "50% 45%" }}
    >
      {/* ── НЕБО: звёзды плиткой, луна, дальние огни ── */}
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
          <circle cx="300" cy="132" r="66" fill="rgba(232,237,246,0.06)" />
          <circle cx="300" cy="132" r="28" fill="#e8edf6" opacity="0.9" />
          <circle cx="290" cy="124" r="6" fill="#cdd6e4" opacity="0.5" />
          <circle cx="310" cy="142" r="4" fill="#cdd6e4" opacity="0.4" />
          <rect x="-100" y="470" width="1400" height="130" fill="url(#haze)" />
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

      {/* ── ЗЕМЛЯ: плоскость в перспективе, разметка и нитка маршрута
          бегут под камерой (движение вперёд) ── */}
      <div ref={midRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        <div
          ref={groundRef}
          data-ground
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[120vw] w-[120vw]"
          style={{
            transform: "translate(-50%,-50%) translateY(56px) rotateX(90deg)",
            backgroundColor: "#0a101d",
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 2px, transparent 2px 96px)",
          }}
        >
          {/* полоса-«взлётка»: боковые линии + центральная нитка маршрута,
              пунктир бежит навстречу камере */}
          <div
            ref={lineRef}
            className="absolute left-1/2 top-0 h-full w-[360px] -translate-x-1/2"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent 0 8px, rgba(255,255,255,0.06) 8px 10px, transparent 10px calc(100% - 10px), rgba(255,255,255,0.06) calc(100% - 10px) calc(100% - 8px), transparent calc(100% - 8px)), repeating-linear-gradient(180deg, rgba(34,211,238,0.55) 0 26px, transparent 26px 72px)",
              backgroundPosition: "0 0, 0 0",
              backgroundSize: "100% 100%, 12px 100%",
              backgroundRepeat: "no-repeat, repeat-y",
              boxShadow: "0 0 18px rgba(34,211,238,0.18)",
            }}
          />
        </div>
      </div>

      {/* дымка у горизонта — СТАТИЧНЫЙ слой (не вращается с камерой:
          композитор не пересобирает его каждый кадр) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-[36%] h-[24%] w-full"
        style={{
          background:
            "linear-gradient(to bottom, rgba(6,11,22,0) 0%, rgba(6,11,22,0.8) 35%, rgba(6,11,22,0.5) 45%, rgba(6,11,22,0.15) 65%, rgba(6,11,22,0) 85%)",
        }}
      />

      {/* ── ДВОР: камера летит СКВОЗЬ двор — штабеля, краны, фонари,
          точки-заказы и искры пролетают мимо на разных глубинах ── */}
      <div ref={moveRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {STACK_X.map((x, i) => (
          <div
            key={`s${i}`}
            ref={(el) => {
              yardRefs.current[i] = el
            }}
            data-stack
            aria-hidden="true"
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate3d(${x}px, 16px, ${-(500 + i * 750)}px)` }}
          >
            <StackArt variant={i} />
          </div>
        ))}
        {CRANE_X.map((x, i) => (
          <div
            key={`c${i}`}
            ref={(el) => {
              yardRefs.current[STACK_X.length + i] = el
            }}
            data-crane
            aria-hidden="true"
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate3d(${x}px, -69px, ${-(1200 + i * 2500)}px)` }}
          >
            <CraneArt />
          </div>
        ))}
        {POLE_X.map((x, i) => (
          <div
            key={`p${i}`}
            ref={(el) => {
              yardRefs.current[STACK_X.length + CRANE_X.length + i] = el
            }}
            data-pole
            aria-hidden="true"
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate3d(${x}px, -44px, ${-(400 + i * 1250)}px)` }}
          >
            <PoleArt />
          </div>
        ))}
        {DOT_X.map((x, i) => (
          <div
            key={`d${i}`}
            ref={(el) => {
              yardRefs.current[STACK_X.length + CRANE_X.length + POLE_X.length + i] = el
            }}
            data-route-dot
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 h-[10px] w-[10px] rounded-full bg-cyan-300"
            style={{
              transform: `translate3d(${x}px, 90px, ${-(300 + i * 1500)}px)`,
              boxShadow: "0 0 12px rgba(103,232,249,0.9)",
            }}
          />
        ))}
        {Array.from({ length: 14 }, (_, i) => (
          <div
            key={`m${i}`}
            ref={(el) => {
              yardRefs.current[STACK_X.length + CRANE_X.length + POLE_X.length + DOT_X.length + i] = el
            }}
            data-login-mote
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{ width: 4, height: 4 }}
          />
        ))}
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

        {/* форма: компактный ПРОПУСК — документ мира. Номер, поля,
            штрихкод — язык терминала; стекло призрачное */}
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
                  className="relative rounded-2xl border border-white/10 bg-[#0b1322]/40 px-5 pb-4 pt-3.5 shadow-[0_30px_70px_-25px_rgba(0,0,0,0.8)] backdrop-blur-xl"
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-5 top-0 h-px"
                    style={{ background: `linear-gradient(90deg, transparent, ${accent}b3, transparent)` }}
                  />
                  {/* шапка пропуска */}
                  <div className="flex items-center justify-between border-b border-dashed border-white/10 pb-2">
                    <p
                      className="text-[10px] font-bold tracking-[0.28em] opacity-80"
                      style={{ color: variant === "driver" ? "#fbbf24" : "#67e8f9" }}
                    >
                      {variant === "driver" ? "ПРОПУСК · ВОДИТЕЛЬ" : "ПРОПУСК · ДОСТУП"}
                    </p>
                    <p className="font-mono text-[10px] text-slate-500/90">№ 042-ЯР</p>
                  </div>
                  {children}
                  {/* низ пропуска: штрихкод */}
                  <div className="mt-3 flex items-end justify-between border-t border-dashed border-white/10 pt-2.5">
                    <div className="flex h-6 items-end gap-[2px]" aria-hidden="true">
                      {BARCODE.map((wd, i) => (
                        <span key={i} className="bg-white/20" style={{ width: wd, height: i % 3 === 0 ? 24 : 17 }} />
                      ))}
                    </div>
                    <p className="font-mono text-[9px] tracking-wider text-slate-500/90">ЯРОСЛАВЛЬ · 24/7</p>
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
