// lib/geo/route-geometry.ts
//
// Геометрия нитки рейса для карты дашборда.
//
// Зачем отдельный модуль:
//  — дашборд опрашивает карту каждые 15 секунд, а дорога (OSRM) на один и тот
//    же набор точек за минуту не изменится. Без кэша каждый опрос уходил в сеть
//    и карта регулярно оставалась без линий (лимиты/таймауты публичного OSRM);
//  — кэш в памяти процесса с TTL 10 минут и ограничением размера, поэтому
//    долгоживущий сервер не растёт по памяти;
//  — одновременные запросы одних и тех же точек склеиваются (in-flight dedupe):
//    несколько рейсов с общим участком не дублируют запрос;
//  — если OSRM недоступен, возвращается плавная кривая по точкам с пометкой
//    source: "line" — карта честно рисует прямую, а не «пробку из ниоткуда».

import { decodePolyline, fetchOSRMRoute } from "@/lib/eta/osrm-client"
import type { Coordinates } from "@/lib/geo/geocode"

export type RouteGeometrySource = "osrm" | "line"

export type RouteGeometry = {
  coordinates: [number, number][]
  distanceKm: number
  durationMin: number
  source: RouteGeometrySource
}

const CACHE_TTL_MS = 10 * 60_000
const MAX_CACHE_ENTRIES = 300
/** Точность квантования ключа: 3 знака ≈ 110 м — достаточно, чтобы не плодить ключи. */
const KEY_PRECISION = 3

type CacheEntry = { value: RouteGeometry; expiresAt: number }

// Кэш один на процесс: в dev Next перезагружает модули, поэтому вешаем на globalThis
declare global {
  // eslint-disable-next-line no-var
  var __tmsRouteGeometryCacheV1: Map<string, CacheEntry> | undefined
  // eslint-disable-next-line no-var
  var __tmsRouteGeometryInflightV1: Map<string, Promise<RouteGeometry>> | undefined
}

function cache(): Map<string, CacheEntry> {
  if (!globalThis.__tmsRouteGeometryCacheV1) {
    globalThis.__tmsRouteGeometryCacheV1 = new Map<string, CacheEntry>()
  }
  return globalThis.__tmsRouteGeometryCacheV1
}

function inflight(): Map<string, Promise<RouteGeometry>> {
  if (!globalThis.__tmsRouteGeometryInflightV1) {
    globalThis.__tmsRouteGeometryInflightV1 = new Map<string, Promise<RouteGeometry>>()
  }
  return globalThis.__tmsRouteGeometryInflightV1
}

export function isValidCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false
  const { lat, lng } = value as Coordinates
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
}

/** Ключ кэша по набору точек (порядок важен: объезд «туда и обратно» — разные рейсы). */
export function routeGeometryKey(points: readonly Coordinates[]): string {
  return points
    .map((point) => `${point.lat.toFixed(KEY_PRECISION)},${point.lng.toFixed(KEY_PRECISION)}`)
    .join("|")
}

/**
 * Плавная кривая по точкам (квадратичная кривая Безье на каждом сегменте).
 * Используется, когда дорогу получить не удалось: нитка на карте остаётся,
 * но помечена как приблизительная.
 */
export function smoothCurve(points: readonly Coordinates[], segments = 24): [number, number][] {
  const result: [number, number][] = []
  if (points.length === 0) return result
  if (points.length === 1) return [[points[0].lat, points[0].lng]]

  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]
    const to = points[i + 1]
    const dx = to.lng - from.lng
    const dy = to.lat - from.lat
    const distance = Math.sqrt(dx * dx + dy * dy) || 0.001

    const offset = distance * 0.15
    const midLat = (from.lat + to.lat) / 2 + (dx / distance) * offset
    const midLng = (from.lng + to.lng) / 2 - (dy / distance) * offset

    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments
      const mt = 1 - t
      result.push([
        mt * mt * from.lat + 2 * mt * t * midLat + t * t * to.lat,
        mt * mt * from.lng + 2 * mt * t * midLng + t * t * to.lng,
      ])
    }
  }

  return result
}

/** Средняя путевая скорость гружёной машины по трассе, км/ч (для оценки без OSRM). */
const ESTIMATE_AVERAGE_SPEED_KMH = 55

