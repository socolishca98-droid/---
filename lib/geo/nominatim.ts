// lib/geo/nominatim.ts
//
// Общий клиент геокодинга OpenStreetMap (Nominatim) для браузера.
// Используется помощником адреса в формах и поиском на карте.
// Запрос уходит из браузера пользователя напрямую: серверу песочницы
// внешние сети недоступны, а рабочему месту — доступны.

export interface GeoItem {
  /** Полное человекочитаемое название места */
  label: string
  /** Короткое название для списка подсказок */
  short: string
  lat: number
  lng: number
}

function toItems(rows: any[], limit: number): GeoItem[] {
  const items: GeoItem[] = []
  for (const row of rows) {
    const lat = Number.parseFloat(row?.lat)
    const lng = Number.parseFloat(row?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const label = String(row?.display_name || "").trim()
    if (!label) continue
    const parts = label.split(", ")
    items.push({
      label,
      short: parts.slice(0, 3).join(", "),
      lat,
      lng,
    })
    if (items.length >= limit) break
  }
  return items
}

/**
 * Поиск мест по строке адреса/названия. Ошибки сети не бросаем: помощник
 * просто не покажет подсказок, ввод вручную остаётся рабочим.
 */
export async function searchPlaces(query: string, limit = 5): Promise<GeoItem[]> {
  const q = query.trim()
  if (q.length < 3) return []
  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=json&limit=${limit}` +
      `&accept-language=ru&addressdetails=0&q=${encodeURIComponent(q)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(url, {
      headers: { "User-Agent": "LoginexTMS/1.0" },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) return []
    const data = await response.json()
    return Array.isArray(data) ? toItems(data, limit) : []
  } catch {
    return []
  }
}
