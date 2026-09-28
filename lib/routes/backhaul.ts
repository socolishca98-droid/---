// lib/routes/backhaul.ts
//
// Порожний обратный пробег: рейс заканчивается не там, где база компании, —
// машина поедет назад пустой. Считаем город окончания рейса, оценочный
// порожний пробег до базы и подбираем попутные грузы «обратно к базе»
// из накопленной базы поисковых грузов.

import { haversineDistance } from "@/lib/eta/osrm-client"
import { normalizeCity } from "./optimizer"

/** Оценка дорожного пробега по прямой: трасса длиннее линии на ~20 %. */
export const ROAD_STRAIGHT_FACTOR = 1.2

/** Порог «далеко от базы»: ближе 30 км возврат не считаем порожним плечом. */
export const EMPTY_RETURN_THRESHOLD_KM = 30

export interface BackhaulOrderLike {
  routeTo?: string | null
  routeSequence?: number | null
}

export interface BackhaulLoad {
  id: string
  routeFrom: string
  routeTo: string
  distance: number | null
  weight: number | null
  price: number | null
  cargoType: string | null
}

/** Город последней точки рейса: максимальный порядок объезда. */
export function routeEndpointCity(orders: readonly BackhaulOrderLike[]): string {
  let best: BackhaulOrderLike | null = null
  for (const order of orders) {
    const seq = Number(order.routeSequence) || 0
    const bestSeq = best ? Number(best.routeSequence) || 0 : -1
    if (!best || seq >= bestSeq) best = order
  }
  return best ? normalizeCity(best.routeTo) : ""
}

/** Рейс заканчивается вдали от базы компании. */
export function isAwayFromBase(endpointCity: string, baseCity: string): boolean {
  return Boolean(endpointCity) && Boolean(baseCity) && endpointCity !== baseCity
}

/** Оценочный порожний пробег до базы по последней точке рейса, км. */
export function emptyReturnKm(
  lastPoint: { lat: number; lng: number } | null,
  base: { lat: number; lng: number } | null,
): number | null {
  if (!lastPoint || !base) return null
  // haversineDistance возвращает километры
  const straightKm = haversineDistance(
    { lat: lastPoint.lat, lng: lastPoint.lng },
    { lat: base.lat, lng: base.lng },
  )
  return Math.round(straightKm * ROAD_STRAIGHT_FACTOR)
}

/**
 * Попутные грузы на обратном плече: загрузка в городе окончания рейса,
 * выгрузка — в городе базы. Сортировка: дороже сначала, при равенстве —
 * короче пробег (выше маржа на километр).
 */
export function backhaulCandidates(
  endpointCity: string,
  baseCity: string,
  loads: readonly BackhaulLoad[],
): BackhaulLoad[] {
  if (!endpointCity || !baseCity) return []
  const matched = loads.filter((load) => {
    const from = normalizeCity(load.routeFrom)
    const to = normalizeCity(load.routeTo)
    return from === endpointCity && to === baseCity
  })
  return matched.sort((a, b) => {
    const priceDiff = (Number(b.price) || 0) - (Number(a.price) || 0)
    if (priceDiff !== 0) return priceDiff
    return (Number(a.distance) || 0) - (Number(b.distance) || 0)
  })
}

/** Стоит ли показывать предупреждение: далеко и есть смысл смотреть грузы. */
export function showBackhaulWarning(
  endpointCity: string,
  baseCity: string,
  km: number | null,
): boolean {
  if (!isAwayFromBase(endpointCity, baseCity)) return false
  if (km === null) return true
  return km >= EMPTY_RETURN_THRESHOLD_KM
}
