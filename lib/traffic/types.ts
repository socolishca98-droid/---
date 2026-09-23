// lib/traffic/types.ts

export type LatLng = [number, number]

// Сегмент задаём в долях длины маршрута (0..1), чтобы не зависеть от дискретизации polyline
export type TrafficIncidentType = "jam" | "accident" | "closure"

export type TrafficSegment = {
  startT: number // 0..1
  endT: number // 0..1
  severity: number // 0..1
  delayMin?: number
  type?: TrafficIncidentType // "jam" = сильная пробка, "accident" = ДТП, "closure" = перекрытие
  description?: string
  roadName?: string
}

export type TrafficRouteInfo = {
  provider: string
  generatedAt: string // ISO
  expiresAt: string // ISO
  segments: TrafficSegment[]
}

export type TrafficBatchResponse = {
  success: boolean
  trafficByRouteId?: Record<string, TrafficRouteInfo>
  error?: string
}
