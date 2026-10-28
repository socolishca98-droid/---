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

  useEffect(() => {
    if (!container.current || map.current) return
    // Карта создаётся один раз: без пересоздания не мигает при пересборке
    const instance = L.map(container.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: true,
    })
    map.current = instance
    return () => {
      instance.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance || points.length === 0) return

    // Плитки OpenStreetMap: без ключей и без лимитов для нашего объёма
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      crossOrigin: true,
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
    // Плиты догружаются асинхронно — иначе карта «прыгает» размерами
    window.setTimeout(() => instance.invalidateSize(), 60)

    return () => {
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
