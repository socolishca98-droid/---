// lib/traffic/fleet-summary.ts
//
// Сводка дорожной обстановки по рейсам флота.
//
// Почему это отдельный модуль, а не кусок компонента карты:
//  — считается строго по данным, которые вернул сервис пробок
//    (/api/traffic/batch → lib/traffic/service.ts). Если данных нет — сводка
//    честно говорит «нет данных», а не придумывает заторы и ДТП;
//  — чистая функция без React и Leaflet: её покрывают тесты
//    (__tests__/traffic/fleet-summary.test.ts);
//  — один источник правды для слоя на карте и для панелей дашборда.

import type { LatLng, TrafficRouteInfo, TrafficSegment } from "./types"

export type FleetTrafficStatus = "unknown" | "normal" | "warning" | "critical"

export type FleetTrafficArterial = {
  id: string
  name: string
  coordinates: LatLng[]
  speed: number
  delayMinutes: number
  severity: "low" | "medium" | "heavy" | "critical"
  status: string
}

export type FleetTrafficIncident = {
  id: string
  title: string
  description: string
  location: LatLng
  type: "accident" | "roadwork" | "warning"
  delayMinutes: number
  lane?: string
  driverName?: string
  vehiclePlate?: string
  roadName?: string
}

export type FleetTrafficSummary = {
  status: FleetTrafficStatus
  statusLabel: string
  /** Есть ли вообще данные о пробках хотя бы по одному рейсу */
  hasData: boolean
  /** Данные сгенерированы демо-провайдером (TRAFFIC_PROVIDER=mock) */
  mock: boolean
  riskScore: number
  totalDelayMinutes: number
  delayedRoutesCount: number
  totalRoutesCount: number
  accidentsCount: number
  closuresCount: number
  jamsCount: number
  /** Уровень 1–10 — для совместимости со старым индикатором на карте */
  level: number
  title: string
  description: string
  color: "green" | "yellow" | "red" | "darkred" | "gray"
  updatedAt: string
  recommendation?: string
  arterials: FleetTrafficArterial[]
  incidents: FleetTrafficIncident[]
}

export type FleetRouteInput = {
  id: string
  driverName?: string
  vehiclePlate?: string
  routeFrom?: string
  routeTo?: string
  coordinates?: LatLng[]
}

/** Порог, с которого затор считается значимым для логиста. */
export const CONGESTION_SEVERITY = 0.65

const SEVERITY_THRESHOLD_CRITICAL = 0.85

/** Оценка скорости потока по тяжести участка — для подписи в панели. */
export function speedBySeverity(severity: number): number {
  if (severity >= SEVERITY_THRESHOLD_CRITICAL) return 12
  if (severity >= CONGESTION_SEVERITY) return 22
  if (severity >= 0.4) return 45
  return 70
}

function severityLabel(severity: number): "low" | "medium" | "heavy" | "critical" {
  if (severity >= SEVERITY_THRESHOLD_CRITICAL) return "critical"
  if (severity >= CONGESTION_SEVERITY) return "heavy"
  if (severity >= 0.4) return "medium"
  return "low"
}

function isSignificant(segment: TrafficSegment): boolean {
  if (segment.type === "accident" || segment.type === "closure") return true
  return (segment.severity ?? 0) >= CONGESTION_SEVERITY
}

function isValidLatLng(value: unknown): value is LatLng {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0] as number) <= 90 &&
    Math.abs(value[1] as number) <= 180
  )
}

function emptySummary(totalRoutesCount: number, updatedAt: string): FleetTrafficSummary {
  return {
    status: "unknown",
    statusLabel: "Нет данных",
    hasData: false,
    mock: false,
    riskScore: 0,
    totalDelayMinutes: 0,
    delayedRoutesCount: 0,
    totalRoutesCount,
    accidentsCount: 0,
    closuresCount: 0,
    jamsCount: 0,
    level: 0,
    title: "Дорожная обстановка неизвестна",
    description:
      totalRoutesCount === 0
        ? "Активных рейсов нет — сравнивать не с чем."
        : "Сервис пробок не вернул данные по активным рейсам.",
    color: "gray",
    updatedAt,
    recommendation:
      "Проверьте подключение сервиса пробок (TRAFFIC_PROVIDER) и обновите данные карты.",
    arterials: [],
    incidents: [],
  }
}

/**
 * Сводка по всем рейсам флота.
 *
 * @param routes              активные рейсы с геометрией
 * @param trafficByRouteId    данные сервиса пробок по id рейса
 * @param congestionsOnly     считать только значимые заторы (severity ≥ 0.65) и инциденты
 */
