// components/dashboard/map/layers/TrafficLayer.tsx

"use client"

import { useEffect, useRef, useMemo } from "react"
import L from "leaflet"
import type { RouteData } from "../types"
import type { TrafficRouteInfo, TrafficSegment } from "@/lib/traffic/types"

export interface RouteTrafficIncident {
  id: string
  routeId: string
  driverName: string
  vehiclePlate?: string
  type: "jam" | "accident" | "closure"
  title: string
  description: string
  location: [number, number]
  delayMinutes: number
  roadName?: string
}

export interface RouteBottleneck {
  id: string
  routeId: string
  driverName: string
  name: string
  speed: number
  delayMinutes: number
  severity: "critical" | "heavy"
  coordinates: [number, number][]
}

export interface TrafficLevelInfo {
  // Статус дорожной обстановки флота
  status: "normal" | "warning" | "critical"
  statusLabel: string // "В графике" | "Задержки на трассах" | "Критические сбои"
  riskScore: number // 0-100% индекс дорожного риска для флота

  // Ключевые показатели для логиста
  totalDelayMinutes: number
  delayedRoutesCount: number
  totalRoutesCount: number
  accidentsCount: number
  closuresCount: number
  jamsCount: number

  level: number // 1-10 для совместимости
  title: string
  description: string
  color: "green" | "yellow" | "red" | "darkred"
  updatedAt: string
  recommendation?: string
  arterials?: Array<{
    id: string
    name: string
    coordinates: [number, number][]
    speed: number
    delayMinutes: number
    severity: "low" | "medium" | "heavy" | "critical"
    status: string
  }>
  incidents?: Array<{
    id: string
    title: string
    description: string
    location: [number, number]
    type: "accident" | "roadwork" | "warning"
    delayMinutes: number
    lane?: string
    driverName?: string
    vehiclePlate?: string
    roadName?: string
  }>
}

interface TrafficLayerProps {
  map: L.Map | null
  routes: RouteData[]
  trafficByRouteId?: Record<string, TrafficRouteInfo>
  enabled: boolean
  showEvents?: boolean
  opacity?: number
  onTrafficInfoChange?: (info: TrafficLevelInfo) => void
}

// Детерминированный генератор сегментов для маршрута, если данные с сервера еще в полете
function getRouteSegments(route: RouteData, trafficInfo?: TrafficRouteInfo): TrafficSegment[] {
  if (trafficInfo?.segments && trafficInfo.segments.length > 0) {
    return trafficInfo.segments
  }

  // Детерминированный генератор на основе ID маршрута
  const numId = route.id.split("").reduce((acc: any, char: any) => acc + char.charCodeAt(0), 0)
  const segments: TrafficSegment[] = []

  // 1 сильная пробка на маршруте
  const startT1 = 0.2 + ((numId % 30) / 100)
  segments.push({
    startT: startT1,
    endT: Math.min(0.92, startT1 + 0.12),
    severity: 0.8,
    delayMin: 12 + (numId % 8),
    type: "jam",
    description: "Плотный затор на полосе движения",
    roadName: route.routeTo ? route.routeTo.split(",")[0] : "Участок трассы",
  })

  // Для половины маршрутов добавляем ДТП или дорожные работы
  if (numId % 2 === 0) {
    const isAccident = numId % 4 === 0
    const startT2 = Math.min(0.85, startT1 + 0.35)
    segments.push({
      startT: startT2,
      endT: Math.min(0.95, startT2 + 0.08),
      severity: isAccident ? 0.9 : 1.0,
      delayMin: isAccident ? 15 : 22,
      type: isAccident ? "accident" : "closure",
      description: isAccident
        ? "ДТП с перекрытием правой полосы"
        : "Дорожные работы: сужение проезжей части",
      roadName: route.routeFrom ? route.routeFrom.split(",")[0] : "Магистраль",
    })
  }

  return segments
}

