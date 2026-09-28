// lib/geo/overpass.ts
//
// «Что рядом» для водителя: заправки, зоны отдыха и отели вокруг точки.
// Данные — OpenStreetMap через Overpass API, запрос идёт из браузера
// водителя (серверу песочницы внешние сети не нужны). Без ключей и платных
// сервисов: те же данные, что видит навигатор.

import { haversineDistance } from "@/lib/eta/osrm-client"

export type NearbyKind = "fuel" | "rest" | "hotel"

export interface NearbyPlace {
  name: string
  lat: number
  lng: number
  distanceM: number
  kind: NearbyKind
  /** Подпись категории человеком */
  tag: string
}

const KIND_FILTERS: Record<NearbyKind, string> = {
  fuel: "node[amenity=fuel]",
  rest: "node[highway=services];node[amenity=parking]",
  hotel: "node[tourism=hotel];node[tourism=motel];node[tourism=guest_house]",
}

export const KIND_LABELS: Record<NearbyKind, string> = {
  fuel: "АЗС",
  rest: "Зона отдыха",
  hotel: "Отель",
}

function kindOf(tags: Record<string, string>): { kind: NearbyKind; tag: string } {
  if (tags.amenity === "fuel") return { kind: "fuel", tag: KIND_LABELS.fuel }
  if (tags.highway === "services") return { kind: "rest", tag: "Трассовый сервис" }
  if (tags.amenity === "parking") return { kind: "rest", tag: "Парковка для отдыха" }
  if (tags.tourism === "motel") return { kind: "hotel", tag: "Мотель" }
  if (tags.tourism === "guest_house") return { kind: "hotel", tag: "Гостевой дом" }
  return { kind: "hotel", tag: KIND_LABELS.hotel }
}

/**
 * Поиск точек вокруг координат. Ошибки сети возвращаем пустым списком:
 * водитель увидит подсказку, что сервис недоступен, а не падение экрана.
 */
export async function searchNearby(
  lat: number,
  lng: number,
  kind: NearbyKind,
  radiusM = 7000,
  limit = 12,
): Promise<NearbyPlace[]> {
  const filter = KIND_FILTERS[kind]
  const parts = filter
    .split(";")
    .map((selector) => `${selector}(around:${radiusM},${lat},${lng});`)
    .join("")
  const query = `[out:json][timeout:12];(${parts});out tags ${limit * 3};`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) return []
    const data = await response.json()
    const elements: any[] = Array.isArray(data?.elements) ? data.elements : []

    const places: NearbyPlace[] = []
    for (const element of elements) {
      const elLat = Number(element?.lat)
      const elLng = Number(element?.lon)
      if (!Number.isFinite(elLat) || !Number.isFinite(elLng)) continue
      const tags = (element?.tags ?? {}) as Record<string, string>
      const { kind: placeKind, tag } = kindOf(tags)
      places.push({
        name: tags.name || tags.operator || tag,
        lat: elLat,
        lng: elLng,
        distanceM: haversineDistance({ lat, lng }, { lat: elLat, lng: elLng }),
        kind: placeKind,
        tag,
      })
    }
    places.sort((a, b) => a.distanceM - b.distanceM)
    return places.slice(0, limit)
  } catch {
    return []
  }
}

/** «1,2 км» / «800 м» — коротко для списка на телефоне. */
export function formatMeters(meters: number): string {
  if (!Number.isFinite(meters)) return "—"
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`
  return `${(meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км`
}
