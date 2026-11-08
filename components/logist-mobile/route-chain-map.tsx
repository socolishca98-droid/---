// components/logist-mobile/route-chain-map.tsx
//
// Карта цепочки маршрута: база → погрузка → выгрузка → … → домой.
//
// Зачем она в помощнике сборки: логист принимает решение глазами. Список
// плеч показывает деньги, но не показывает форму поездки — а «петля вокруг
// области» и «развоз по кругу» видны сразу и меняют решение. Поэтому над
// списком плеч стоит карта с точками по номерам плеч.
//
// Как нарисована дорога (правило «расстояния не подменять» относится и к
// картинке): линия — ГЕОМЕТРИЯ ДОРОГИ от OSRM (эндпоинт /api/geo/route-shape,
// с кэшем), а не прямая между городами. Если дорогу получить не удалось,
// участок рисуется пунктиром и серым — прямую видно как прямую, а не
// выдаётся за маршрут. Пока дорога грузится, стоит аккуратный статус.
//
// Движение: по нарисованной дороге ездит маленький грузовик — превью
// поездки (это план, а не рейс: никакой телеметрии тут нет и быть не
// должно). Направление движения показывают «муравьи» — бегущий пунктир
// поверх сплошной линии.

"use client"

import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

export interface RouteMapPoint {
  lat: number
  lng: number
  /** Подпись точки: город и что на ней происходит */
  label: string
  /** Номер плеча — рисуем в кружке. База и «домой» без номера. */
  index?: number
  /** Домашняя точка — другим цветом */
  home?: boolean
  /** Что происходит в точке: погрузка / выгрузка. Цвет кружка. */
  kind?: "load" | "unload"
}

type ShapeLeg = {
  geometry: [number, number][]
  km: number
  source: "osrm" | "line"
}

type ShapeResponse = {
  success: boolean
  legs?: ShapeLeg[]
  error?: string
}

