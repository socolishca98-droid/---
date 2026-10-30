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
  // Порядок — по результату живой проверки с прода (30.10.2026):
  // openstreetmap.fr отвечает 200 за 0,4 с и отдаёт полные данные;
  // maps.mail.ru, kumi и private.coffee тонут в таймауте, overpass-api.de
  // отдаёт 502 «at capacity», а osm.ch отвечает «ок», но данных по России
  // у него нет — пустой список водитель прочитает как «вокруг пусто».
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
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

  // Ответ «ок, но пусто» от зеркала с неполными данными (osm.ch) — не повод
  // остановиться: настоящий ответ может быть у следующего. Останавливаемся на
  // первом непустом списке, а «правда пусто» говорим только если все зеркала
  // ответили и все пусты.
  let answeredEmpty = false

  // Общий бюджет на весь перебор: водитель не должен ждать чужой сервис
  // дольше 15 секунд. Первому зеркалу — 12 с (с холодным кэшем оно отвечает
  // за 8), остальным по 8 с, и как только бюджет вышел — заканчиваем.
  const deadline = Date.now() + 15_000
  let endpointIndex = 0

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const remaining = deadline - Date.now()
    if (remaining < 1500) break

    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(remaining, endpointIndex === 0 ? 12_000 : 8_000),
    )
    endpointIndex += 1

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
      if (places.length > 0) {
        writeCache(key, places)
        return { places, failed: false }
      }
      answeredEmpty = true
    } catch {
      // таймаут или сеть — следующее зеркало
    } finally {
      clearTimeout(timer)
    }
  }

  // Все зеркала ответили и все пусты — так и говорим, и запоминаем на 10 минут
  if (answeredEmpty) {
    writeCache(key, [])
    return { places: [], failed: false }
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
