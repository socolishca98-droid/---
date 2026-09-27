// components/dashboard/map/layers/DriverMarkers.tsx
//
// Маркеры водителей на карте.
//
// Что здесь важно:
//  — маркеры обновляются точечно (diff по id), а не пересоздаются целиком:
//    данные приходят каждые 15 секунд, и при пересоздании карта «мигала»,
//    а открытый попап закрывался сам;
//  — колбэк выбора водителя держим в ref: иначе новая ссылка на функцию
//    перезапускала эффект на каждый рендер (и маркеры снова пересоздавались);
//  — все строки из данных экранируются (см. ../html.ts);
//  — выбранный водитель подсвечивается кольцом, чтобы связь
//    «строка в панели → машина на карте» была видна сразу.

import { useEffect, useRef } from "react"
import L from "leaflet"
import type { DriverLocation } from "../types"
import { STATUS_CONFIG, ACTIVE_STATUSES, formatDuration } from "../constants"
import { escapeHtml, escapeOrDash } from "../html"

interface DriverMarkersProps {
  map: L.Map | null
  drivers: DriverLocation[]
  selectedDriverId: string | null
  onSelectDriver: (id: string | null) => void
}

function initials(name: unknown): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function isValidPosition(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
}

function buildIcon(driver: DriverLocation, selected: boolean): L.DivIcon {
  const statusInfo = STATUS_CONFIG[driver.status] || STATUS_CONFIG.offline
  const isActive = ACTIVE_STATUSES.includes(driver.status)

  return L.divIcon({
    className: "driver-marker",
    html: `
      <div class="driver-container ${isActive ? "active" : ""} ${selected ? "selected" : ""}">
        ${selected ? `<div class="driver-ring" style="border-color: ${statusInfo.color}"></div>` : ""}
        ${
          isActive
            ? `<div class="driver-pulse" style="background: ${statusInfo.color}"></div>`
            : ""
        }
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
}

function buildPopup(driver: DriverLocation): string {
  const statusInfo = STATUS_CONFIG[driver.status] || STATUS_CONFIG.offline
  const name = escapeOrDash(driver.name, "Водитель")
  const duration =
    driver.statusDuration && driver.statusDuration > 0
      ? ` (${formatDuration(driver.statusDuration)})`
      : ""

  return `
    <div class="popup-content">
      <div class="popup-header">
        <div class="popup-avatar" style="background: linear-gradient(135deg, ${statusInfo.color}, ${statusInfo.color}88)">
          ${escapeHtml(initials(driver.name))}
        </div>
        <div>
          <div class="popup-name">${name}</div>
          <div class="popup-vehicle">${escapeOrDash(driver.vehiclePlate)}${
    driver.vehicleType ? ` • ${escapeHtml(driver.vehicleType)}` : ""
  }</div>
        </div>
      </div>
      <div class="popup-status" style="background: ${statusInfo.bg}; border-color: ${statusInfo.color}40">
        <span class="popup-status-dot" style="background: ${statusInfo.color}"></span>
        <span style="color: ${statusInfo.color}">${escapeHtml(statusInfo.label)}${escapeHtml(duration)}</span>
      </div>
      ${
        driver.routeFrom
          ? `
        <div class="popup-route">
          <div class="popup-route-from">${escapeHtml(driver.routeFrom)}</div>
          <div class="popup-route-arrow">↓</div>
          <div class="popup-route-to">${escapeHtml(driver.routeTo || "—")}</div>
        </div>
      `
          : ""
      }
    </div>
  `
}

export function DriverMarkers({
  map,
  drivers,
  selectedDriverId,
  onSelectDriver,
}: DriverMarkersProps): null {
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const onSelectRef = useRef(onSelectDriver)

  // Свежий колбэк — без перезапуска эффекта рисования
  useEffect(() => {
    onSelectRef.current = onSelectDriver
  }, [onSelectDriver])

  // Полный сброс при смене карты/размонтировании
  useEffect(() => {
    const markers = markersRef.current
    return () => {
      markers.forEach((marker) => marker.remove())
      markers.clear()
    }
  }, [map])

  useEffect(() => {
    if (!map) return

    const markers = markersRef.current
    const list = Array.isArray(drivers) ? drivers : []
    const seen = new Set<string>()

    for (const driver of list) {
      if (!driver?.id || !isValidPosition(driver.latitude, driver.longitude)) continue
      seen.add(driver.id)

      const position: L.LatLngExpression = [driver.latitude as number, driver.longitude as number]
      const selected = driver.id === selectedDriverId
      const existing = markers.get(driver.id)

      if (existing) {
        existing.setLatLng(position)
        existing.setIcon(buildIcon(driver, selected))
        existing.setPopupContent(buildPopup(driver))
        existing.setZIndexOffset(selected ? 1200 : 0)
        continue
      }

      const marker = L.marker(position, {
        icon: buildIcon(driver, selected),
        zIndexOffset: selected ? 1200 : 0,
        riseOnHover: true,
        keyboard: false,
      })
        .addTo(map)
        .bindPopup(buildPopup(driver), { className: "custom-popup", maxWidth: 280 })

      marker.on("click", () => onSelectRef.current(driver.id))
      markers.set(driver.id, marker)
    }

    // Водителей, которые пропали из ответа (смена/оффлайн), убираем с карты
    markers.forEach((marker, id) => {
      if (!seen.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    })
  }, [map, drivers, selectedDriverId])

  return null
}
