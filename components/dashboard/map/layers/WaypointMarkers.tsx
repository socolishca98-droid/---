// components/dashboard/map/layers/WaypointMarkers.tsx
//
// Точки рейса: погрузка, выгрузка, база.
//
// Нумерация — внутри рейса (1, 2, 3…), а не сквозная по всем машинам: логист
// смотрит на один рейс и сверяет порядок объезда с карточкой рейса.

import { useEffect, useRef } from "react"
import L from "leaflet"
import type { RouteData } from "../types"
import { escapeHtml, escapeOrDash } from "../html"

interface WaypointMarkersProps {
  map: L.Map | null
  routes: RouteData[]
  enabled: boolean
}

const POINT_STYLES = {
  loading: {
    color: "#F59E0B",
    bg: "rgba(245, 158, 11, 0.15)",
    arrow: "↓",
    label: "Погрузка",
  },
  unloading: {
    color: "#10B981",
    bg: "rgba(16, 185, 129, 0.15)",
    arrow: "↑",
    label: "Выгрузка",
  },
  base: {
    color: "#FF6B35",
    bg: "rgba(255, 107, 53, 0.15)",
    arrow: "",
    label: "База",
  },
} as const

type PointType = keyof typeof POINT_STYLES

function isValidPosition(value: unknown): value is [number, number] {
  if (!Array.isArray(value) || value.length !== 2) return false
  const [lat, lng] = value as [unknown, unknown]
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
}

export function WaypointMarkers({ map, routes, enabled }: WaypointMarkersProps): null {
  const groupRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!map) return

    if (groupRef.current) {
      groupRef.current.remove()
      groupRef.current = null
    }

    if (!enabled) return

    const group = L.layerGroup([])
    const list = Array.isArray(routes) ? routes : []

    for (const route of list) {
      if (!route || !Array.isArray(route.waypoints)) continue

      let pointNumber = 1

      for (const waypoint of route.waypoints) {
        if (!waypoint || waypoint.type === "driver") continue
        if (!isValidPosition(waypoint.position)) continue

        const style = POINT_STYLES[waypoint.type as PointType]
        if (!style) continue

        const isBase = waypoint.type === "base"
        const number = isBase ? null : pointNumber++
        const address = escapeOrDash(waypoint.address, "Адрес не указан")

        const icon = L.divIcon({
          className: "wp-container",
          html: `
            <div class="wp" style="--c: ${style.color}; --bg: ${style.bg}">
              <div class="wp-dot">
                ${number !== null ? `<span class="wp-num">${number}</span>` : "⌂"}
                ${style.arrow ? `<span class="wp-arrow">${style.arrow}</span>` : ""}
              </div>
            </div>
          `,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -18],
        })

        const popup = `
          <div class="wp-popup">
            <div class="wp-popup-head" style="border-color: ${style.color}">
              <span class="wp-popup-type" style="color: ${style.color}">${style.arrow} ${style.label}</span>
              ${
                number !== null
                  ? `<span class="wp-popup-num" style="background: ${style.color}">${number}</span>`
                  : ""
              }
            </div>
            <div class="wp-popup-addr">${address}</div>
            ${
              route.driverName
                ? `<div class="wp-popup-info">🚚 ${escapeHtml(route.driverName)}</div>`
                : ""
            }
            ${
              route.cargoType
                ? `<div class="wp-popup-info">📦 ${escapeHtml(route.cargoType)}</div>`
                : ""
            }
          </div>
        `

        L.marker(waypoint.position, {
          icon,
          zIndexOffset: 200,
          keyboard: false,
          riseOnHover: true,
        })
          .bindPopup(popup, { className: "wp-popup-wrap", closeButton: false, maxWidth: 260 })
          .addTo(group)
      }
    }

    group.addTo(map)
    groupRef.current = group

    return () => {
      group.remove()
      if (groupRef.current === group) groupRef.current = null
    }
  }, [map, routes, enabled])

  return null
}
