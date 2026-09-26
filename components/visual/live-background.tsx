"use client"

// components/visual/live-background.tsx
//
// Живой фон рабочего места: тёмная геометрия логистики — сетка, три
// пунктирные дороги между городами и маленькие грузовики, которые едут по
// этим дорогам.
//
// Как это сделано и почему это никому не мешает:
// — слой декоративный: aria-hidden, pointer-events: none, z-index: -1;
// — разметка статичная, дороги рисуются один раз при загрузке модуля;
//   движение — SMIL animateMotion по трём путям, в JavaScript ни одного кадра;
// — в мобильном приложении водителя и на печати фон не рендерится вовсе:
//   там свои экраны и принтер — экономить, так на всём;
// — скрытая вкладка ставит на паузу то, что можно остановить. SMIL-анимацию
//   CSS не остановить, поэтому системная настройка «уменьшить движение»
//   скрывает грузовики целиком (см. .theme-canvas__trucks в globals.css).

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

/** Где фон не нужен: контур водителя и печатные листы документов. */
const EXCLUDED_PREFIXES = ["/m", "/print"]

/**
 * Движение можно выключить совсем: NEXT_PUBLIC_LIVE_BACKGROUND="off".
 *
 * Фон лежит под панелями с backdrop-filter: blur(), поэтому каждый кадр
 * анимации заставляет браузер заново пересчитывать размытие больших областей.
 * На слабом процессоре это заметно тормозит весь интерфейс — выключатель
 * оставляет ту же картинку (сетку, дороги, города), но без движения.
 */
const ANIMATED = (process.env.NEXT_PUBLIC_LIVE_BACKGROUND || "on").trim().toLowerCase() !== "off"

type Point = readonly [number, number]

/**
 * Плавная линия через точки (Catmull-Rom → кубические Безье).
 *
 * Считается один раз при загрузке модуля, а не на каждый кадр: города и
 * грузовики получают ровно те же координаты, что и дорога, поэтому машины
 * не съезжают с полотна, а города стоят на стыках.
 */
function roadPath(points: readonly Point[]): string {
  if (points.length < 2) return ""

  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const previous = points[i - 1] ?? points[i]
    const start = points[i]
    const end = points[i + 1]
    const next = points[i + 2] ?? end

    const c1x = start[0] + (end[0] - previous[0]) / 6
    const c1y = start[1] + (end[1] - previous[1]) / 6
    const c2x = end[0] - (next[0] - start[0]) / 6
    const c2y = end[1] - (next[1] - start[1]) / 6

    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${end[0]} ${end[1]}`
  }
  return d
}

// Дороги рисуются строго слева направо (x только растёт): при rotate="auto"
// грузовик поворачивается по касательной, и на пути «справа налево» он ехал
// бы задом наперёд.
//
// Северная и центральная дороги пересекаются в точке [960, 470], центральная и
// южная — в точке [1240, 600]: на этих стыках стоят города.
const ROADS = [
  {
    className: "route-track route-track--warm",
    points: [
      [-60, 240],
      [300, 286],
      [620, 344],
      [960, 470],
      [1300, 556],
      [1520, 600],
    ] as Point[],
  },
  {
    className: "route-track",
    points: [
      [-60, 540],
      [300, 520],
      [620, 540],
      [960, 470],
      [1240, 600],
      [1520, 700],
    ] as Point[],
  },
  {
    className: "route-track route-track--cold",
    points: [
      [-60, 800],
      [300, 760],
      [620, 700],
      [960, 700],
      [1240, 600],
      [1520, 520],
    ] as Point[],
  },
]

const ROAD_PATHS = ROADS.map((road) => ({ ...road, d: roadPath(road.points) }))

/** Города — точки на дорогах: на стыках двух дорог и на их поворотах. */
const CITIES: readonly Point[] = [
  [300, 286],
  [620, 344],
  [960, 470],
  [1300, 556],
  [300, 520],
  [620, 540],
  [1240, 600],
  [300, 760],
  [620, 700],
]

/** Грузовики: какой дорогой едут, за сколько проходят круг и с каким сдвигом. */
const TRUCKS = [
  { road: 0, dur: "58s", begin: "0s" },
  { road: 1, dur: "74s", begin: "-19s" },
  { road: 2, dur: "88s", begin: "-37s" },
  { road: 1, dur: "66s", begin: "-52s" },
]

export function LiveBackground() {
  const pathname = usePathname() || ""
  const [isPaused, setIsPaused] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    if (!ANIMATED) return

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")

    // CSS-анимации останавливает атрибут data-paused, но SMIL он не трогает:
    // у <svg> есть собственные pauseAnimations/unpauseAnimations. Без них
    // грузовики продолжали считать кадры в скрытой вкладке.
    const sync = () => {
      setIsPaused(document.hidden)

      const svg = svgRef.current
      if (!svg || typeof svg.pauseAnimations !== "function") return
      if (document.hidden || reduceMotion.matches) {
        svg.pauseAnimations()
      } else {
        svg.unpauseAnimations()
      }
    }

    sync()
    document.addEventListener("visibilitychange", sync)
    reduceMotion.addEventListener("change", sync)
    return () => {
      document.removeEventListener("visibilitychange", sync)
      reduceMotion.removeEventListener("change", sync)
    }
  }, [])

  const isExcluded = EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
  if (isExcluded) return null

  return (
    <div
      aria-hidden="true"
      data-paused={isPaused ? "true" : "false"}
      className="theme-canvas"
    >
      <div className="theme-canvas__grid" />

      <svg
        ref={svgRef}
        className={ANIMATED ? "theme-canvas__routes" : "theme-canvas__routes theme-canvas--static"}
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          {/* Силуэт фуры один на все машины: прицеп, кабина, три колеса.
              Нос смотрит вправо — дороги рисуются слева направо. */}
          <g id="canvas-truck">
            <rect x="-32" y="-8" width="30" height="13" rx="1.5" />
            <rect x="1" y="-7" width="12" height="11" rx="2" />
            <rect x="9" y="-4" width="5" height="7" rx="1" opacity="0.7" />
            <circle cx="-24" cy="6.5" r="2.4" />
            <circle cx="-9" cy="6.5" r="2.4" />
            <circle cx="8" cy="6.5" r="2.4" />
          </g>
        </defs>

        {ROAD_PATHS.map((road) => (
          <path key={road.d} className={road.className} d={road.d} />
        ))}

        {CITIES.map(([cx, cy]) => (
          <g key={`${cx}-${cy}`}>
            {/* мягкий ободок: город читается как узел, а не как точка */}
            <circle className="route-city__halo" cx={cx} cy={cy} r="10" />
            <circle className="route-city" cx={cx} cy={cy} r="3.2" />
          </g>
        ))}

        {ANIMATED && (
          <g className="theme-canvas__trucks" fill="currentColor">
            {TRUCKS.map((truck, index) => (
              <g key={`${truck.road}-${truck.dur}-${index}`}>
                <animateMotion
                  dur={truck.dur}
                  begin={truck.begin}
                  repeatCount="indefinite"
                  path={ROAD_PATHS[truck.road].d}
                  rotate="auto"
                />
                <use href="#canvas-truck" />
              </g>
            ))}
          </g>
        )}
      </svg>

      <div className="theme-canvas__vignette" />
    </div>
  )
}
