// components/dashboard/map/layers/WaypointMarkers.tsx

import { useEffect, useRef } from "react"
import L from "leaflet"
import type { RouteData } from "../types"

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
    label: "Погрузка"
  },
  unloading: {
    color: "#10B981",
    bg: "rgba(16, 185, 129, 0.15)",
    arrow: "↑",
    label: "Выгрузка"
  },
  base: {
    color: "#FF6B35",
    bg: "rgba(255, 107, 53, 0.15)",
    arrow: "",
    label: "База"
  }
}

export function WaypointMarkers({
  map,
  routes,
  enabled,
}: WaypointMarkersProps): null {
  const markersRef = useRef<L.Marker[]>([])

  useEffect(() => {
    if (!map) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    if (!enabled) return

    let num = 1

    routes.forEach((route) => {
      if (!route.waypoints) return

      route.waypoints.forEach((wp) => {
        if (!wp.position || wp.type === "driver") return

        const style = POINT_STYLES[wp.type as keyof typeof POINT_STYLES]
        if (!style) return

        const pointNum = wp.type !== "base" ? num++ : null

        const html = `
          <div class="wp" style="--c: ${style.color}; --bg: ${style.bg}">
            <div class="wp-dot">
              ${pointNum !== null ? `<span class="wp-num">${pointNum}</span>` : '⌂'}
              ${style.arrow ? `<span class="wp-arrow">${style.arrow}</span>` : ''}
            </div>
          </div>
        `

        const icon = L.divIcon({
          className: "wp-container",
          html,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
          popupAnchor: [0, -20],
        })

        const popup = `
          <div class="wp-popup">
            <div class="wp-popup-head" style="border-color: ${style.color}">
              <span class="wp-popup-type" style="color: ${style.color}">${style.arrow} ${style.label}</span>
              ${pointNum ? `<span class="wp-popup-num" style="background: ${style.color}">${pointNum}</span>` : ''}
            </div>
            <div class="wp-popup-addr">${wp.address}</div>
            ${route.driverName ? `<div class="wp-popup-info">🚚 ${route.driverName}</div>` : ''}
            ${route.cargoType ? `<div class="wp-popup-info">📦 ${route.cargoType}</div>` : ''}
          </div>
        `

        const marker = L.marker(wp.position, { icon, zIndexOffset: 200 })
          .addTo(map)
          .bindPopup(popup, { className: "wp-popup-wrap", closeButton: false })

        markersRef.current.push(marker)
      })
    })

    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
    }
  }, [map, routes, enabled])

  return null
}