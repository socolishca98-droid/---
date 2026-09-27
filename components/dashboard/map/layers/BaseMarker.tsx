// components/dashboard/map/layers/BaseMarker.tsx
//
// Метка базы автопарка (штаба). Данные приходят из настроек организации,
// поэтому название и адрес экранируются перед вставкой в HTML маркера.

import { useEffect, useRef } from "react"
import L from "leaflet"
import type { BaseData } from "../types"
import { escapeOrDash } from "../html"

interface BaseMarkerProps {
  map: L.Map | null
  base: BaseData | null
}

function isValidCoordinates(value: unknown): value is [number, number] {
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

export function BaseMarker({ map, base }: BaseMarkerProps): null {
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!map) return

    if (markerRef.current) {
      markerRef.current.remove()
      markerRef.current = null
    }

    if (!base || !isValidCoordinates(base.coordinates)) {
      if (base?.coordinates) console.warn("[BaseMarker] Некорректные координаты базы:", base.coordinates)
      return
    }

    const name = escapeOrDash(base.name, "Автопарк")
    const address = escapeOrDash(base.address, "Адрес не указан")

    const baseIcon = L.divIcon({
      className: "base-marker",
      html: `
        <div class="base-container">
          <div class="base-pulse-1"></div>
          <div class="base-pulse-2"></div>
          <div class="base-core">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div class="base-label">${name}</div>
        </div>
      `,
      iconSize: [72, 72],
      iconAnchor: [36, 36],
      popupAnchor: [0, -34],
    })

    markerRef.current = L.marker(base.coordinates, {
      icon: baseIcon,
      zIndexOffset: 1000,
      keyboard: false,
    })
      .addTo(map)
      .bindPopup(
        `
        <div class="popup-content">
          <div class="popup-header">
            <div class="popup-avatar" style="background: linear-gradient(135deg, #FF6B35, #E85A2A)">
              🏠
            </div>
            <div>
              <div class="popup-name">${name}</div>
              <div class="popup-vehicle">${address}</div>
            </div>
          </div>
        </div>
      `,
        { className: "custom-popup", maxWidth: 280 },
      )

    return () => {
      if (markerRef.current) {
        markerRef.current.remove()
        markerRef.current = null
      }
    }
  }, [map, base])

  return null
}
