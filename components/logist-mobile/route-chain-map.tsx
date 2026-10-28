// components/logist-mobile/route-chain-map.tsx
//
// Карта цепочки маршрута: база → погрузка → выгрузка → … → домой.
//
// Зачем она в помощнике сборки: логист принимает решение глазами. Список
// плеч показывает деньги, но не показывает форму поездки — а «петля вокруг
// области» и «развоз по кругу» видны сразу и меняют решение. Поэтому над
// списком плеч стоит маленькая карта с точками по номерам плеч.
//
// Карта намеренно простая: полилиния + номера. Никаких слоёв, плиток
// «спутник» и кластеризации — на телефоне в поле это лишнее.

"use client"

import { useEffect, useRef } from "react"
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
}

export function RouteChainMap({ points }: { points: RouteMapPoint[] }) {
  const container = useRef<HTMLDivElement | null>(null)
  const map = useRef<L.Map | null>(null)
  // Узел, к которому привязана карта. React может заменить сам DOM-узел при
  // перерисовке (например, когда вместо «точек пока нет» появляется контейнер
  // карты), и тогда Leaflet продолжает жить на устаревшем узле — на экране
  // пустой прямоугольник. Поэтому сверяем: тот ли узел.
  const boundNode = useRef<HTMLDivElement | null>(null)

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
    // Плитки CARTO dark: в тёмной панели карта должна оставаться картой, а не
    // светлым листом посреди ночного экрана. Атрибуция включена — так требует
    // лицензия OpenStreetMap, на чьих данных эти плитки построены.
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
      className: "map-tiles-dark",
    })
    tiles.addTo(instance)

    const layer = L.layerGroup().addTo(instance)
    const line: Array<[number, number]> = []

    for (const point of points) {
      const position: [number, number] = [point.lat, point.lng]
      line.push(position)
      const isHome = Boolean(point.home)
      L.marker(position, {
        icon: L.divIcon({
          className: "",
          html: `<span style="
            display:flex;align-items:center;justify-content:center;
            min-width:22px;height:22px;padding:0 5px;border-radius:11px;
            background:${isHome ? "#1f6f3f" : "var(--primary, #2563eb)"};
            color:#fff;font:600 11px/1 system-ui,sans-serif;
            border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);
            white-space:nowrap;">${point.index ?? "⌂"}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        title: point.label,
      }).addTo(layer)
    }

    if (line.length > 1) {
      L.polyline(line, {
        color: "#2563eb",
        weight: 3,
        opacity: 0.75,
        dashArray: "1 8",
        lineCap: "round",
      }).addTo(layer)
    }

    const bounds = L.latLngBounds(line as Array<[number, number]>)
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
      timers.forEach((timer) => window.clearTimeout(timer))
      observer.disconnect()
      layer.remove()
      tiles.remove()
    }
  }, [points])

  if (points.length === 0) {
    return (
      <p className="px-1 text-[12.5px] text-muted-foreground">
        Точек маршрута пока нет — карта появится, когда биржа отдаст координаты.
      </p>
    )
  }

  return (
    <div
      ref={container}
      className="h-[190px] w-full overflow-hidden rounded-xl border border-border lg:h-[420px]"
      aria-label="Карта маршрута"
      role="img"
    />
  )
}
