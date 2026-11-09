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
// [data-crane] ×3, [data-pole] ×6, [data-tree] ×18,
// [data-login-mote] ×14, [data-route-dot] ×5, [data-ground],
// [data-ground-backdrop], [data-login-panel], [data-login-doc].
//
// Фидбек и16: «арки меньше — пол страницы в виде горизонта; гироскоп
// ещё душим, надо немного для объёма; всё равно проваливаемся под
// дорогу; добавим деревья по сторонам; дорога огромная — не понять,
// что это». Сделано: горизонт опущен на 62% высоты (небо — главный
// план, земля — нижняя треть), краны-порталы компактнее (244px),
// дорога сужена до 260px, земля шире (±1900) и глубже + статичный
// подбой цвета земли снизу — провалов под дорогу нет; ели аллеей
// по сторонам; дальний город поднят из-под земли к горизонту.

import { useEffect, useMemo, useRef, useState } from "react"

const PERSPECTIVE = 900

/** Полёт сквозь терминал. Ворп при входе — мягкое ускорение, БЕЗ
    скачков перспективы (мигание после нажатия исключено). */
const SPEED_BASE = 450
const SPEED_WARP = 5400

/** Двор: суммарная «длина» цикла переработки элементов (px мира). */
const YARD_TOTAL = 7500
const MOTE_TOTAL = 4200

const CONTAINER_COLORS = ["#24425f", "#5b3423", "#2a4c44", "#3c3a58", "#31517a"]

/** Штабеля — РОВНЫЕ КОЛОННЫ терминала: фикс. позиции x и равномерный
    ритм z (никакого разброса и бродячего дрожания — опрятный двор,
    который никогда не сваливается в кучу). Всё вне дороги (полоса 130). */
const STACKS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -430, z: 400 },
  { x: -430, z: 1900 },
  { x: -430, z: 3400 },
  { x: -430, z: 4900 },
  { x: -430, z: 6400 },
  { x: 430, z: 1150 },
  { x: 430, z: 2650 },
  { x: 430, z: 4150 },
  { x: 430, z: 5650 },
  { x: -680, z: 775 },
  { x: -680, z: 4525 },
  { x: 680, z: 2625 },
  { x: 680, z: 6375 },
]
/** Краны-порталы: симметрично и равномерно по глубине. */
const CRANES: ReadonlyArray<{ x: number; z: number }> = [
  { x: -560, z: 1200 },
  { x: 560, z: 3700 },
  { x: -560, z: 6200 },
]
/** Фонари — РЯДОМ С ДОРОГОЙ: чередуются через обочину, как на трассе. */
const POLE_X: ReadonlyArray<number> = [-310, 310, -310, 310, -310, 310]
/** Точки-заказы — бусины точно на центральной нитке маршрута. */
const DOT_Z: ReadonlyArray<number> = [280, 1780, 3280, 4780, 6280]
/** Ели — аллея по сторонам дороги (±215) + второй ряд глубже (±400):
 *  дорога сразу читается дорогой, у мира появляется масштаб. */
const TREES: ReadonlyArray<{ x: number; z: number }> = [
  { x: -215, z: 600 },
  { x: 215, z: 1220 },
  { x: -215, z: 1840 },
  { x: 215, z: 2460 },
  { x: -215, z: 3080 },
  { x: 215, z: 3700 },
  { x: -215, z: 4320 },
  { x: 215, z: 4940 },
  { x: -215, z: 5560 },
  { x: 215, z: 6180 },
  { x: -215, z: 6800 },
  { x: 215, z: 7420 },
  { x: -400, z: 910 },
  { x: 400, z: 1840 },
  { x: -400, z: 3700 },
  { x: 400, z: 4630 },
  { x: -400, z: 5560 },
  { x: 400, z: 6490 },
]

/** Время суток: сцена живёт по местным часам пользователя.
 *  night 23–05 · dawn 05–09 · day 09–17 · dusk 17–23.
 *  Палитры — в globals.css (CSS-переменные --tod-*). */
