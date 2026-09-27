// components/dashboard/map/layers/TrafficLayer.tsx
//
// Слой дорожной обстановки: рисуется строго по геометрии рейсов и строго по
// данным, которые вернул сервис пробок (/api/traffic/batch).
//
// Важно: раньше слой сам «дорисовывал» заторы и ДТП детерминированным
// генератором, когда данные ещё не пришли. На рабочем дашборде это выглядело
// как настоящая авария на маршруте — теперь выдуманных событий нет: пока данных
// нет, слой пуст, а панель честно пишет «нет данных» (см. lib/traffic/fleet-summary.ts).

"use client"

import { useEffect, useMemo, useRef } from "react"
import L from "leaflet"
import type { RouteData } from "../types"
import type { TrafficRouteInfo } from "@/lib/traffic/types"
import {
  CONGESTION_SEVERITY,
  speedBySeverity,
  summarizeFleetTraffic,
  type FleetTrafficSummary,
} from "@/lib/traffic/fleet-summary"
import { escapeHtml, escapeOrDash } from "../html"

/** Совместимость со старым именем типа: панели дашборда импортируют его отсюда. */
export type TrafficLevelInfo = FleetTrafficSummary

interface TrafficLayerProps {
  map: L.Map | null
  routes: RouteData[]
  trafficByRouteId?: Record<string, TrafficRouteInfo>
  enabled: boolean
  showEvents?: boolean
  /** Показывать только значимые заторы (severity ≥ 0.65) и инциденты */
  congestionsOnly?: boolean
  opacity?: number
  onTrafficInfoChange?: (info: TrafficLevelInfo) => void
}

const TRAFFIC_PANE = "routeTrafficPane"
const EVENTS_PANE = "routeTrafficEventsPane"
const CASING_COLOR = "#12141c"

/** Цвет участка по тяжести: от свободного движения до критического затора. */
function colorBySeverity(severity: number, type?: string): string {
  if (type === "closure") return "#e11d48"
  if (type === "accident") return "#f43f5e"
  if (severity >= 0.85) return "#e05353"
  if (severity >= CONGESTION_SEVERITY) return "#f97316"
  if (severity >= 0.4) return "#f59e0b"
  return "#22c55e"
}

function isSignificant(severity: number, type?: string): boolean {
  if (type === "accident" || type === "closure") return true
  return severity >= CONGESTION_SEVERITY
}

function isValidLatLng(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 90 &&
    Math.abs(value[1]) <= 180
  )
}

