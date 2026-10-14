// lib/eta/segments.ts
//
// Разбиение маршрута OSRM на сегменты с классом дороги.
//
// Зачем сегменты: один коэффициент на весь маршрут не работает — машина может
// выехать утром через город в час пик, днём пойти по трассе, а к вечеру въехать
// в другой город. Поэтому маршрут режется на шаги OSRM, каждый получает свой
// класс дороги, свою базовую скорость и свои поправки на момент ПРОХОЖДЕНИЯ.
//
// Бесплатный OSRM отдаёт шаги без класса дороги — классификация в road-class.ts.

import { classifyStep, segmentBaseSpeedKmh, type RoadClassProfile, type StepLike } from "./road-class"
import type { Coordinates } from "./types"

export interface SegmentInput {
  from: Coordinates
  to: Coordinates
  distanceM: number
  /** Базовое время OSRM по шагу, сек */
  baseDurationSec: number
  roadName?: string
  maneuver?: { type?: string; modifier?: string }
  intersections?: number
}

export interface RouteSegment {
  index: number
  from: Coordinates
  to: Coordinates
  distanceM: number
  baseDurationSec: number
  roadClass: RoadClassProfile
  /** Базовая скорость сегмента, км/ч */
  baseSpeedKmh: number
  /** Откуда взялась скорость: таблица классов или фактическая OSRM */
  speedSource: "table" | "osrm"
  /** Фактическая скорость OSRM по шагу, км/ч (свободный поток) */
  osrmSpeedKmh: number
  /** Время при базовой скорости — ориентир «свободного потока» */
  freeFlowSec: number
  roadName?: string
}

/** Собирает сегменты из ответа OSRM. */
export function buildSegmentsFromSteps(
  steps: readonly StepLike[],
  geometryPoints: readonly Coordinates[],
): RouteSegment[] {
  const segments: RouteSegment[] = []

  // OSRM отдаёт шаги без координат начала/конца — берём точки геометрии
  // пропорционально накопленной длине, чтобы у сегмента были реальные края.
  const totalDistance = steps.reduce((sum, step) => sum + Math.max(0, step.distance), 0)
  let cursor = 0
  let pointCursor = 0

  const pointAt = (fraction: number): Coordinates => {
    if (geometryPoints.length === 0) return { lat: 0, lng: 0 }
    if (geometryPoints.length === 1) return geometryPoints[0]
    const exact = fraction * (geometryPoints.length - 1)
    const index = Math.min(geometryPoints.length - 1, Math.max(0, Math.round(exact)))
    return geometryPoints[index] ?? geometryPoints[0]
  }

  for (const step of steps) {
    const distanceM = Math.max(0, step.distance)
    if (distanceM === 0) continue

    const profile = classifyStep(step)
    const osrmSpeedKmh = step.duration > 0 ? (distanceM / step.duration) * 3.6 : 0
    const { speedKmh, source } = segmentBaseSpeedKmh(profile, osrmSpeedKmh)

    const startFraction = totalDistance > 0 ? cursor / totalDistance : 0
    cursor += distanceM
    const endFraction = totalDistance > 0 ? cursor / totalDistance : 1

    const from = pointAt(startFraction)
    const to = pointAt(endFraction)

    void pointCursor
    pointCursor = geometryPoints.length

    segments.push({
      index: segments.length,
      from,
      to,
      distanceM,
      baseDurationSec: Math.max(0, step.duration),
      roadClass: profile,
      baseSpeedKmh: speedKmh,
      speedSource: source,
      osrmSpeedKmh: Math.round(osrmSpeedKmh * 10) / 10,
      freeFlowSec: speedKmh > 0 ? Math.round((distanceM / 1000 / speedKmh) * 3600) : 0,
      roadName: step.name,
    })
  }

  // Сегменты короче 300 м несут класс дороги с низкой уверенностью и только
  // зашумляют объяснение — склеиваем с предыдущим, сохраняя сумму расстояния.
  return mergeShortSegments(segments, 300)
}

/** Склеивает слишком короткие сегменты с предыдущим. */
export function mergeShortSegments(segments: readonly RouteSegment[], minDistanceM: number): RouteSegment[] {
  if (segments.length <= 1) return [...segments]

  const merged: RouteSegment[] = []

  for (const segment of segments) {
    const previous = merged[merged.length - 1]
    if (previous && segment.distanceM < minDistanceM) {
      previous.distanceM += segment.distanceM
      previous.baseDurationSec += segment.baseDurationSec
      previous.to = segment.to
      previous.freeFlowSec = previous.baseSpeedKmh > 0
        ? Math.round((previous.distanceM / 1000 / previous.baseSpeedKmh) * 3600)
        : 0
      // Класс оставляем у более длинного куска: у него уверенность выше
      if (segment.roadClass.confidence > previous.roadClass.confidence) {
        previous.roadClass = segment.roadClass
        previous.baseSpeedKmh = segment.baseSpeedKmh
        previous.speedSource = segment.speedSource
      }
      continue
    }
    merged.push({ ...segment })
  }

  return merged.map((segment, index) => ({ ...segment, index }))
}

/** Точка на середине сегмента — для запроса погоды. */
export function segmentMidpoint(segment: RouteSegment): Coordinates {
  return {
    lat: (segment.from.lat + segment.to.lat) / 2,
    lng: (segment.from.lng + segment.to.lng) / 2,
  }
}

/** Декодирование polyline OSRM (формат precision 5) в точки. */
export function decodePolyline(encoded: string): Coordinates[] {
  const points: Coordinates[] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < encoded.length) {
    let shift = 0
    let result = 0
    let byte: number

    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0
    result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }

  return points
}
