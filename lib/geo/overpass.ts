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
export const OVERPASS_ENDPOINTS = [
  // Российское зеркало: в нём есть данные по России и оно не делит очередь
  // с публичным overpass-api.de, который под нагрузкой отвечает 502
  // «at capacity» (проверено 30.10.2026 — АЗС вокруг Ярославля отдаёт).
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  // Полные (планетные) зеркала: у osm.ch данных по России нет — он ответит
  // «ок» и пустым списком, а водитель прочитает это как «вокруг пусто».
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
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

  // Две попытки по кругу: публичные зеркала отвечают 502 очередью, и один
  // проход часто упирается в «all query workers are busy».
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
        // Пустой ответ тоже кэшируем: «вокруг правда пусто» — такой же ответ,
        // и повторять его каждые 10 секунд незачем.
        writeCache(key, places)
        return { places, failed: false }
      } catch {
        // таймаут или сеть — следующее зеркало
      } finally {
        clearTimeout(timer)
      }
    }
  }

  return { places: [], failed: true }
}

/**
 * Проверка зеркал «как есть»: какое ответило, за сколько и сколько вернуло.
 *
 * Нужна, когда у водителя «ничего не нашлось», а данные на самом деле есть:
 * из разных сетей зеркала ведут себя по-разному, и гадать по одному флагу
 * `failed` бессмысленно.
 */
export async function probeNearbyMirrors(
  lat: number,
  lng: number,
  kind: NearbyKind = "fuel",
  radiusM = 7000,
): Promise<
  Array<{ endpoint: string; status: number | null; ms: number; elements: number; error?: string }>
> {
  const query = nearbyQuery(lat, lng, kind, radiusM, 3)
  const results: Array<{
    endpoint: string
    status: number | null
    ms: number
    elements: number
    error?: string
  }> = []

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "loginex-tms/1.0 (driver nearby)",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
        cache: "no-store",
      })
      const ms = Date.now() - started
      if (!response.ok) {
        results.push({ endpoint, status: response.status, ms, elements: 0 })
        continue
      }
      const data = await response.json()
      const elements = Array.isArray((data as { elements?: unknown[] })?.elements)
        ? ((data as { elements: unknown[] }).elements.length ?? 0)
        : 0
      results.push({ endpoint, status: response.status, ms, elements })
    } catch (error) {
      results.push({
        endpoint,
        status: null,
        ms: Date.now() - started,
        elements: 0,
        error: error instanceof Error ? error.name : "error",
      })
    } finally {
      clearTimeout(timer)
    }
  }

  return results
}