export function TrafficLayer({
  map,
  routes,
  trafficByRouteId,
  enabled,
  showEvents = true,
  congestionsOnly = false,
  opacity = 0.9,
  onTrafficInfoChange,
}: TrafficLayerProps): null {
  const layerGroupRef = useRef<L.LayerGroup | null>(null)

  // Отдельные pane: линии пробок ниже маркеров, инциденты — выше линий
  useEffect(() => {
    if (!map) return

    if (!map.getPane(TRAFFIC_PANE)) {
      const pane = map.createPane(TRAFFIC_PANE)
      pane.style.zIndex = "420"
      pane.style.pointerEvents = "none"
    }
    if (!map.getPane(EVENTS_PANE)) {
      const pane = map.createPane(EVENTS_PANE)
      pane.style.zIndex = "460"
    }
  }, [map])

  // Сводка для панелей дашборда — считается по настоящим данным
  const summary = useMemo(
    () =>
      summarizeFleetTraffic({
        routes: routes.map((route) => ({
          id: route.id,
          driverName: route.driverName,
          vehiclePlate: route.vehiclePlate,
          routeFrom: route.routeFrom,
          routeTo: route.routeTo,
          coordinates: route.coordinates,
        })),
        trafficByRouteId,
        congestionsOnly,
      }),
    [routes, trafficByRouteId, congestionsOnly],
  )

  useEffect(() => {
    onTrafficInfoChange?.(summary)
  }, [summary, onTrafficInfoChange])

  // Отрисовка участков
  useEffect(() => {
    if (!map) return

    if (layerGroupRef.current) {
      layerGroupRef.current.remove()
      layerGroupRef.current = null
    }

    if (!enabled || routes.length === 0 || !trafficByRouteId) return

    const group = L.layerGroup([])

    for (const route of routes) {
      const info = trafficByRouteId[route.id]
      const coordinates = Array.isArray(route.coordinates) ? route.coordinates.filter(isValidLatLng) : []
      if (!info || !Array.isArray(info.segments) || info.segments.length === 0) continue
      if (coordinates.length < 2) continue

      const totalPoints = coordinates.length

      for (const segment of info.segments) {
        const severity = Math.max(0, Math.min(1, segment.severity ?? 0))
        const significant = isSignificant(severity, segment.type)
        if (congestionsOnly && !significant) continue

        const startIdx = Math.max(
          0,
          Math.min(totalPoints - 1, Math.floor((segment.startT ?? 0) * (totalPoints - 1))),
        )
        const endIdx = Math.max(
          startIdx + 1,
          Math.min(totalPoints - 1, Math.ceil((segment.endT ?? 0) * (totalPoints - 1))),
        )
        const segmentCoords = coordinates.slice(startIdx, endIdx + 1)
        if (segmentCoords.length < 2) continue

        const color = colorBySeverity(severity, segment.type)
        const delayMin = Math.max(0, Math.round(segment.delayMin ?? 0))
        const roadName =
          segment.roadName || (route.routeTo ? `Трасса на ${route.routeTo}` : "Участок трассы")

        // Тёмная подложка: линия читается и на светлых тайлах, и на спутнике
        const casing = L.polyline(segmentCoords, {
          pane: TRAFFIC_PANE,
          color: CASING_COLOR,
          weight: significant ? 6.5 : 5,
          opacity: 0.85 * opacity,
          lineCap: "round",
          lineJoin: "round",
          interactive: false,
        })

        const trafficLine = L.polyline(segmentCoords, {
          pane: TRAFFIC_PANE,
          color,
          weight: significant ? 4.2 : 3.2,
          opacity: 0.95 * opacity,
          lineCap: "round",
          lineJoin: "round",
          dashArray: segment.type === "closure" ? "6, 8" : undefined,
        })

        const tooltipHtml = `
          <div class="traffic-tooltip">
            <div class="traffic-tooltip__head">
              <span class="traffic-tooltip__title">
                ${
                  segment.type === "closure"
                    ? "⛔ Перекрытие дороги"
                    : segment.type === "accident"
                    ? "💥 ДТП на маршруте"
                    : significant
                    ? "🛑 Сильный затор"
                    : "🚗 Замедление движения"
                }
              </span>
              ${
                delayMin > 0
                  ? `<span class="traffic-tooltip__delay">+${delayMin} мин</span>`
                  : `<span class="traffic-tooltip__delay traffic-tooltip__delay--ok">без задержки</span>`
              }
            </div>
            <div class="traffic-tooltip__row">
              Водитель: <strong>${escapeOrDash(route.driverName, "не назначен")}</strong>
              ${route.vehiclePlate ? ` · ${escapeHtml(route.vehiclePlate)}` : ""}
            </div>
            <div class="traffic-tooltip__row">📍 ${escapeHtml(roadName)}</div>
            <div class="traffic-tooltip__row traffic-tooltip__row--muted">
              ${escapeHtml(segment.description || "Данные сервиса пробок")} · ~${speedBySeverity(
          severity,
        )} км/ч
            </div>
            ${
              info.mock
                ? `<div class="traffic-tooltip__note">Демо-данные: модель обстановки, не измерение</div>`
                : ""
            }
          </div>
        `

        trafficLine.bindTooltip(tooltipHtml, {
          sticky: true,
          direction: "top",
          opacity: 1,
          className: "traffic-leaflet-tooltip",
        })

        trafficLine.on("mouseover", () => {
          trafficLine.setStyle({ weight: 6, opacity: 1 })
          casing.setStyle({ weight: 9 })
        })
        trafficLine.on("mouseout", () => {
          trafficLine.setStyle({ weight: significant ? 4.2 : 3.2, opacity: 0.95 * opacity })
          casing.setStyle({ weight: significant ? 6.5 : 5 })
        })

        group.addLayer(casing)
        group.addLayer(trafficLine)

        if (showEvents && (segment.type === "accident" || segment.type === "closure")) {
          const midPoint = segmentCoords[Math.floor(segmentCoords.length / 2)] ?? segmentCoords[0]
          const isClosure = segment.type === "closure"
          const badgeBg = isClosure ? "#be123c" : "#e11d48"

          const iconHtml = `
            <div class="traffic-incident-marker">
              <span class="traffic-incident-beacon" style="border-color: ${badgeBg}"></span>
              <span class="traffic-incident-badge" style="border-color: ${badgeBg}">
                <span class="traffic-incident-emoji">${isClosure ? "⛔" : "💥"}</span>
                <span class="traffic-incident-delay">+${delayMin || 15}м</span>
              </span>
            </div>
          `

          const marker = L.marker(midPoint, {
            icon: L.divIcon({
              className: "traffic-incident-div-icon",
              html: iconHtml,
              iconSize: [52, 28],
              iconAnchor: [26, 14],
              popupAnchor: [0, -14],
            }),
            pane: EVENTS_PANE,
            keyboard: false,
          })

          marker.bindPopup(
            `
              <div class="traffic-popup">
                <div class="traffic-popup__head">
                  <span style="color: ${color}">${isClosure ? "⛔ Перекрытие дороги" : "💥 ДТП на маршруте"}</span>
                  <span class="traffic-popup__delay">+${delayMin || 15} мин</span>
                </div>
                <div class="traffic-popup__row">
                  Водитель: <strong>${escapeOrDash(route.driverName, "не назначен")}</strong>
                  (${escapeOrDash(route.vehiclePlate, "рейс")})
                </div>
                <div class="traffic-popup__row">📍 ${escapeHtml(roadName)}</div>
                <p class="traffic-popup__text">${escapeHtml(
                  segment.description || "Ограничение движения на участке",
                )}</p>
                ${
                  info.mock
                    ? `<div class="traffic-tooltip__note">Демо-данные: модель обстановки, не измерение</div>`
                    : ""
                }
              </div>
            `,
            { className: "traffic-popup-wrap", closeButton: false, maxWidth: 280 },
          )

          group.addLayer(marker)
        }
      }
    }

    group.addTo(map)
    layerGroupRef.current = group

    return () => {
      group.remove()
      if (layerGroupRef.current === group) layerGroupRef.current = null
    }
  }, [map, routes, trafficByRouteId, enabled, showEvents, congestionsOnly, opacity])

  return null
}