type Tod = "night" | "dawn" | "day" | "dusk"
const MOTE_FACTOR: Record<Tod, number> = { night: 1, dawn: 0.85, dusk: 0.85, day: 0.35 }

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
  arrived: boolean
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

/** Кран-портал: тельфер ездит, маячок мигает. Компактный (и16:
    «арки меньше» — портал не съедает пол-экрана). */
function CraneArt() {
  return (
    <svg width="340" height="244" viewBox="0 0 340 244" aria-hidden="true">
      <rect x="46" y="50" width="11" height="194" fill="#131d36" />
      <rect x="283" y="50" width="11" height="194" fill="#131d36" />
      <rect x="16" y="34" width="308" height="20" fill="#131d36" />
      <path
        d="M22,54 L54,36 M76,54 L108,36 M130,54 L162,36 M184,54 L216,36 M238,54 L270,36 M292,54 L324,36"
        stroke="#131d36"
        strokeWidth="4"
      />
      <rect x="258" y="54" width="18" height="12" fill="#182745" />
      <rect x="261" y="57" width="9" height="6" fill="#f59e0b" opacity="0.85" />
      <g className="crane-trolley">
        <rect x="88" y="56" width="20" height="10" fill="#182745" />
        <rect x="97" y="66" width="2.5" height="82" fill="#0e1730" />
        <rect x="82" y="148" width="39" height="6" fill="#182745" />
      </g>
      <circle cx="170" cy="27" r="3.5" fill="#ef4444" className="beacon" />
    </svg>
  )
}

/** Фонарь: столб + лампа + тёплый конус света (один SVG — дёшево). */
function PoleArt() {
  return (
    <svg width="180" height="280" viewBox="0 0 180 280" aria-hidden="true">
      <rect x="87" y="26" width="6" height="254" fill="#182742" />
      <rect x="76" y="18" width="28" height="10" rx="3" fill="#182742" />
      <polygon className="pole-cone" points="86,36 94,36 176,280 4,280" fill="rgba(245,185,66,0.09)" />
      <circle className="pole-lamp" cx="90" cy="32" r="7" fill="rgba(251,191,36,0.25)" />
      <circle className="pole-lamp" cx="90" cy="32" r="3.5" fill="#fbbf24" />
    </svg>
  )
}

/** Ель: три яруса кроны — тёмная, тихая, красится палитрой суток
 *  (CSS-переменные --tod-tree*), ствол на земле. */
