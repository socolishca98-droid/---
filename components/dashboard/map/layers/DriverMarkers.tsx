// components/dashboard/map/layers/DriverMarkers.tsx

import { useEffect, useRef } from "react"
import L from "leaflet"
import type { DriverLocation } from "../types"
import { STATUS_CONFIG, ACTIVE_STATUSES } from "../constants"

interface DriverMarkersProps {
  /** ✅ ИСПРАВЛЕНО: теперь это L.Map | null */
  map: L.Map | null
  drivers: DriverLocation[]
  selectedDriverId: string | null
  onSelectDriver: (id: string) => void
}

export function DriverMarkers({
  map,
  drivers,
  selectedDriverId,
  onSelectDriver,
}: DriverMarkersProps): null {
  const markersRef = useRef<Map<string, L.Marker>>(new Map())

  useEffect(() => {
    // ✅ ИСПРАВЛЕНО: Проверяем map
    if (!map) return

    const currentMarkers = markersRef.current

    // Удаляем маркеры водителей, которых больше нет
    currentMarkers.forEach((marker, id) => {
      if (!drivers.find((d) => d.id === id)) {
        marker.remove()
        currentMarkers.delete(id)
      }
    })

    drivers.forEach((driver) => {
      if (!driver.latitude || !driver.longitude) return

      const pos: L.LatLngExpression = [driver.latitude, driver.longitude]
      const statusInfo = STATUS_CONFIG[driver.status] || STATUS_CONFIG.offline
      const isActive = ACTIVE_STATUSES.includes(driver.status)

      const truckIcon = L.divIcon({
        className: "driver-marker",
        html: `
          <div class="driver-container ${isActive ? "active" : ""}">
            ${isActive ? `<div class="driver-pulse" style="background: ${statusInfo.color}"></div>` : ""}
            <div class="driver-core" style="border-color: ${statusInfo.color}">
              <svg viewBox="0 0 24 24" fill="none" stroke="${statusInfo.color}" stroke-width="2">
                <rect x="1" y="3" width="15" height="13"/>
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
                <circle cx="5.5" cy="18.5" r="2.5"/>
                <circle cx="18.5" cy="18.5" r="2.5"/>
              </svg>
            </div>
            <div class="driver-pointer" style="border-top-color: ${statusInfo.color}"></div>
          </div>
        `,
        iconSize: [52, 62],
        iconAnchor: [26, 62],
        popupAnchor: [0, -62],
      })

      const popupContent = `
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-avatar" style="background: linear-gradient(135deg, ${statusInfo.color}, ${statusInfo.color}88)">
              ${driver.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .slice(0, 2)}
            </div>
            <div>
              <div class="popup-name">${driver.name}</div>
              <div class="popup-vehicle">${driver.vehiclePlate || "—"} • ${driver.vehicleType || ""}</div>
            </div>
          </div>
          <div class="popup-status" style="background: ${statusInfo.bg}; border-color: ${statusInfo.color}40">
            <span class="popup-status-dot" style="background: ${statusInfo.color}"></span>
            <span style="color: ${statusInfo.color}">${statusInfo.label}</span>
          </div>
          ${
            driver.routeFrom
              ? `
            <div class="popup-route">
              <div class="popup-route-from">${driver.routeFrom}</div>
              <div class="popup-route-arrow">↓</div>
              <div class="popup-route-to">${driver.routeTo}</div>
            </div>
          `
              : ""
          }
        </div>
      `

      if (currentMarkers.has(driver.id)) {
        const marker = currentMarkers.get(driver.id)!
        marker.setLatLng(pos)
        marker.setIcon(truckIcon)
        marker.setPopupContent(popupContent)
      } else {
        const marker = L.marker(pos, { icon: truckIcon })
          .addTo(map)
          .bindPopup(popupContent, { className: "custom-popup" })

        marker.on("click", () => onSelectDriver(driver.id))
        currentMarkers.set(driver.id, marker)
      }
    })

    // ✅ Cleanup при размонтировании
    return () => {
      currentMarkers.forEach((marker) => marker.remove())
      currentMarkers.clear()
    }
  }, [map, drivers, onSelectDriver]) // ✅ map теперь корректная зависимость

  return null
}