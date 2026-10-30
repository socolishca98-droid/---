// lib/geo/overpass.ts
//
// «Что рядом» для водителя: заправки, зоны отдыха и отели вокруг точки.
// Данные — OpenStreetMap через Overpass API. Запрос идёт с нашего сервера:
// публичный Overpass не отдаёт CORS-заголовки, и прямой запрос из браузера
// водителя падал ещё до ответа — экран при этом показывал «ничего не нашлось».
// Без ключей и платных сервисов: те же данные, что видит навигатор.

import {
  formatMeters,
  nearbyQuery,
  parseNearby,
  type NearbyKind,
  type NearbyPlace,
} from "./nearby"

export { formatMeters }
export type { NearbyKind, NearbyPlace }

/**
 * Зеркала Overpass. Публичный overpass-api.de регулярно отвечает 429/504 —
 * один адрес означал «нет связи» на ровном месте. Пробуем по очереди.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
]

/** Сколько держим ответ в памяти: экран «Рядом» открывают повторно. */
const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_LIMIT = 60

type CacheEntry = { places: NearbyPlace[]; at: number }

const globalForNearby = globalThis as unknown as {
  __nearbyCache?: Map<string, CacheEntry>
}
const cache = (globalForNearby.__nearbyCache ??= new Map<string, CacheEntry>())

/** Координаты в ключе — с точностью ~1 км: этого хватает для списка АЗС. */
function cacheKey(lat: number, lng: number, kind: NearbyKind, radiusM: number, limit: number) {
  return `${kind}:${lat.toFixed(2)}:${lng.toFixed(2)}:${radiusM}:${limit}`
}

function readCache(key: string): NearbyPlace[] | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.places
}

function writeCache(key: string, places: NearbyPlace[]) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { places, at: Date.now() })
}

/**
 * Поиск точек вокруг координат — на сервере.
 *
 * Браузер водителя напрямую к Overpass не ходит: публичный сервис не отдаёт
 * CORS-заголовки, и запрос падал ещё до ответа. Здесь ошибка не прячется:
 * `failed` !== null означает «сервис не ответил», `places` пуст при
 * `failed === null` — «вокруг правда пусто».
 *
 * Запросы идут по зеркалам, ответ на 10 минут живёт в памяти процесса:
 * водитель открывает «Рядом» по несколько раз за смену, и каждый раз ждать
 * чужой сервис незачем.
 */
export async function searchNearby(
  lat: number,
  lng: number,
  kind: NearbyKind,
  radiusM = 7000,
  limit = 12,
): Promise<{ places: NearbyPlace[]; failed: boolean }> {
  const key = cacheKey(lat, lng, kind, radiusM, limit)
  const cached = readCache(key)
  if (cached) return { places: cached, failed: false }

  const query = nearbyQuery(lat, lng, kind, radiusM, limit)

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass просит представляться: без User-Agent отвечает 429
          "User-Agent": "loginex-tms/1.0 (driver nearby)",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
        cache: "no-store",
      })

      // 429 (лимит) и 5xx — повод взять следующее зеркало, а не сдаваться
      if (!response.ok) continue

      const data = await response.json()
      const places = parseNearby(data, { lat, lng }, limit)
      writeCache(key, places)
      return { places, failed: false }
    } catch {
      // таймаут или сеть — следующее зеркало
    } finally {
      clearTimeout(timer)
    }
  }

  return { places: [], failed: true }
}