export function summarizeFleetTraffic(params: {
  routes: readonly FleetRouteInput[]
  trafficByRouteId?: Record<string, TrafficRouteInfo>
  congestionsOnly?: boolean
  now?: Date
}): FleetTrafficSummary {
  const { routes, trafficByRouteId, congestionsOnly = false, now = new Date() } = params
  const updatedAt = now.toISOString()
  const list = Array.isArray(routes) ? routes : []

  const routesWithData = list.filter((route) => {
    const info = route?.id ? trafficByRouteId?.[route.id] : undefined
    return Boolean(info && Array.isArray(info.segments) && info.segments.length > 0)
  })

  if (routesWithData.length === 0) return emptySummary(list.length, updatedAt)

  let totalDelay = 0
  let accidentsCount = 0
  let closuresCount = 0
  let jamsCount = 0
  let mock = false
  const delayedRouteIds = new Set<string>()
  const arterials: FleetTrafficArterial[] = []
  const incidents: FleetTrafficIncident[] = []

  for (const route of routesWithData) {
    const info = trafficByRouteId?.[route.id]
    if (!info) continue
    if (info.mock === true) mock = true

    const coordinates = Array.isArray(route.coordinates) ? route.coordinates.filter(isValidLatLng) : []
    const totalPoints = coordinates.length
    let routeHasDelay = false

    info.segments.forEach((segment, index) => {
      const significant = isSignificant(segment)
      if (congestionsOnly && !significant) return

      const severity = Math.max(0, Math.min(1, segment.severity ?? 0))
      const delay = Math.max(0, Math.round(segment.delayMin ?? 0))

      if (significant) {
        totalDelay += delay
        routeHasDelay = true
        if (segment.type === "accident") accidentsCount += 1
        else if (segment.type === "closure") closuresCount += 1
        else jamsCount += 1
      }

      if (totalPoints < 2) return

      const startIdx = Math.max(0, Math.min(totalPoints - 1, Math.floor((segment.startT ?? 0) * (totalPoints - 1))))
      const endIdx = Math.max(
        startIdx + 1,
        Math.min(totalPoints - 1, Math.ceil((segment.endT ?? 0) * (totalPoints - 1))),
      )
      const slice = coordinates.slice(startIdx, endIdx + 1)
      if (slice.length < 2) return

      const roadName =
        segment.roadName || (route.routeTo ? `Трасса на ${route.routeTo}` : "Участок трассы")
      const driverLabel = route.driverName ? `${route.driverName} (${roadName})` : roadName

      if (significant) {
        arterials.push({
          id: `traffic-${route.id}-${index}`,
          name: driverLabel,
          coordinates: slice,
          speed: speedBySeverity(severity),
          delayMinutes: delay,
          severity: severityLabel(severity),
          status: segment.description || "Затруднённое движение",
        })
      }

      if (segment.type === "accident" || segment.type === "closure") {
        const middle = slice[Math.floor(slice.length / 2)] ?? slice[0]
        incidents.push({
          id: `incident-${route.id}-${index}`,
          title: segment.type === "accident" ? "💥 ДТП на маршруте" : "⛔ Перекрытие дороги",
          description: `${segment.description || "Ограничение движения"} • Водитель: ${
            route.driverName || "не назначен"
          } (${route.vehiclePlate || "рейс"})`,
          location: middle,
          type: segment.type === "accident" ? "accident" : "roadwork",
          delayMinutes: delay,
          lane: segment.type === "accident" ? "Правый ряд" : "Все полосы",
          driverName: route.driverName,
          vehiclePlate: route.vehiclePlate,
          roadName,
        })
      }
    })

    if (routeHasDelay) delayedRouteIds.add(route.id)
  }

  const totalRoutesCount = routesWithData.length
  const delayedRoutesCount = delayedRouteIds.size
  const avgDelay = totalRoutesCount > 0 ? Math.round(totalDelay / totalRoutesCount) : 0

  let riskScore = 0
  if (totalRoutesCount > 0) {
    const ratio = delayedRoutesCount / totalRoutesCount
    riskScore = Math.min(
      100,
      Math.round(ratio * 50 + accidentsCount * 15 + closuresCount * 20 + avgDelay * 1.2),
    )
  }

  const isCritical = riskScore >= 55 || accidentsCount > 0 || closuresCount > 0 || totalDelay >= 45
  const isWarning = !isCritical && (riskScore >= 20 || delayedRoutesCount > 0 || totalDelay >= 15)

  const status: FleetTrafficStatus = isCritical ? "critical" : isWarning ? "warning" : "normal"
  const statusLabel = isCritical
    ? `Критично (+${totalDelay} мин)`
    : isWarning
    ? `Задержки (+${totalDelay} мин)`
    : "В графике"

  const mockNote = mock ? " Данные демо-провайдера: это модель обстановки, а не измерение." : ""

  return {
    status,
    statusLabel,
    hasData: true,
    mock,
    riskScore,
    totalDelayMinutes: totalDelay,
    delayedRoutesCount,
    totalRoutesCount,
    accidentsCount,
    closuresCount,
    jamsCount,
    level: isCritical ? 8 : isWarning ? 5 : 2,
    title: isCritical
      ? "Высокий дорожный риск на маршрутах"
      : isWarning
      ? "Локальные задержки на трассах"
      : "Рейсы следуют в графике",
    description: isCritical
      ? `Зафиксировано ${accidentsCount > 0 ? `${accidentsCount} ДТП, ` : ""}${
          closuresCount > 0 ? `${closuresCount} перекрытий, ` : ""
        }задержка +${totalDelay} мин на ${delayedRoutesCount} рейсах.${mockNote}`
      : isWarning
      ? `Затруднения на ${delayedRoutesCount} рейсах (суммарно +${totalDelay} мин).${mockNote}`
      : `На маршрутах флота значимых заторов нет.${mockNote}`,
    color: isCritical ? "red" : isWarning ? "yellow" : "green",
    updatedAt,
    recommendation: isCritical
      ? "Скорректируйте окно выгрузки у клиента или запросите объезд у водителя."
      : isWarning
      ? "Движение под контролем: риск срыва окна доставки низкий."
      : "График соблюдается без отклонений.",
    arterials,
    incidents,
  }
}
