"use client"

// components/visual/login-world.tsx — 3D-мир входа «Ночной рейс»
//
// Полная смена подхода (просьба владельца): «хочу, чтобы всё было
// интегрировано в 3D… больше объёма, как будто мы перемещаемся в
// пространстве и смотрим с разных углов; может, подключить гироскоп».
//
// Это НЕ канвас и НЕ слои поверх страницы — это настоящий CSS-3D мир:
//
//   • камера (perspective 900) непрерывно едет ВПЕРЁД сквозь пространство:
//     ворота-модули пролетают мимо и сменяются, разметка дороги бежит
//     под колёсами, пилоны проносятся по обочинам;
//   • ракурс: на ПК — за курсором; на телефоне — ПАЛЬЦЕМ или ГИРОСКОПОМ
//     (кнопка-пилюля запрашивает разрешение на iOS); мир реально видно
//     С РАЗНЫХ УГЛОВ — у каждого слоя своя глубина;
//   • форма — НЕ панель поверх сцены, а ОБЪЕКТ МИРА: стеклянная плита
//     с толщиной, парит на фиксированной глубине между камерой и
//     воротами; дорога течёт позади неё, ворота пролетают мимо;
//   • клик — рывок вперёд; ввод текста — ускорение; успешный вход —
//     ворп (рывок сквозь мир) и редирект.
//
// Техника: три «рига» с transform-style: preserve-3d —
//   rigSky  (только вращение): звёзды и зарево — бесконечное небо;
//   rigMove (вращение + dolly): дорога, ворота, пилоны — с «переработкой»
//     координат, поэтому мир бесконечен и не переполняется;
//   rigNear (только вращение): заголовок и панель формы.
// Приёмка: window.__loginWorld {dolly, speed, yaw, pitch, gyro, gates,
// warp} + __loginWorldLook(dx,dy) + __loginWorldPaused +
// __loginWorldGyro() (разрешение гироскопа). DOM: [data-login-world],
// [data-login-gate], [data-login-panel], [data-gyro-pill].

import { useEffect, useMemo, useRef, useState } from "react"
import { Compass } from "lucide-react"

const PERSPECTIVE = 900
const ROAD_W = 1240
const ROAD_LEN = 7000
const DASH_PERIOD = 300 // период разметки — дорога «бесконечна» сдвигом на период
const GATE_COUNT = 6
const GATE_STEP = 900
const GATE_TOTAL = GATE_COUNT * GATE_STEP
const PYLON_COUNT = 9
const PYLON_STEP = 640
const PYLON_TOTAL = PYLON_COUNT * PYLON_STEP
const GATE_FIRST = 760

const SPEED_BASE = 300
const SPEED_WARP = 5400

/** Ворота-модули на дороге (вход логиста). */
const LOGIST_SIGNS: ReadonlyArray<{ title: string; sub: string }> = [
  { title: "Живая карта", sub: "машины и ETA в реальном времени" },
  { title: "Маршруты OSRM", sub: "плечи и оптимизация" },
  { title: "Биржа грузов", sub: "ATI.SU · Cargomart" },
  { title: "Документы", sub: "статусы рейсов без Excel" },
  { title: "Аналитика", sub: "KPI парка в один экран" },
  { title: "Роли и доступы", sub: "у каждой стороны — своё окно" },
]

