"use client"

// components/visual/login-world.tsx — 3D-мир входа «Звёздный рейс»
//
// Смена сцены по просьбе владельца: «дорогу смени, проваливаемся под
// землю, гироскоп очень чувствительный, экран с таблицей бесит — давай
// ему прозрачность». Мир теперь — ПОЛЁТ СКВОЗЬ ПРОСТРАНСТВО:
//
//   • дорога и земля УБРАНЫ — провалиться некуда: звёзды во все стороны;
//   • модули программы — ГОЛОГРАММЫ, разбросанные в объёме: летят мимо
//     под разными углами, каждая парит и покачивается;
//   • светлячки-частицы проносятся у самой камеры — ощущение скорости;
//   • форма — ПРОЗРАЧНЫЙ голографический экран (матовое стекло) — тот же
//     язык, что у модулей: она «внедрена» в систему мира, а не лежит
//     поверх; сквозь неё видно звёзды;
//   • гироскоп успокоен: коэффициенты снижены, показания сглаживаются
//     (без дрожи), наклон ограничен.
//
// Техника прежняя: CSS-3D, три рига (небо / объём / ближний план),
// камера едет вперёд (dolly) с «переработкой» координат — мир бесконечен.
// Приёмка: window.__loginWorld {dolly, speed, yaw, pitch, gyro, gates,
// warp, plunges} + __loginWorldLook + __loginWorldPaused +
// __loginWorldGyro. DOM: [data-login-world], [data-login-gate],
// [data-login-mote], [data-login-panel], [data-gyro-pill].

import { useEffect, useMemo, useRef, useState } from "react"
import { Compass } from "lucide-react"

const PERSPECTIVE = 900

const PANEL_COUNT = 6
const PANEL_FIRST = 500
const PANEL_STEP = 800
const PANEL_TOTAL = PANEL_COUNT * PANEL_STEP

const MOTE_STEP = 170

const SPEED_BASE = 320
const SPEED_WARP = 5400

/** Модули программы (вход логиста) — голографические экраны в полёте. */
const LOGIST_SIGNS: ReadonlyArray<{ title: string; sub: string }> = [
  { title: "Живая карта", sub: "машины и ETA в реальном времени" },
  { title: "Маршруты OSRM", sub: "плечи и оптимизация" },
  { title: "Биржа грузов", sub: "ATI.SU · Cargomart" },
  { title: "Документы", sub: "статусы рейсов без Excel" },
  { title: "Аналитика", sub: "KPI парка в один экран" },
  { title: "Роли и доступы", sub: "у каждой стороны — своё окно" },
]

/** Экраны на дороге водителя — его собственные разделы. */
const DRIVER_SIGNS: ReadonlyArray<{ title: string; sub: string }> = [
  { title: "Мои рейсы", sub: "заявки и статусы дня" },
  { title: "Маршрут рейса", sub: "точки, погрузка, выгрузка" },
  { title: "Документы и фото", sub: "сканы прямо в рейсе" },
  { title: "Чат с логистом", sub: "вопрос — за минуту" },
  { title: "Техобслуживание", sub: "заявки на ремонт" },
  { title: "Машина", sub: "пробег и состояние" },
]

/** Где голографмы висят в объёме (смещения от оси камеры, px мира). */
const PANEL_SPOTS: ReadonlyArray<{ x: number; y: number; ry: number }> = [
  { x: -280, y: -430, ry: 9 },
  { x: 300, y: -380, ry: -11 },
  { x: -660, y: -150, ry: 15 },
  { x: 680, y: -190, ry: -16 },
  { x: -430, y: 140, ry: 12 },
  { x: 450, y: 100, ry: -12 },
]

