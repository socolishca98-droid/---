// components/dashboard/map/layers/BaseMarker.tsx

import { useEffect, useRef } from "react"
import L from "leaflet"
import type { BaseData } from "../types"

interface BaseMarkerProps {
  map: L.Map | null
  base: BaseData | null
}

export function BaseMarker({ map, base }: BaseMarkerProps): null {
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!map) return

    // Удаляем старый маркер
    if (markerRef.current) {
      markerRef.current.remove()
      markerRef.current = null
    }

    if (!base?.coordinates) return

    // Валидация координат
    const [lat, lng] = base.coordinates
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      isNaN(lat) ||
      isNaN(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      console.warn("[BaseMarker] Invalid coordinates:", base.coordinates)
      return
    }

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
          <div class="base-label">${base.name}</div>
        </div>
      `,
      iconSize: [72, 72],
      iconAnchor: [36, 36],
    })

    markerRef.current = L.marker(base.coordinates, {
      icon: baseIcon,
      zIndexOffset: 1000,
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
              <div class="popup-name">${base.name}</div>
              <div class="popup-vehicle">${base.address}</div>
            </div>
          </div>
        </div>
      `,
        { className: "custom-popup" }
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