/** Ворота на дороге водителя — его собственные разделы. */
const DRIVER_SIGNS: ReadonlyArray<{ title: string; sub: string }> = [
  { title: "Мои рейсы", sub: "заявки и статусы дня" },
  { title: "Маршрут рейса", sub: "точки, погрузка, выгрузка" },
  { title: "Документы и фото", sub: "сканы прямо в рейсе" },
  { title: "Чат с логистом", sub: "вопрос — за минуту" },
  { title: "Техобслуживание", sub: "заявки на ремонт" },
  { title: "Машина", sub: "пробег и состояние" },
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
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Слой звёзд: радиальные градиенты, сгенерированные один раз. */
function useStarLayer(count: number, seed: number) {
  return useMemo(() => {
    let s = seed
    const rnd = () => {
      s = (s * 16807) % 2147483647
      return s / 2147483647
    }
    const parts: string[] = []
    for (let i = 0; i < count; i++) {
      const x = (rnd() * 100).toFixed(2)
      const y = (rnd() * 100).toFixed(2)
      const r = (0.6 + rnd() * 1.1).toFixed(2)
      const a = (0.25 + rnd() * 0.55).toFixed(2)
      parts.push(`radial-gradient(${r}px ${r}px at ${x}% ${y}%, rgba(226,232,240,${a}) 40%, transparent 100%)`)
    }
    return parts.join(", ")
  }, [count, seed])
}

export function LoginWorld({
  variant = "logist",
  headline,
  children,
  bare = false,
}: {
  variant?: "logist" | "driver"
  /** Крупный заголовок, парящий в небе над горизонтом */
  headline?: React.ReactNode
  /** Содержимое панели-плиты (форма) — объект мира */
  children: React.ReactNode
  /** Панель без плиты — страница приносит свою карточку */
  bare?: boolean
}): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const skyRef = useRef<HTMLDivElement | null>(null)
  const moveRef = useRef<HTMLDivElement | null>(null)
  const nearRef = useRef<HTMLDivElement | null>(null)
  const roadRef = useRef<HTMLDivElement | null>(null)
  const gateRefs = useRef<Array<HTMLDivElement | null>>([])
  const pylonRefs = useRef<Array<HTMLDivElement | null>>([])

  const starsFar = useStarLayer(46, 1234567)
  const starsNear = useStarLayer(26, 7654321)

  const [pill, setPill] = useState<"hidden" | "offer" | "on" | "off">("hidden")
  const gyroRequestRef = useRef<(() => Promise<boolean>) | null>(null)

  const signs = variant === "driver" ? DRIVER_SIGNS : LOGIST_SIGNS

  useEffect(() => {
    const viewport = viewportRef.current
    const sky = skyRef.current
    const move = moveRef.current
    const near = nearRef.current
    const road = roadRef.current
    if (!viewport || !sky || !move || !near || !road) return

    const gates = gateRefs.current.filter((el): el is HTMLDivElement => el != null)
    const pylons = pylonRefs.current.filter((el): el is HTMLDivElement => el != null)
    const gateZ = gates.map((_, i) => GATE_FIRST + i * GATE_STEP)
    const pylonZ = pylons.map((_, i) => 300 + i * PYLON_STEP)

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
    let gyroCalib: { b: number; g: number } | null = null
    let gyroActive = false
    let pointer: { x: number; y: number } | null = null
    let focused = false
    let aim = 0
    const basePitch = narrow ? 1.1 : 0.6 // чуть смотрим сверху на дорогу

    const debug: WorldDebug = {
      dolly: 0,
      speed,
      yaw: 0,
      pitch: 0,
      gyro: false,
      gates: 0,
      warp: 0,
      plunges: 0,
    }
    const w = window as Window & {
      __loginWorld?: WorldDebug
      __loginWorldLook?: (dx: number, dy: number) => void
      __loginWorldPaused?: boolean
      __loginWorldGyro?: () => Promise<boolean>
    }
    w.__loginWorld = debug
    w.__loginWorldLook = (dx: number, dy: number) => {
      yawDrag = clamp(yawDrag + dx * 0.055, -26, 26)
      pitchDrag = clamp(pitchDrag + dy * 0.04, -13, 13)
    }

    // ── гироскоп ──
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta == null || event.gamma == null) return
      if (!gyroCalib) gyroCalib = { b: event.beta, g: event.gamma }
      yawGyro = clamp((event.gamma - gyroCalib.g) * 0.6, -26, 26)
      pitchGyro = clamp((event.beta - gyroCalib.b) * 0.5, -13, 13)
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
      // Слушателя ставим СРАЗУ (события придут, когда платформа их
      // отдаст); iOS дополнительно просит разрешение по жесту —
      // пилюля и есть этот жест, её ответ не блокирует слушателя
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

      // ── ракурс: курсор + палец + гироскоп; в фокусе поля — камера
      // мягко центруется на форме
      const yawT = pointer ? -(pointer.x / window.innerWidth - 0.5) * 17 : 0
      const pitchT = pointer ? -(pointer.y / window.innerHeight - 0.5) * 8 : 0
      yawMouse += (yawT - yawMouse) * Math.min(1, dt * 3)
      pitchMouse += (pitchT - pitchMouse) * Math.min(1, dt * 3)
      yawDrag *= Math.exp(-dt * 0.1)
      pitchDrag *= Math.exp(-dt * 0.1)
      aim += ((focused ? 1 : 0) - aim) * Math.min(1, dt * 3)
      const swayY = Math.sin(t * 0.14) * 0.35
      const swayP = Math.sin(t * 0.17 + 1.2) * 0.2
      const blend = 1 - aim * 0.06
      yaw = (yawMouse + yawDrag + yawGyro) * blend + swayY
      pitch = (pitchMouse + pitchDrag + pitchGyro) * blend + swayP + basePitch

      // ── риги ──
      const rot = `rotateX(${(-pitch).toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg)`
      sky.style.transform = rot
      near.style.transform = rot
      move.style.transform = `translateZ(${dolly.toFixed(1)}px) ${rot}`
      viewport.style.perspective = `${(PERSPECTIVE - warpT * 170 - fovKick * 80).toFixed(0)}px`

      // ── дорога: сдвиг на целое число периодов разметки — бесконечный
      // асфальт без ухода за камеру
      const k = Math.floor(dolly / DASH_PERIOD) * DASH_PERIOD
      road.style.transform = `translateX(-50%) translateZ(${-k}px) rotateX(-90deg)`

      // ── ворота и пилоны: переработка (пролетели — уезжают вперёд)
      for (let i = 0; i < gates.length; i++) {
        const el = gates[i]
        let z = gateZ[i]
        if (dolly - z > -340) {
          z += GATE_TOTAL
          gateZ[i] = z
          debug.gates += 1
          el.style.transform = `translate(-50%, -100%) translateZ(${-z}px)`
        }
        const depth = z - dolly
        el.style.opacity = clamp(depth / 340, 0, 1).toFixed(3)
      }
      for (let i = 0; i < pylons.length; i++) {
        const el = pylons[i]
        let z = pylonZ[i]
        if (dolly - z > -60) {
          z += PYLON_TOTAL
          pylonZ[i] = z
          el.style.transform = `translate(-50%, -100%) translateZ(${-z}px)`
        }
        const depth = z - dolly
        el.style.opacity = clamp(depth / 60, 0, 1).toFixed(3)
      }

      debug.dolly = dolly
      debug.speed = speed
      debug.yaw = yaw
      debug.pitch = pitch
      debug.warp = warpT
    }

    // Пилюля гироскопа — только на сенсорных экранах, где датчик есть
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
      const rot = `rotateX(${-basePitch}deg) rotateY(0deg)`
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
  }, [variant])

  return (
    <div
      ref={viewportRef}
      data-login-world
      className="fixed inset-0 touch-none overflow-hidden bg-[linear-gradient(180deg,#04060d_0%,#0a1122_38%,#0c1322_41%,#05070d_100%)]"
      style={{ perspective: "900px", perspectiveOrigin: "50% 40%" }}
    >
      {/* ── НЕБО: бесконечный фон, вращается с камерой ── */}
      <div ref={skyRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[40%]"
          style={{ backgroundImage: starsFar, transform: "translateZ(-8200px) scale(2)" }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[40%]"
          style={{ backgroundImage: starsNear, transform: "translateZ(-6400px) scale(2)", opacity: 0.85 }}
        />
        {/* зарево города на горизонте */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-[40%] h-[70vh] w-[260vw] -translate-x-1/2 -translate-y-1/2"
          style={{
            transform: "translate(-50%,-50%) translateZ(-6000px)",
            background:
              "radial-gradient(52% 60% at 50% 55%, rgba(251,146,60,0.16), transparent 70%), radial-gradient(70% 80% at 50% 60%, rgba(56,130,246,0.11), transparent 75%)",
          }}
        />
      </div>

      {/* ── МИР: дорога, ворота, пилоны — камера едет сквозь него ── */}
      <div ref={moveRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {/* асфальт: плоскость, повернутая в перспективу */}
        <div
          ref={roadRef}
          aria-hidden="true"
          className="absolute left-1/2 top-full"
          style={{
            width: ROAD_W,
            height: ROAD_LEN,
            transformOrigin: "50% 0",
            transform: "translateX(-50%) rotateX(-90deg)",
            backgroundColor: "#0b1322",
            backgroundImage: [
              // кромки дороги
              "linear-gradient(to right, rgba(148,163,184,0.45) 0 5px, transparent 5px calc(100% - 5px), rgba(148,163,184,0.45) calc(100% - 5px))",
              // осевые пунктиры — две полосы движения
              "repeating-linear-gradient(to bottom, rgba(191,219,254,0.75) 0 80px, transparent 80px 300px)",
              "repeating-linear-gradient(to bottom, rgba(191,219,254,0.75) 0 80px, transparent 80px 300px)",
              // асфальт с лёгким блеском по центру
              "linear-gradient(to right, #080d18 0%, #0e1729 50%, #080d18 100%)",
            ].join(", "),
            backgroundSize: "100% 100%, 16px 100%, 16px 100%, 100% 100%",
            backgroundPosition: "0 0, calc(50% - 200px) 0, calc(50% + 192px) 0, 0 0",
            backgroundRepeat: "no-repeat",
          }}
        />

        {/* ворота-модули: пролетают мимо и сменяются */}
        {signs.map((sign, i) => (
          <div
            key={sign.title}
            ref={(el) => {
              gateRefs.current[i] = el
            }}
            data-login-gate
            aria-hidden="true"
            className="absolute left-1/2 top-full w-[560px]"
            style={{ transform: `translate(-50%, -100%) translateZ(-${GATE_FIRST + i * GATE_STEP}px)` }}
          >
            <div
              className="gate-bob rounded-[30px] border-2 border-sky-300/25 bg-[#0a1428]/45 px-9 py-6 text-center shadow-[0_0_70px_-14px_rgba(56,189,248,0.4)]"
              style={{ animationDelay: `${i * 0.65}s` }}
            >
              <p className="text-[26px] font-bold leading-tight tracking-tight text-sky-50/95">
                {sign.title}
              </p>
              <p className="mt-1 text-[15px] text-sky-200/55">{sign.sub}</p>
              <div className="mx-auto mt-4 h-[3px] w-16 rounded-full bg-sky-300/50" />
            </div>
          </div>
        ))}

        {/* пилоны по обочинам */}
        {Array.from({ length: PYLON_COUNT * 2 }, (_, i) => {
          const side = i % 2 === 0 ? -1 : 1
          const idx = Math.floor(i / 2)
          return (
            <div
              key={i}
              ref={(el) => {
                pylonRefs.current[i] = el
              }}
              aria-hidden="true"
              className="absolute top-full h-[86px] w-[7px] rounded-full bg-gradient-to-t from-transparent via-sky-300/45 to-sky-200/90"
              style={{
                left: `calc(50% + ${side * 668}px)`,
                transform: `translate(-50%, -100%) translateZ(-${300 + idx * PYLON_STEP}px)`,
              }}
            />
          )
        })}
      </div>

      {/* ── БЛИЖНИЙ ПЛАН: заголовок в небе и панель-форма — объекты мира ── */}
      <div ref={nearRef} className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {headline && (
          <div
            className="absolute left-1/2 top-[18%] w-[min(92vw,560px)] text-center lg:left-[26%] lg:top-[44%] lg:w-[560px] lg:text-left"
            style={{ transform: "translate(-50%,-50%) translateZ(-700px)" }}
          >
            {headline}
          </div>
        )}

        {/* тёплый свет за панелью — глубина и читаемость */}
        {!bare && (
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-[54%] h-[560px] w-[560px]"
            style={{
              transform: "translate(-50%,-50%) translateZ(-520px)",
              background:
                "radial-gradient(50% 50% at 50% 50%, rgba(251,146,60,0.13), transparent 70%)",
            }}
          />
        )}

        {/* панель-плита: форма живёт В мире, между камерой и воротами */}
        <div
          data-login-panel
          className="pointer-events-auto absolute left-1/2 top-[56%] w-[min(92vw,440px)] touch-auto lg:left-[71%] lg:top-[50%]"
          style={{ transform: "translate(-50%,-50%) translateZ(-300px)" }}
        >
          <div className="world-bob">
            <div className="world-panel-in" style={{ transformStyle: "preserve-3d" }}>
              {!bare && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 rounded-3xl bg-[#04070f]"
                  style={{ transform: "translateZ(-12px)" }}
                />
              )}
              {bare ? (
                children
              ) : (
                <div className="relative rounded-3xl border border-white/15 bg-[#0b1120]/92 px-5 pb-5 pt-4 shadow-[0_60px_120px_-30px_rgba(0,0,0,0.95)]">
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-6 top-0 h-px bg-white/25"
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