/** Гаверсинус в километрах — для равномерной скорости анимации грузовика. */
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const lat1 = (a[0] * Math.PI) / 180
  const lat2 = (b[0] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Фургон в кружке-плашке; flip — едет влево. */
function truckIcon(flip: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:34px;height:34px;border-radius:9999px;
      background:#fff;border:2px solid #2563eb;
      box-shadow:0 3px 10px rgba(0,0,0,.45);
      transform:scaleX(${flip ? -1 : 1});transition:transform .3s;">
      <svg viewBox="0 0 34 20" width="22" height="13" aria-hidden="true">
        <rect x="1" y="2" width="20" height="12" rx="2" fill="#2563eb"/>
        <path d="M22 5.5h6.2l4.3 4.2V14H22z" fill="#1e40af"/>
        <rect x="23.5" y="6.5" width="4" height="3.4" rx=".6" fill="#dbeafe"/>
        <circle cx="8" cy="15.5" r="3.1" fill="#0f172a" stroke="#fff" stroke-width="1.6"/>
        <circle cx="26" cy="15.5" r="3.1" fill="#0f172a" stroke="#fff" stroke-width="1.6"/>
      </svg>
    </span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

export function RouteChainMap({ points }: { points: RouteMapPoint[] }) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<L.Map | null>(null)
  // Узел, к которому привязана карта. React может заменить сам DOM-узел при
  // перерисовке (например, когда вместо «точек пока нет» появляется контейнер
  // карты), и тогда Leaflet продолжает жить на устаревшем узле — на экране
  // пустой прямоугольник. Поэтому сверяем: тот ли узел.
  const boundNode = useRef<HTMLDivElement | null>(null)
  const [shape, setShape] = useState<ShapeLeg[] | null>(null)

  /**
   * Карта создаётся, когда контейнер реально в документе.
   *
   * Раньше инициализация висела на эффекте с пустыми зависимостями: к моменту
   * его запуска точек ещё не было, компонент рендерил строку «точек пока нет»,
   * и `container.current` был null — эффект выходил, а больше не запускался.
   * Живой замер ПК-версии: блок «Как едем» показывал пустую рамку 420 px при
   * том, что точки маршрута уже были посчитаны.
   */
  const ensureMap = () => {
    const node = container.current
    if (!node) return null
    if (map.current && boundNode.current === node) return map.current
    if (map.current) {
      map.current.remove()
      map.current = null
    }
    const instance = L.map(node, {
      zoomControl: false,
      attributionControl: true,
      dragging: true,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: true,
    })
    map.current = instance
    boundNode.current = node
    return instance
  }

  useEffect(() => {
    return () => {
      map.current?.remove()
      map.current = null
      boundNode.current = null
    }
  }, [])

  // Дорога для точек: спрашиваем у сервера (OSRM + кэш живут там).
  useEffect(() => {
    if (points.length < 2) {
      setShape(null)
      return
    }
    let active = true
    void (async () => {
      try {
        const response = await fetch("/api/geo/route-shape", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ points: points.map((p) => ({ lat: p.lat, lng: p.lng })) }),
        })
        const payload = (await response.json()) as ShapeResponse
        if (!active) return
        if (response.ok && payload.success && (payload.legs?.length ?? 0) > 0) {
          setShape(payload.legs ?? null)
        } else {
          // Сервер не смог — честные прямые (нарисуются пунктиром).
          const legs: ShapeLeg[] = []
          for (let i = 0; i < points.length - 1; i += 1) {
            legs.push({
              geometry: [
                [points[i].lat, points[i].lng],
                [points[i + 1].lat, points[i + 1].lng],
              ],
              km: 0,
              source: "line",
            })
          }
          setShape(legs)
        }
      } catch {
        if (!active) return
        setShape(
          points.slice(0, -1).map((p, i) => ({
            geometry: [
              [p.lat, p.lng],
              [points[i + 1].lat, points[i + 1].lng],
            ],
            km: 0,
            source: "line" as const,
          })),
        )
      }
    })()
    return () => {
      active = false
    }
  }, [points])

  useEffect(() => {
    if (points.length === 0) return
    const instance = ensureMap()
    if (!instance) return

    // Плитки OpenStreetMap — единственные без ключа: CARTO с 2025 года отдаёт
    // вместо карты водяной знак «API KEY REQUIRED», и в тёмной панели это было
    // серое поле с рамкой. Темноту делаем фильтром на самих плитках (класс
    // map-tiles-dark в globals.css), а не сменой поставщика.
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: "© OpenStreetMap",
      crossOrigin: true,
    })
    tiles.addTo(instance)

    const layer = L.layerGroup().addTo(instance)

    // ——— Линия маршрута ———
    // Дорога (или честная прямая) + кант + бегущий пунктир-«муравьи».
    const legs = shape
    const line: Array<[number, number]> = []

    if (legs && legs.length > 0) {
      for (const leg of legs) {
        const isRoad = leg.source === "osrm" && leg.geometry.length >= 2
        // Кант: широкая тёмная подложка — линия читается и на светлом поле,
        // и на тёмном фоне ночной панели, и поверх плотной застройки.
        L.polyline(leg.geometry, {
          color: "#0f172a",
          weight: 8,
          opacity: 0.55,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layer)
        L.polyline(leg.geometry, {
          color: isRoad ? "#3b82f6" : "#64748b",
          weight: 4,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
          // Прямая — всегда пунктир: она «не дорога», и это видно.
          ...(isRoad ? {} : { dashArray: "6 10" }),
        }).addTo(layer)
        if (isRoad) {
          // «Муравьи»: бегущие штрихи поверх линии показывают направление.
          L.polyline(leg.geometry, {
            color: "#dbeafe",
            weight: 2,
            opacity: 0.9,
            dashArray: "2 14",
            lineCap: "round",
            className: "route-ants",
          }).addTo(layer)
        }
        line.push(...leg.geometry)
      }
    } else {
      // Дорога ещё грузится — рисуем тонкую «заготовку» по точкам.
      for (const point of points) line.push([point.lat, point.lng])
      L.polyline(line, {
        color: "#3b82f6",
        weight: 2.5,
        opacity: 0.45,
        dashArray: "2 8",
        lineCap: "round",
      }).addTo(layer)
    }

    // ——— Точки ———
    for (const point of points) {
      const position: [number, number] = [point.lat, point.lng]
      const isHome = Boolean(point.home)
      const background = isHome
        ? "#1f6f3f"
        : point.kind === "unload"
          ? "#0d9488"
          : "var(--primary, #2563eb)"
      L.marker(position, {
        icon: L.divIcon({
          className: "",
          html: `<span style="
            display:flex;align-items:center;justify-content:center;
            min-width:22px;height:22px;padding:0 5px;border-radius:11px;
            background:${background};color:#fff;font:600 11px/1 system-ui,sans-serif;
            border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);
            white-space:nowrap;">${point.index ?? "⌂"}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        title: point.label,
        zIndexOffset: 500,
      })
        .addTo(layer)
        .bindTooltip(point.label, { direction: "top", offset: [0, -12] })
    }

    // ——— Грузовик: превью поездки по нарисованной дороге ———
    let stopTruck: (() => void) | null = null
    if (legs && legs.length > 0) {
      const path: Array<[number, number]> = legs.flatMap((leg) => leg.geometry)
      if (path.length >= 2) {
        const cum: number[] = [0]
        for (let i = 1; i < path.length; i += 1) {
          cum.push(cum[i - 1] + haversineKm(path[i - 1], path[i]))
        }
        const totalKm = cum[cum.length - 1]
        if (totalKm > 0) {
          const marker = L.marker(path[0], {
            icon: truckIcon(false),
            zIndexOffset: 1000,
            interactive: false,
            keyboard: false,
          }).addTo(layer)

          const LOOP_MS = 14000
          const startedAt = performance.now()
          let frame = 0
          let lastFlip = false
          const tick = () => {
            const progress = ((performance.now() - startedAt) % LOOP_MS) / LOOP_MS
            const target = progress * totalKm
            let i = 1
            while (i < cum.length - 1 && cum[i] < target) i += 1
            const share = (target - cum[i - 1]) / Math.max(cum[i] - cum[i - 1], 1e-9)
            const lat = path[i - 1][0] + (path[i][0] - path[i - 1][0]) * share
            const lng = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * share
            marker.setLatLng([lat, lng])
            const flip = path[i][1] < path[i - 1][1]
            if (flip !== lastFlip) {
              marker.setIcon(truckIcon(flip))
              lastFlip = flip
            }
            frame = requestAnimationFrame(tick)
          }
          frame = requestAnimationFrame(tick)
          stopTruck = () => cancelAnimationFrame(frame)
        }
      }
    }

    const bounds =
      line.length > 1
        ? L.latLngBounds(line as Array<[number, number]>)
        : L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]))
    instance.fitBounds(bounds, { padding: [26, 26], maxZoom: 9 })
    // Плиты и сетка догружаются асинхронно — иначе карта «прыгает» размерами.
    // На компьютере ширина колонки окончательная только после первой раскладки
    // grid, поэтому пересчитываем дважды.
    const timers = [
      window.setTimeout(() => instance.invalidateSize(), 60),
      window.setTimeout(() => instance.invalidateSize(), 600),
    ]
    const observer = new ResizeObserver(() => instance.invalidateSize())
    if (container.current) observer.observe(container.current)

    return () => {
      stopTruck?.()
      timers.forEach((timer) => window.clearTimeout(timer))
      observer.disconnect()
      layer.remove()
      tiles.remove()
    }
  }, [points, shape])

  if (points.length === 0) {
    return (
      <p className="px-1 text-[12.5px] text-muted-foreground">
        Точек маршрута пока нет — карта появится, когда биржа отдаст координаты.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      <div
        ref={container}
        className="route-map h-[190px] w-full overflow-hidden rounded-xl border border-border lg:h-[420px]"
        aria-label="Карта маршрута"
        role="img"
      />
      {shape === null ? (
        <p className="px-1 text-[11.5px] text-muted-foreground">
          Прокладываем дорогу по улицам…
        </p>
      ) : null}
    </div>
  )
}
