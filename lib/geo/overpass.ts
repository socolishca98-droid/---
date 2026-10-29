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
 * Поиск точек вокруг координат — на сервере.
 *
 * Браузер водителя напрямую к Overpass не ходит: публичный сервис не отдаёт
 * CORS-заголовки, и запрос падал ещё до ответа. Здесь ошибка не прячется:
 * `failed` !== null означает «сервис не ответил», `places` пуст при
 * `failed === null` — «вокруг правда пусто».
 */
export async function searchNearby(
  lat: number,
  lng: number,
  kind: NearbyKind,
  radiusM = 7000,
  limit = 12,
): Promise<{ places: NearbyPlace[]; failed: boolean }> {
  const query = nearbyQuery(lat, lng, kind, radiusM, limit)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const response = await fetch("https://overpass-api.de/api/interpreter", {
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
    clearTimeout(timer)
    if (!response.ok) return { places: [], failed: true }
    const data = await response.json()
    return { places: parseNearby(data, { lat, lng }, limit), failed: false }
  } catch {
    return { places: [], failed: true }
  }
}
