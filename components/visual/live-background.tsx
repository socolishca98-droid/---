"use client"

// components/visual/live-background.tsx
//
// Живой фон рабочего места (задача 9): тёмная геометрия логистики —
// сетка склада, пунктирные треки маршрутов, узлы-перевалочные точки и
// медленно плывущие световые пятна.
//
// Как это сделано и почему это никому не мешает:
// — слой декоративный: aria-hidden, pointer-events: none, z-index: -1;
// — всё движение — CSS-анимации по transform/opacity (иначе говоря, работой
//   занимается видеокарта, а не главный поток), в JavaScript ни одного кадра;
// — в мобильном приложении водителя и на печати фон не рендерится вовсе:
//   там свои экраны и принтер — экономить, так на всём;
// — скрытая вкладка ставит анимации на паузу (data-paused), системная
//   настройка «уменьшить движение» выключает их целиком (@media в globals.css).

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

/** Где фон не нужен: контур водителя и печатные листы документов. */
const EXCLUDED_PREFIXES = ["/m", "/print"]

const TRACKS = [
  {
    className: "route-track route-track--warm",
    d: "M-60 648 C 220 600, 360 748, 620 688 S 1010 528, 1520 612",
  },
  {
    className: "route-track route-track--cold",
    d: "M-40 236 C 280 306, 470 168, 760 228 S 1180 366, 1520 286",
  },
  {
    className: "route-track",
    d: "M188 968 C 320 754, 556 692, 700 508 S 892 110, 1116 -48",
  },
] as const

/** Точки-«грузовики», которые едут по трекам. */
const RUNNERS = [
  { path: TRACKS[0].d, dur: "46s", color: "oklch(0.68 0.2 32 / 0.9)", begin: "0s" },
  { path: TRACKS[1].d, dur: "62s", color: "oklch(0.66 0.13 220 / 0.85)", begin: "-12s" },
  { path: TRACKS[2].d, dur: "78s", color: "oklch(0.72 0.14 90 / 0.7)", begin: "-30s" },
] as const

type CanvasNode = { left: string; top: string; soft?: boolean }

const NODES: readonly CanvasNode[] = [
  { left: "12%", top: "26%" },
  { left: "34%", top: "72%", soft: true },
  { left: "58%", top: "18%" },
  { left: "76%", top: "58%", soft: true },
  { left: "88%", top: "34%" },
  { left: "22%", top: "48%", soft: true },
] as const

export function LiveBackground() {
  const pathname = usePathname() || ""
  const [isPaused, setIsPaused] = useState(false)

  // Скрытая вкладка — пауза: фон не тратит батарею, когда на него не смотрят
  useEffect(() => {
    const onVisibilityChange = () => setIsPaused(document.hidden)

    onVisibilityChange()
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
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
      <div className="theme-canvas__aurora theme-canvas__aurora--a" />
      <div className="theme-canvas__aurora theme-canvas__aurora--b" />
      <div className="theme-canvas__aurora theme-canvas__aurora--c" />

      <div className="theme-canvas__grid" />

      <svg
        className="theme-canvas__routes"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        {/* Перевалочные узлы: ромбы и круг — геометрия маршрутной сети */}
        <rect
          className="route-node"
          x="1042"
          y="150"
          width="118"
          height="118"
          transform="rotate(45 1101 209)"
        />
        <rect
          className="route-hub"
          x="228"
          y="596"
          width="76"
          height="76"
          transform="rotate(45 266 634)"
        />
        <circle className="route-node route-node--core" cx="266" cy="634" r="2.6" />
        <circle className="route-node route-node--core" cx="1101" cy="209" r="2.6" />

        {TRACKS.map((track) => (
          <path key={track.d} className={track.className} d={track.d} />
        ))}

        {RUNNERS.map((runner) => (
          <g key={runner.dur} fill={runner.color}>
            <animateMotion
              dur={runner.dur}
              begin={runner.begin}
              repeatCount="indefinite"
              path={runner.path}
              rotate="auto"
            />
            {/* двойной круг вместо фильтра размытия: дешевле и так же мягко */}
            <circle r="7" opacity="0.22" />
            <circle r="2.6" />
          </g>
        ))}
      </svg>

      <div className="theme-canvas__nodes">
        {NODES.map((node, index) => (
          <span
            key={`${node.left}-${node.top}`}
            className={node.soft ? "canvas-node canvas-node--soft" : "canvas-node"}
            style={{
              left: node.left,
              top: node.top,
              animationDelay: `${(index * 0.9).toFixed(1)}s`,
            }}
          />
        ))}
      </div>

      <div className="theme-canvas__vignette" />
    </div>
  )
}