function TreeArt() {
  return (
    <svg width="150" height="210" viewBox="0 0 150 210" aria-hidden="true">
      <ellipse cx="75" cy="200" rx="54" ry="8" fill="rgba(0,0,0,0.4)" />
      <rect className="tree-trunk" x="69" y="148" width="12" height="52" />
      <polygon className="tree-leaf2" points="75,16 116,84 34,84" />
      <polygon className="tree-leaf" points="75,42 124,120 26,120" />
      <polygon className="tree-leaf2" points="75,76 132,158 18,158" />
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

  /** Фаза суток: по часам клиента; ?tod=… — для проверки вручную.
   *  Вычисляем ПОСЛЕ монтирования: сервер рендерит «ночь» (не знает
   *  часовой пояс клиента), клиент сразу поправляет — иначе hydration
   *  рассинхронизируется. */
  const [tod, setTod] = useState<Tod>("night")
  const todRef = useRef<Tod>("night")
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("tod")
    const h = new Date().getHours()
    const byHour: Tod = h >= 5 && h < 9 ? "dawn" : h >= 9 && h < 17 ? "day" : h >= 17 && h < 23 ? "dusk" : "night"
    const next: Tod = param === "day" || param === "dawn" || param === "dusk" || param === "night" ? param : byHour
    todRef.current = next
    setTod(next)
  }, [])

  /** Прилёт плиты: far — дорога бежит чистой; here — по касанию плита
   *  красиво прилетает издалека («мы приехали»); past — после верного
   *  ввода проезжаем её и оказываемся в программе. */
  const [phase, setPhase] = useState<"far" | "here" | "past">("far")
  const [warping, setWarping] = useState(false)
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
    STACKS.forEach((p) => {
      // низ штабеля (высота 160) стоит НА земле (плоскость y=56)
      yard.push({ el: els[k], baseX: p.x, x: p.x, y: 56 - 80, z: p.z, total: YARD_TOTAL, i: k })
      k += 1
    })
    CRANES.forEach((p) => {
      // кран высотой 330: ноги на земле
      yard.push({ el: els[k], baseX: p.x, x: p.x, y: 56 - 122, z: p.z, total: YARD_TOTAL, i: k })
      k += 1
    })
    POLE_X.forEach((x, i) => {
      // фонарь высотой 280: столб на земле
      yard.push({ el: els[k], baseX: x, x, y: 56 - 140, z: 350 + i * 1250, total: YARD_TOTAL, i: k })
      k += 1
    })
    DOT_Z.forEach((z) => {
      // точки-заказы катятся по самой земле — точно по нитке
      yard.push({ el: els[k], baseX: 0, x: 0, y: 51, z, total: YARD_TOTAL, i: k })
      k += 1
    })
    TREES.forEach((p) => {
      // ель высотой 210: ствол на земле, аллея вдоль дороги
      yard.push({ el: els[k], baseX: p.x, x: p.x, y: 56 - 105, z: p.z, total: YARD_TOTAL, i: k })
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
    let ending = false
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
      arrived: false,
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
      pitchDrag = clamp(pitchDrag + dy * 0.03, -5, 5)
    }

    // ── гироскоп: БЕЗ КНОПКИ и БЕЗ УВЕДОМЛЕНИЙ ──
    // Чувствительность: 0.11/0.075 при зажиме ±5°/±3° — и16: «ещё
    // душим, надо немного для объёма» (0.26/0.19 ±12/±7 — резковато;
    // когда-то 0.6 — «слишком»). Запрос разрешения — на трёх жестах
    // сразу (Safari капризен), сам вызов одноразовый.
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta == null || event.gamma == null) return
      if (!gyroCalib) gyroCalib = { b: event.beta, g: event.gamma }
      yawGyroT = clamp((event.gamma - gyroCalib.g) * 0.11, -5, 5)
      pitchGyroT = clamp((event.beta - gyroCalib.b) * 0.075, -3, 3)
      if (!gyroActive) {
        gyroActive = true
        debug.gyro = true
      }
    }
    let gyroGranted = false
    const attachGyro = () => {
      window.addEventListener("deviceorientation", onOrientation)
      if (gyroGranted || gyroActive) return
      // пробуем на КАЖДОМ жесте, пока не разрешат: Safari может не
      // зачесть первый pointerdown — раньше из-за одноразовой попытки
      // гироскоп умирал навсегда
      const D = (
        window as unknown as {
          DeviceOrientationEvent?: { requestPermission?: () => Promise<string> }
        }
      ).DeviceOrientationEvent
      if (D && typeof D.requestPermission === "function") {
        try {
          void D.requestPermission()
            .then((answer) => {
              if (answer === "granted") gyroGranted = true
            })
            .catch(() => {})
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
    // Касание экрана — ПРИЛЁТ плиты издалека (видение владельца:
    // «бежит дорога, нажимаешь — появляется плита, мы приехали»).
    // Никаких скачков перспективы — только честный transform-полёт.
    const onClick = () => {
      debug.plunges += 1
      if (debug.arrived) return
      debug.arrived = true
      setPhase("here")
    }
    const onKey = () => {
      if (debug.arrived) return
      debug.arrived = true
      setPhase("here")
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      pointer = { x: event.clientX, y: event.clientY }
    }
    const isUi = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest("[data-login-panel], form, button, a, input, textarea, label") != null
    let padLast: { x: number; y: number } | null = null
    let padStart: { x: number; y: number; t: number } | null = null
    const onPadDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || isUi(event.target)) return
      padLast = { x: event.clientX, y: event.clientY }
      padStart = { x: event.clientX, y: event.clientY, t: event.timeStamp }
    }
    const onPadMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !padLast) return
      w.__loginWorldLook?.(event.clientX - padLast.x, event.clientY - padLast.y)
      padLast = { x: event.clientX, y: event.clientY }
    }
    const onPadUp = (event: PointerEvent) => {
      // Тап по миру = палец встал и поднялся почти без движения.
      // Прилёт вешаем и на pointerup: click вскоре после драга
      // глотается double-tap-детектором мобильного Chromium,
      // а pointerup приходит всегда и вовремя.
      if (padStart && event.pointerType === "touch") {
        const dx = event.clientX - padStart.x
        const dy = event.clientY - padStart.y
        if (Math.hypot(dx, dy) < 12 && event.timeStamp - padStart.t < 600) {
          debug.plunges += 1
          if (!debug.arrived) {
            debug.arrived = true
            setPhase("here")
          }
        }
      }
      padLast = null
      padStart = null
    }
    const onInput = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target || (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA")) return
      energy = Math.min(1.2, energy + 0.5)
    }
    const onWarp = () => {
      // проезжаем плиту и оказываемся в программе: мягкое ускорение
      // полёта + плита уходит за камеру — без скачков перспективы
      warpT = 1
      speed = SPEED_WARP
      ending = true
      setWarping(true)
      setPhase("past")
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
      const pitchT = pointer ? -(pointer.y / window.innerHeight - 0.5) * 4.5 : 0
      yawMouse += (yawT - yawMouse) * Math.min(1, dt * 3)
      pitchMouse += (pitchT - pitchMouse) * Math.min(1, dt * 3)
      yawDrag *= Math.exp(-dt * 0.1)
      pitchDrag *= Math.exp(-dt * 0.1)
      yawGyro += (yawGyroT - yawGyro) * Math.min(1, dt * 4.5)
      pitchGyro += (pitchGyroT - pitchGyro) * Math.min(1, dt * 4.5)
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
      // знак +: особенности бегут К камере (полёт вперёд)
      line.style.backgroundPositionY = `${((dolly * 0.9) % 72).toFixed(1)}px`

      // ── двор: штабеля, краны, фонари, точки и искры пролетают
      // мимо и рождаются впереди — объём и скорость ──
      const moteStart = STACKS.length + CRANES.length + POLE_X.length + DOT_Z.length + TREES.length
      for (const e of yard) {
        // в ворпе двор НЕ рождается заново: штабеля, краны и фонари
        // заканчиваются — дорога «приехала», мы в программе
        if (!ending && dolly - e.z > -380) {
          e.z += e.total
          debug.passed += 1
          e.el.style.transform = yardTransform(e)
        }
        const depth = e.z - dolly
        // искры днём — пылинки в воздухе, ночью — светлячки
        const mf = e.i >= moteStart ? MOTE_FACTOR[todRef.current] : 1
        e.el.style.opacity = (clamp(depth / 420, 0, 1) * mf).toFixed(3)
      }

      debug.frames += 1
      debug.dolly = dolly
      debug.speed = speed
      debug.yaw = yaw
      debug.pitch = pitch
      debug.warp = warpT
    }

    window.addEventListener("click", onClick, { passive: true })
    window.addEventListener("keydown", onKey)
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
      window.removeEventListener("keydown", onKey)
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
      data-warp={warping ? "1" : "0"}
      data-tod={tod}
      className="world-sky fixed inset-0 touch-none overflow-hidden"
      style={{ perspective: "900px", perspectiveOrigin: "50% 62%" }}
    >
      {/* ── НЕБО: звёзды плиткой, луна, дальние огни ── */}
      <div ref={skyRef} className="world-rig pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        <div
          aria-hidden="true"
          className="sky-stars absolute left-1/2 top-1/2 h-[165vh] w-[165vw]"
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
          <g className="sky-moon">
            <circle cx="300" cy="132" r="66" fill="rgba(232,237,246,0.06)" />
            <circle cx="300" cy="132" r="28" fill="#e8edf6" opacity="0.9" />
            <circle cx="290" cy="124" r="6" fill="#cdd6e4" opacity="0.5" />
            <circle cx="310" cy="142" r="4" fill="#cdd6e4" opacity="0.4" />
          </g>
          <rect x="-100" y="430" width="1400" height="120" fill="url(#haze)" />
          <g className="sky-city">
            <rect x="60" y="460" width="46" height="20" />
            <rect x="150" y="448" width="30" height="32" />
            <rect x="418" y="452" width="34" height="28" />
            <rect x="620" y="444" width="52" height="36" />
            <rect x="700" y="456" width="26" height="24" />
            <rect x="1020" y="446" width="40" height="34" />
          </g>
          <g className="sky-windows">
            <circle cx="90" cy="474" r="1.8" opacity="0.55" />
            <circle cx="230" cy="478" r="1.6" opacity="0.45" />
            <circle cx="420" cy="472" r="1.8" opacity="0.5" />
            <circle cx="648" cy="476" r="1.6" opacity="0.45" />
            <circle cx="860" cy="472" r="1.8" opacity="0.5" />
            <circle cx="1040" cy="478" r="1.6" opacity="0.45" />
          </g>
        </svg>
        {/* солнце: мягкий диск — живёт днём и в закат */}
        <div className="sky-sun" aria-hidden="true" />
        {/* низ неба темнеет к горизонту: звёзды гаснут — мы на земле,
            а не в космосе */}
        <div
          data-sky-fade
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[42%]"
          style={{ background: "var(--tod-fadebg)" }}
        />
      </div>

      {/* подбой земли: СТАТИЧНАЯ полоса цвета земли под 3D-плоскостью —
          при любом наклоне камеры под дорогой не видно небо
          («не проваливаемся под дорогу», и16) */}
      <div
        data-ground-backdrop
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[66%] bottom-0"
        style={{ background: "var(--tod-ground)" }}
      />

      {/* ── ЗЕМЛЯ: плоскость в перспективе, разметка и нитка маршрута
          бегут под камерой (движение вперёд) ── */}
      <div ref={midRef} className="world-rig pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        <div
          ref={groundRef}
          data-ground
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-[5200px] w-[3800px]"
          style={{
            // земля накрывает ВЕСЬ двор по ширине (±1900 — бока не
            // видны и при повороте камеры) и глубину до z=3300;
            // дальний край уходит за дымку у самого горизонта, а лишняя
            // длина стоила 4 к/с софтверного рендера
            transform: "translate(-50%,-50%) translateY(56px) translateZ(700px) rotateX(90deg)",
            backgroundColor: "var(--tod-ground)",
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 2px, transparent 2px 96px)",
          }}
        >
          {/* полоса-«взлётка»: боковые линии + центральная нитка маршрута,
              пунктир бежит навстречу камере */}
          <div
            ref={lineRef}
            data-road
            className="absolute left-1/2 top-0 h-full w-[260px] -translate-x-1/2"
            style={{
              // асфальт: УЗКАЯ полоса с краями — читается как дорога
              // между елями, а не «взлётка» на пол-экрана (и16)
              backgroundColor: "var(--tod-road)",
              backgroundImage:
                "linear-gradient(90deg, transparent 0 8px, var(--tod-edge) 8px 12px, transparent 12px calc(100% - 12px), var(--tod-edge) calc(100% - 12px) calc(100% - 8px), transparent calc(100% - 8px)), repeating-linear-gradient(180deg, var(--tod-dash) 0 26px, transparent 26px 72px)",
              backgroundPosition: "0 0, 0 0",
              backgroundSize: "100% 100%, 10px 100%",
              backgroundRepeat: "no-repeat, repeat-y",
              boxShadow: "0 0 14px var(--tod-roadglow)",
            }}
          />
        </div>
      </div>

      {/* дымка у горизонта — СТАТИЧНЫЙ слой (не вращается с камерой:
          композитор не пересобирает его каждый кадр) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-[48%] h-[26%] w-full"
        style={{
          background: "var(--tod-fogbg)",
        }}
      />

      {/* ── ДВОР: камера летит СКВОЗЬ двор — штабеля, краны, фонари,
          точки-заказы и искры пролетают мимо на разных глубинах ── */}
      <div ref={moveRef} className="world-rig pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {STACKS.map((p, i) => (
          <div
            key={`s${i}`}
            ref={(el) => {
              yardRefs.current[i] = el
            }}
            data-stack
            aria-hidden="true"
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate3d(${p.x}px, ${56 - 80}px, ${-p.z}px)` }}
          >
            <div className="yard-shadow" />
            <StackArt variant={i} />
          </div>
        ))}
        {CRANES.map((p, i) => (
          <div
            key={`c${i}`}
            ref={(el) => {
              yardRefs.current[STACKS.length + i] = el
            }}
            data-crane
            aria-hidden="true"
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate3d(${p.x}px, ${56 - 122}px, ${-p.z}px)` }}
          >
            <div className="yard-shadow" />
            <CraneArt />
          </div>
        ))}
        {POLE_X.map((x, i) => (
          <div
            key={`p${i}`}
            ref={(el) => {
              yardRefs.current[STACKS.length + CRANES.length + i] = el
            }}
            data-pole
            aria-hidden="true"
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate3d(${x}px, ${56 - 140}px, ${-(350 + i * 1250)}px)` }}
          >
            <div className="yard-pool" />
            <PoleArt />
          </div>
        ))}
        {DOT_Z.map((z, i) => (
          <div
            key={`d${i}`}
            ref={(el) => {
              yardRefs.current[STACKS.length + CRANES.length + POLE_X.length + i] = el
            }}
            data-route-dot
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 h-[10px] w-[10px] rounded-full bg-cyan-300"
            style={{
              transform: `translate3d(0px, 51px, ${-z}px)`,
              boxShadow: "0 0 12px rgba(103,232,249,0.9)",
            }}
          />
        ))}
        {TREES.map((p, i) => (
          <div
            key={`t${i}`}
            ref={(el) => {
              yardRefs.current[STACKS.length + CRANES.length + POLE_X.length + DOT_Z.length + i] = el
            }}
            data-tree
            aria-hidden="true"
            className="absolute left-1/2 top-1/2"
            style={{ transform: `translate3d(${p.x}px, ${56 - 105}px, ${-p.z}px)` }}
          >
            <TreeArt />
          </div>
        ))}
        {Array.from({ length: 14 }, (_, i) => (
          <div
            key={`m${i}`}
            ref={(el) => {
              yardRefs.current[STACKS.length + CRANES.length + POLE_X.length + DOT_Z.length + i] = el
            }}
            data-login-mote
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{ width: 4, height: 4 }}
          />
        ))}
      </div>

      {/* ── БЛИЖНИЙ ПЛАН: заголовок и ПРОПУСК-документ формы ──
          до касания экрана дорога бежит чистой; по касанию весь ближний
          план красиво ПРИЛЕТАЕТ издалека (translateZ-полёт) ── */}
      <div ref={nearRef} className="world-rig pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        <div className="doc-arrive" data-state={phase}>
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
              {bare ? (
                children
              ) : (
                <div
                  data-login-doc
                  className="relative rounded-2xl border border-white/10 bg-[#0b1322]/40 px-5 pb-3.5 pt-3 shadow-[0_30px_70px_-25px_rgba(0,0,0,0.8)] backdrop-blur-xl"
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
                  <div className="mt-2.5 flex items-end justify-between border-t border-dashed border-white/10 pt-2">
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

      {/* подсказка прилёта: крошечная, исчезает после первого касания */}
      {phase === "far" && (
        <div
          data-login-hint
          className="absolute bottom-7 left-1/2 z-20 -translate-x-1/2 text-center"
        >
          <p className="animate-pulse text-[11px] font-medium uppercase tracking-[0.3em] text-slate-300/70">
            Коснитесь экрана — войти
          </p>
        </div>
      )}
    </div>
  )
}