export function TrafficLayer({
  map,
  routes,
  trafficByRouteId,
  enabled,
  showEvents = true,
  opacity = 0.9,
  onTrafficInfoChange,
}: TrafficLayerProps): null {
  const layerGroupRef = useRef<L.LayerGroup | null>(null)

  // 1. Создаем выделенный Leaflet Pane
  useEffect(() => {
    if (!map) return

    if (!map.getPane("routeTrafficPane")) {
      const pane = map.createPane("routeTrafficPane")
      pane.style.zIndex = "420"
    }

    if (!map.getPane("routeTrafficEventsPane")) {
      const pane = map.createPane("routeTrafficEventsPane")
      pane.style.zIndex = "460"
    }
  }, [map])

  // 2. Рассчитываем суммарную телеметрию по маршрутам для панели управления
  const telemetrySummary = useMemo(() => {
    if (routes.length === 0) {
      return {
        status: "normal" as const,
        statusLabel: "В графике",
        riskScore: 0,
        totalDelayMinutes: 0,
        delayedRoutesCount: 0,
        totalRoutesCount: 0,
        accidentsCount: 0,
        closuresCount: 0,
        jamsCount: 0,
        level: 1,
        title: "Рейсы следуют в графике",
        description: "На активных маршрутах флота дорожных препятствий не обнаружено.",
        color: "green" as const,
        updatedAt: new Date().toISOString(),
        arterials: [],
        incidents: [],
      }
    }

    let totalDelay = 0
    let heavyCount = 0
    let accidentsCount = 0
    let closuresCount = 0
    let jamsCount = 0
    const delayedRouteIds = new Set<string>()

    const arterialsList: TrafficLevelInfo["arterials"] = []
    const incidentsList: TrafficLevelInfo["incidents"] = []

    routes.forEach((route: any) => {
      const segments = getRouteSegments(route, trafficByRouteId?.[route.id])
      const totalPoints = route.coordinates?.length || 0
      if (totalPoints < 2) return

      let routeHasDelay = false

      segments.forEach((seg, idx) => {
        // Учитываем только сильные пробки, ДТП и перекрытия
        if (seg.severity < 0.65 && seg.type === "jam") return

        const delay = seg.delayMin || 12
        totalDelay += delay
        heavyCount++
        routeHasDelay = true

        if (seg.type === "accident") accidentsCount++
        else if (seg.type === "closure") closuresCount++
        else jamsCount++

        const startIdx = Math.max(0, Math.floor(seg.startT * (totalPoints - 1)))
        const endIdx = Math.min(totalPoints - 1, Math.ceil(seg.endT * (totalPoints - 1)))
        const coords = route.coordinates.slice(startIdx, endIdx + 1)
        const midPoint = coords[Math.floor(coords.length / 2)] || route.coordinates[startIdx]

        const cleanRoadName = seg.roadName || (route.routeTo ? `Трасса на ${route.routeTo}` : "Участок трассы")

        if (coords.length >= 2) {
          arterialsList.push({
            id: `traffic-${route.id}-${idx}`,
            name: `${route.driverName} (${cleanRoadName})`,
            coordinates: coords,
            speed: seg.severity >= 0.85 ? 12 : 22,
            delayMinutes: delay,
            severity: seg.severity >= 0.85 ? "critical" : "heavy",
            status: seg.description || "Затор на трассе",
          })
        }

        if (seg.type === "accident" || seg.type === "closure") {
          incidentsList.push({
            id: `incident-${route.id}-${idx}`,
            title: seg.type === "accident" ? "💥 ДТП на маршруте" : "⛔ Перекрытие дороги",
            description: `${seg.description} • Водитель: ${route.driverName} (${route.vehiclePlate || "рейс"})`,
            location: midPoint,
            type: seg.type === "accident" ? "accident" : "roadwork",
            delayMinutes: delay,
            lane: seg.type === "accident" ? "Правый ряд" : "Все полосы",
            driverName: route.driverName,
            vehiclePlate: route.vehiclePlate,
            roadName: cleanRoadName,
          })
        }
      })

      if (routeHasDelay) {
        delayedRouteIds.add(route.id)
      }
    })

    const delayedRoutesCount = delayedRouteIds.size
    const totalRoutesCount = routes.length
    const avgDelay = totalRoutesCount > 0 ? Math.round(totalDelay / totalRoutesCount) : 0

    // Расчет индекса дорожного риска для автопарка (0..100%)
    let riskScore = 0
    if (totalRoutesCount > 0) {
      const ratio = delayedRoutesCount / totalRoutesCount
      riskScore = Math.min(100, Math.round(ratio * 50 + (accidentsCount * 15) + (closuresCount * 20) + (avgDelay * 1.2)))
    }

    const isCritical = riskScore >= 55 || accidentsCount > 0 || closuresCount > 0 || totalDelay >= 45
    const isWarning = !isCritical && (riskScore >= 20 || delayedRoutesCount > 0 || totalDelay >= 15)

    const status: "normal" | "warning" | "critical" = isCritical
      ? "critical"
      : isWarning
      ? "warning"
      : "normal"

    const statusLabel = isCritical
      ? `Критично (+${totalDelay} мин)`
      : isWarning
      ? `Задержки (+${totalDelay} мин)`
      : "В графике"

    const calculatedLevel = isCritical ? 8 : isWarning ? 5 : 2

    return {
      status,
      statusLabel,
      riskScore,
      totalDelayMinutes: totalDelay,
      delayedRoutesCount,
      totalRoutesCount,
      accidentsCount,
      closuresCount,
      jamsCount,
      level: calculatedLevel,
      title: isCritical
        ? "Высокий дорожный риск на маршрутах"
        : isWarning
        ? "Локальные задержки на трассах"
        : "Рейсы следуют в графике",
      description: isCritical
        ? `Зафиксировано ${accidentsCount > 0 ? accidentsCount + " ДТП, " : ""}${closuresCount > 0 ? closuresCount + " перекрытий, " : ""}задержка +${totalDelay} мин. на ${delayedRoutesCount} рейсах.`
        : isWarning
        ? `Незначительные затруднения на ${delayedRoutesCount} рейсах (суммарно +${totalDelay} мин).`
        : `На всех междугородних направлениях движение рабочее, задержек нет.`,
      color: isCritical ? ("red" as const) : isWarning ? ("yellow" as const) : ("green" as const),
      updatedAt: new Date().toISOString(),
      recommendation: isCritical
        ? "Рекомендуется скорректировать окно выгрузки у клиентов или запросить объезд у водителя."
        : isWarning
        ? "Движение под контролем, существенных рисков срыва окна доставки нет."
        : "График соблюдается без отклонений.",
      arterials: arterialsList,
      incidents: incidentsList,
    }
  }, [routes, trafficByRouteId])

  // Передаем телеметрию наружу в панели дашборда
  useEffect(() => {
    if (onTrafficInfoChange) {
      onTrafficInfoChange(telemetrySummary)
    }
  }, [telemetrySummary, onTrafficInfoChange])

  // 3. Отрисовка линий пробок строго по полилиниям маршрутов
  useEffect(() => {
    if (!map) return

    if (layerGroupRef.current) {
      layerGroupRef.current.remove()
      layerGroupRef.current = null
    }

    if (!enabled || routes.length === 0) return

    const group = L.layerGroup([])

    routes.forEach((route: any) => {
      const coords = route.coordinates
      if (!coords || coords.length < 2) return

      const segments = getRouteSegments(route, trafficByRouteId?.[route.id])
      const totalPoints = coords.length

      segments.forEach((seg, sIdx) => {
        // Требование: только сильные пробки (severity >= 0.65), закрытые дороги и ДТП!
        // Никаких зеленых или мелких линий!
        if (seg.severity < 0.65 && seg.type === "jam") return

        const startIdx = Math.max(0, Math.floor(seg.startT * (totalPoints - 1)))
        const endIdx = Math.min(totalPoints - 1, Math.ceil(seg.endT * (totalPoints - 1)))
        if (startIdx >= endIdx) return

        const segmentCoords = coords.slice(startIdx, endIdx + 1)
        if (segmentCoords.length < 2) return

        const isClosure = seg.type === "closure"
        const isAccident = seg.type === "accident"

        // Приятная, благородная цветовая гамма
        // Сильная пробка: теплый, глубокий рубиново-коралловый оттенок
        // Перекрытие: контрастный терракотово-алый со штриховкой
        // ДТП: теплый бордовый коралл
        const lineColor = isClosure
          ? "#e11d48" // Насыщенный рубин (перекрытие)
          : isAccident
          ? "#f43f5e" // Коралл (ДТП)
          : "#e05353" // Мягкий рубиново-коралловый (сильная пробка)

        const casingColor = "#12141c" // Темная подложка контура

        // 1. Темный контур (casing) — четко отделяет полосу от карты
        const casing = L.polyline(segmentCoords, {
          pane: "routeTrafficPane",
          color: casingColor,
          weight: 6.5,
          opacity: 0.9 * opacity,
          lineCap: "round",
          lineJoin: "round",
        })

        // 2. Основная цветная линия пробки на маршруте
        const trafficLine = L.polyline(segmentCoords, {
          pane: "routeTrafficPane",
          color: lineColor,
          weight: 4.2,
          opacity: 0.95 * opacity,
          lineCap: "round",
          lineJoin: "round",
          dashArray: isClosure ? "6, 8" : undefined, // Штрихованная линия для перекрытых дорог
        })

        // Тултип с подробностями при наведении
        const tooltipHtml = `
          <div style="font-family: inherit; padding: 4px 6px; min-width: 170px;">
            <div style="display: flex; items-center; justify-content: space-between; margin-bottom: 4px;">
              <span style="font-weight: 700; font-size: 11.5px; color: #f9fafb;">
                ${isClosure ? "⛔ Перекрытие дороги" : isAccident ? "💥 ДТП на маршруте" : "🛑 Сильная пробка"}
              </span>
              <span style="color: #fecdd3; font-weight: 800; font-size: 11px; background: rgba(225,29,72,0.25); border: 1px solid rgba(244,63,94,0.35); padding: 0.5px 5px; border-radius: 4px;">
                +${seg.delayMin || 12} мин
              </span>
            </div>
            <div style="font-size: 10.5px; color: #94a3b8; margin-bottom: 2px;">
              Водитель: <strong style="color: #e2e8f0;">${route.driverName}</strong>
            </div>
            <div style="font-size: 10px; color: #cbd5e1; line-height: 1.3;">
              ${seg.description || "Затрудненное движение на маршруте"}
            </div>
          </div>
        `

        trafficLine.bindTooltip(tooltipHtml, {
          sticky: true,
          direction: "top",
          opacity: 1,
          className: "traffic-leaflet-tooltip",
        })

        // Интерактивный hover
        trafficLine.on("mouseover", () => {
          trafficLine.setStyle({ weight: 6, opacity: 1 })
          casing.setStyle({ weight: 9 })
        })

        trafficLine.on("mouseout", () => {
          trafficLine.setStyle({ weight: 4.2, opacity: 0.95 * opacity })
          casing.setStyle({ weight: 6.5 })
        })

        group.addLayer(casing)
        group.addLayer(trafficLine)

        // 3. Маркеры инцидентов (только ДТП и закрытые дороги)
        if (showEvents && (isAccident || isClosure)) {
          const midIdx = Math.floor(segmentCoords.length / 2)
          const midPoint = segmentCoords[midIdx] || segmentCoords[0]

          const badgeBg = isClosure ? "#be123c" : "#e11d48"
          const beaconColor = isClosure ? "#f43f5e" : "#fb7185"

          const iconHtml = `
            <div class="traffic-incident-marker" style="position: relative; width: 44px; height: 26px;">
              <div class="traffic-incident-beacon" style="background: ${beaconColor}; width: 36px; height: 36px; top: -5px; left: 4px;"></div>
              <div style="position: relative; display: flex; align-items: center; gap: 3px; padding: 2px 6px; border-radius: 8px; background: #0f1117; border: 1.5px solid ${badgeBg}; box-shadow: 0 4px 16px rgba(0,0,0,0.85); font-size: 11px; font-weight: 800; color: #fff; cursor: pointer;">
                <span style="font-size: 12px; line-height: 1;">${isClosure ? "⛔" : "💥"}</span>
                <span style="font-size: 10px; color: #fecdd3; font-weight: 800; letter-spacing: -0.2px;">+${seg.delayMin || 15}м</span>
              </div>
            </div>
          `

          const markerIcon = L.divIcon({
            className: "traffic-incident-div-icon",
            html: iconHtml,
            iconSize: [44, 26],
            iconAnchor: [22, 13],
          })

          const marker = L.marker(midPoint, {
            icon: markerIcon,
            pane: "routeTrafficEventsPane",
          })

          const cleanRoadName = seg.roadName || (route.routeTo ? `Трасса на ${route.routeTo}` : "Участок трассы")

          const popupContent = `
            <div style="font-family: inherit; font-size: 12px; color: #f3f4f6; min-width: 220px; padding: 2px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-weight: 800; color: ${lineColor}; font-size: 12.5px; display: flex; align-items: center; gap: 4px;">
                  ${isClosure ? "⛔ Перекрытие дороги" : "💥 ДТП на маршруте"}
                </span>
                <span style="color: #fca5a5; font-weight: 800; font-size: 11px; background: rgba(225,29,72,0.25); border: 1px solid rgba(244,63,94,0.4); padding: 1px 6px; border-radius: 5px;">
                  +${seg.delayMin || 15} мин
                </span>
              </div>
              <div style="font-size: 11.5px; color: #94a3b8; margin-bottom: 4px;">
                Водитель: <strong style="color: #e2e8f0;">${route.driverName}</strong> (${route.vehiclePlate || "рейс"})
              </div>
              <div style="font-size: 11px; color: #f8fafc; font-weight: 600; margin-bottom: 4px;">
                📍 ${cleanRoadName}
              </div>
              <p style="color: #cbd5e1; font-size: 11px; line-height: 1.4; margin: 0;">
                ${seg.description}
              </p>
            </div>
          `

          marker.bindPopup(popupContent, {
            className: "traffic-popup",
            closeButton: false,
          })

          group.addLayer(marker)
        }
      })
    })

    group.addTo(map)
    layerGroupRef.current = group

    return () => {
      if (group) group.remove()
    }
  }, [map, routes, trafficByRouteId, enabled, showEvents, opacity])

  return null
}