/**
 * Оценка времени в пути, когда OSRM недоступен.
 *
 * Это НЕ измерение, а честная прикидка: средняя путевая скорость гружёной
 * машины по трассе с учётом населённых пунктов и остановок. Отдаём её вместе с
 * geometrySource: "line", чтобы интерфейс мог показать «≈», а не точные часы.
 */
export function estimateDurationMin(distanceKm: number, averageSpeedKmh = ESTIMATE_AVERAGE_SPEED_KMH): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0
  return Math.round((distanceKm / averageSpeedKmh) * 60)
}

function haversineKm(points: readonly Coordinates[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const dLat = ((b.lat - a.lat) * Math.PI) / 180
    const dLng = ((b.lng - a.lng) * Math.PI) / 180
    const lat1 = (a.lat * Math.PI) / 180
    const lat2 = (b.lat * Math.PI) / 180
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
    total += 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
  }
  return Math.round(total)
}

/**
 * Прямая между точками короче дороги: добавляем коэффициент извилистости,
 * чтобы оценка пробега не занижалась на треть.
 */
const ROAD_FACTOR = 1.25

function estimateDistanceKm(points: readonly Coordinates[]): number {
  return Math.round(haversineKm(points) * ROAD_FACTOR)
}

function pruneCache(): void {
  const store = cache()
  if (store.size <= MAX_CACHE_ENTRIES) return
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key)
  }
  // Если всё ещё много — выбрасываем самые старые записи
  if (store.size > MAX_CACHE_ENTRIES) {
    const excess = store.size - MAX_CACHE_ENTRIES
    const keys = [...store.keys()].slice(0, excess)
    for (const key of keys) store.delete(key)
  }
}

async function buildGeometry(points: readonly Coordinates[]): Promise<RouteGeometry> {
  if (points.length < 2) {
    return { coordinates: [], distanceKm: 0, durationMin: 0, source: "line" }
  }

  const fallbackDistanceKm = estimateDistanceKm(points)
  const fallback: RouteGeometry = {
    coordinates: smoothCurve(points),
    distanceKm: fallbackDistanceKm,
    durationMin: estimateDurationMin(fallbackDistanceKm),
    source: "line",
  }

  try {
    const [origin, destination] = [points[0], points[points.length - 1]]
    const middle = points.slice(1, -1)
    const response = await fetchOSRMRoute(origin, destination, middle, {
      overview: "full",
      geometries: "polyline",
    })
    const route = response.routes?.[0]
    if (!route) return fallback

    const coordinates = decodePolyline(route.geometry).map(
      (point) => [point.lat, point.lng] as [number, number],
    )
    if (coordinates.length < 2) return fallback

    return {
      coordinates,
      distanceKm: Math.round((route.distance ?? 0) / 1000),
      durationMin: Math.round((route.duration ?? 0) / 60),
      source: "osrm",
    }
  } catch {
    // OSRM публичный и лимитированный: карта не должна из-за этого пустеть
    return fallback
  }
}

/**
 * Геометрия рейса по точкам объезда (включая позицию водителя и базу).
 * Результат кэшируется; повторный вызов с теми же точками сети не делает.
 */
export async function getRouteGeometry(points: readonly Coordinates[]): Promise<RouteGeometry> {
  const valid = points.filter(isValidCoordinates)
  if (valid.length < 2) {
    return { coordinates: [], distanceKm: 0, durationMin: 0, source: "line" }
  }

  const key = routeGeometryKey(valid)
  const store = cache()
  const cached = store.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const pending = inflight()
  const existing = pending.get(key)
  if (existing) return existing

  const task = buildGeometry(valid)
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
      pruneCache()
      return value
    })
    .finally(() => {
      pending.delete(key)
    })

  pending.set(key, task)
  return task
}

/** Диагностика: сколько геометрий держим в памяти (используется в тестах). */
export function routeGeometryCacheStats(): { size: number } {
  return { size: cache().size }
}

/** Сброс кэша (тесты и принудительное обновление карты). */
export function clearRouteGeometryCache(): void {
  cache().clear()
  inflight().clear()
}