type WorldDebug = {
  dolly: number
  speed: number
  yaw: number
  pitch: number
  gyro: boolean
  gates: number
  warp: number
  plunges: number
  frames: number
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Детерминированный ГПСЧ — одни и те же звёзды на сервере и клиенте. */
function mulberry(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Слой звёзд: радиальные градиенты, сгенерированные один раз. */
function starField(count: number, seed: number, rMin: number, rMax: number) {
  const rnd = mulberry(seed)
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    const x = (rnd() * 100).toFixed(2)
    const y = (rnd() * 100).toFixed(2)
    const r = (rMin + rnd() * (rMax - rMin)).toFixed(2)
    const a = (0.25 + rnd() * 0.55).toFixed(2)
    parts.push(
      `radial-gradient(${r}px ${r}px at ${x}% ${y}%, rgba(226,232,240,${a}) 40%, transparent 100%)`,
    )
  }
  return parts.join(", ")
}

type Mote = { x: number; y: number; z: number; s: number; color: string; glow: string }

export function LoginWorld({
  variant = "logist",
  headline,
  children,
  bare = false,
}: {
  variant?: "logist" | "driver"
  /** Крупный заголовок, парящий в пространстве */
  headline?: React.ReactNode
  /** Содержимое голографического экрана (форма) — объект мира */
  children: React.ReactNode
  /** Панель без плиты — страница приносит свою карточку */
  bare?: boolean
}): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const skyRef = useRef<HTMLDivElement | null>(null)
  const moveRef = useRef<HTMLDivElement | null>(null)
  const nearRef = useRef<HTMLDivElement | null>(null)
  const panelRefs = useRef<Array<HTMLDivElement | null>>([])
  const moteRefs = useRef<Array<HTMLDivElement | null>>([])

  /** Плитка звёзд: повторяется → компактный слой покрывает весь экран. */
  const starsFar = useMemo(() => starField(9, 20261012, 0.6, 1.3), [])
  const starsNear = useMemo(() => starField(6, 777001, 1.0, 2.1), [])

  /** Светлячки: начальные позиции детерминированы (гидратация). */
  const motes = useMemo<Mote[]>(() => {
    const rnd = mulberry(424242)
    const colors = [
      "rgba(125,211,252,0.95)",
      "rgba(251,146,60,0.85)",
      "rgba(226,232,240,0.9)",
      "rgba(165,180,252,0.85)",
    ]
    return Array.from({ length: 26 }, (_, i) => {
      const color = colors[Math.floor(rnd() * colors.length)]
      const s = 3 + rnd() * 5
      return {
        x: Math.round(-950 + rnd() * 1900),
        y: Math.round(-560 + rnd() * 1120),
        z: 240 + i * MOTE_STEP,
        s: Math.round(s),
        color,
        glow: color.replace(/,([\d.]+)\)$/, (_, a) => `,${(Number(a) * 0.5).toFixed(2)})`),
      }
    })
  }, [])

  const [pill, setPill] = useState<"hidden" | "offer" | "on" | "off">("hidden")
  const gyroRequestRef = useRef<(() => Promise<boolean>) | null>(null)

  const signs = variant === "driver" ? DRIVER_SIGNS : LOGIST_SIGNS

  useEffect(() => {
    const viewport = viewportRef.current
    const sky = skyRef.current
    const move = moveRef.current
    const near = nearRef.current
    if (!viewport || !sky || !move || !near) return

    const panels = panelRefs.current.filter((el): el is HTMLDivElement => el != null)
    const motesEls = moteRefs.current.filter((el): el is HTMLDivElement => el != null)
    const panelZ = panels.map((_, i) => PANEL_FIRST + i * PANEL_STEP)
    const moteState = motesEls.map((_, i) => ({ ...motes[i] }))
    const moteTotal = motesEls.length * MOTE_STEP

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true
    const narrow = window.innerWidth < 640

    let raf = 0
    let last = 0
    let running = true

    // Камера
    let dolly = 0
    let speed = reduced ? 0 : 3000 // кинематографичный прилёт на разгоне
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
      gates: 0,
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

    // ── гироскоп (спокойный: коэффициенты малые + сглаживание) ──
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta == null || event.gamma == null) return
      if (!gyroCalib) gyroCalib = { b: event.beta, g: event.gamma }
      yawGyroT = clamp((event.gamma - gyroCalib.g) * 0.22, -12, 12)
      pitchGyroT = clamp((event.beta - gyroCalib.b) * 0.16, -8, 8)
      if (!gyroActive) {
        gyroActive = true
        debug.gyro = true
        setPill("on")
        window.setTimeout(() => setPill("hidden"), 1800)
      }
    }
    const requestGyro = async (): Promise<boolean> => {
      const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } })
        .DeviceOrientationEvent
      if (!D) {
        setPill("off")
        window.setTimeout(() => setPill("hidden"), 2200)
        return false
      }
      // Слушателя ставим СРАЗУ; iOS дополнительно просит разрешение по
      // жесту — пилюля и есть этот жест
      window.addEventListener("deviceorientation", onOrientation)
      try {
        if (typeof D.requestPermission === "function") void D.requestPermission().catch(() => {})
      } catch {
        /* без UI промпт виснет — не страшно, слушатель уже стоит */
      }
      return true
    }
    gyroRequestRef.current = requestGyro
    w.__loginWorldGyro = requestGyro

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
      target.closest("[data-login-panel], form, button, a, input, textarea, label, [data-gyro-pill]") != null
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

      // ── движение камеры ──
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

      // ── риги ──
      const rot = `rotateX(${(-pitch).toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg)`
      sky.style.transform = rot
      near.style.transform = rot
      move.style.transform = `translateZ(${dolly.toFixed(1)}px) ${rot}`
      viewport.style.perspective = `${(PERSPECTIVE - warpT * 170 - fovKick * 80).toFixed(0)}px`

      // ── голографмы-модули: пролетели — улетают вперёд, в новый угол ──
      for (let i = 0; i < panels.length; i++) {
        const el = panels[i]
        let z = panelZ[i]
        if (dolly - z > -280) {
          z += PANEL_TOTAL
          panelZ[i] = z
          debug.gates += 1
          const spot = PANEL_SPOTS[(i + debug.gates) % PANEL_SPOTS.length]
          el.style.transform = `translate3d(${spot.x}px, ${spot.y}px, ${-z}px) rotateY(${spot.ry}deg)`
        }
        const depth = z - dolly
        el.style.opacity = clamp(depth / 280, 0, 1).toFixed(3)
      }

      // ── светлячки: проносятся мимо камеры и рождаются впереди ──
      for (let i = 0; i < motesEls.length; i++) {
        const el = motesEls[i]
        const m = moteState[i]
        if (dolly - m.z > -60) {
          m.z += moteTotal
          m.x = Math.round(-950 + Math.random() * 1900)
          m.y = Math.round(-560 + Math.random() * 1120)
          el.style.transform = `translate3d(${m.x}px, ${m.y}px, ${-m.z}px)`
        }
        const depth = m.z - dolly
        el.style.opacity = clamp(depth / 120, 0, 1).toFixed(3)
      }

      debug.frames += 1
      debug.dolly = dolly
      debug.speed = speed
      debug.yaw = yaw
      debug.pitch = pitch
      debug.warp = warpT
    }

    // Пилюля гироскопа — только на сенсорных экранах
    const touchCapable =
      "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0
    const pillTimer = touchCapable
      ? window.setTimeout(() => setPill("offer"), 900)
      : null

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
      // статичный кадр: мир есть, но не движется
      const rot = "rotateX(0deg) rotateY(0deg)"
      sky.style.transform = rot
      near.style.transform = rot
      move.style.transform = rot
    } else {
      raf = requestAnimationFrame(frame)
    }

    return () => {
      running = false
      cancelAnimationFrame(raf)
      if (pillTimer) window.clearTimeout(pillTimer)
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
    }
  }, [variant, motes])

  return (
    <div
      ref={viewportRef}
      data-login-world
      className="fixed inset-0 touch-none overflow-hidden bg-[radial-gradient(46%_36%_at_36%_24%,rgba(99,102,241,0.16),transparent_70%),radial-gradient(42%_32%_at_70%_76%,rgba(251,146,60,0.12),transparent_70%),radial-gradient(130%_100%_at_50%_0%,#0d1226_0%,#070912_48%,#04050b_100%)]"
      style={{ perspective: "900px", perspectiveOrigin: "50% 45%" }}
    >
      {/* ── НЕБО: звёзды во все стороны + туманности (вращается с камерой) ── */}
      <div ref={skyRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {/* звёзды плиткой: компактные слои (гигантские слои душили
            композитор — кадры замирали) */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[150vh] w-[150vw]"
          style={{
            backgroundImage: starsFar,
            backgroundSize: "340px 340px",
            transform: "translate(-50%,-50%) translateZ(-320px)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[125vh] w-[125vw]"
          style={{
            backgroundImage: starsNear,
            backgroundSize: "480px 480px",
            transform: "translate(-50%,-50%) translateZ(-90px)",
            opacity: 0.95,
          }}
        />
      </div>

      {/* ── ОБЪЁМ: голографмы-модули и светлячки — камера летит сквозь ── */}
      <div ref={moveRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {signs.map((sign, i) => {
          const spot = PANEL_SPOTS[i % PANEL_SPOTS.length]
          return (
            <div
              key={sign.title}
              ref={(el) => {
                panelRefs.current[i] = el
              }}
              data-login-gate
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 w-[520px]"
              style={{
                transform: `translate3d(${spot.x}px, ${spot.y}px, ${-(PANEL_FIRST + i * PANEL_STEP)}px) rotateY(${spot.ry}deg)`,
              }}
            >
              <div
                className="gate-bob rounded-3xl border border-sky-300/25 bg-[#0a1428]/60 px-8 py-6 text-center shadow-[0_0_70px_-16px_rgba(56,189,248,0.45)]"
                style={{ animationDelay: `${i * 0.65}s` }}
              >
                <p className="text-[26px] font-bold leading-tight tracking-tight text-sky-50/95">
                  {sign.title}
                </p>
                <p className="mt-1 text-[15px] text-sky-200/55">{sign.sub}</p>
                <div className="mx-auto mt-4 h-[3px] w-14 rounded-full bg-sky-300/50" />
              </div>
            </div>
          )
        })}

        {motes.map((m, i) => (
          <div
            key={i}
            ref={(el) => {
              moteRefs.current[i] = el
            }}
            data-login-mote
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: m.s,
              height: m.s,
              background: m.color,
              boxShadow: `0 0 ${m.s * 3}px ${m.glow}`,
              transform: `translate3d(${m.x}px, ${m.y}px, ${-m.z}px)`,
            }}
          />
        ))}
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
                "radial-gradient(50% 50% at 50% 50%, rgba(251,146,60,0.12), transparent 70%)",
            }}
          />
        )}

        {/* форма: голографический экран — матовое стекло, сквозь него
            видно звёзды; тот же язык, что у модулей */}
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
                <div className="relative rounded-3xl border border-white/15 bg-[#0b1120]/55 px-5 pb-5 pt-4 shadow-[0_50px_110px_-30px_rgba(0,0,0,0.85)] backdrop-blur-xl">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/60 to-transparent"
                  />
                  {children}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* гироскоп: пилюля на сенсорных экранах */}
      {pill === "offer" && (
        <button
          type="button"
          data-gyro-pill
          onClick={() => void gyroRequestRef.current?.()}
          className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-[#0b1120]/85 px-3.5 py-1.5 text-[11px] font-medium text-sky-100/90 shadow-lg"
        >
          <Compass className="h-3.5 w-3.5 text-sky-300" />
          Наклоняй телефон — включить гироскоп
        </button>
      )}
      {pill === "on" && (
        <div
          data-gyro-pill
          className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-sky-300/30 bg-[#0b1120]/85 px-3.5 py-1.5 text-[11px] font-medium text-sky-200"
        >
          <Compass className="h-3.5 w-3.5 text-sky-300" />
          Гироскоп включён
        </div>
      )}
      {pill === "off" && (
        <div
          data-gyro-pill
          className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-[#0b1120]/85 px-3.5 py-1.5 text-[11px] text-slate-400"
        >
          Датчик недоступен — води пальцем
        </div>
      )}
    </div>
  )
}
