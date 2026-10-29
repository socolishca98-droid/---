// lib/geo/nearby.ts
//
// «Что рядом» для водителя — разбор ответа OpenStreetMap/Overpass.
//
// Вынесено из lib/geo/overpass.ts отдельным чистым модулем, чтобы это можно
// было проверить тестами без сети: водитель на трассе видит либо точки, либо
// ЧЕСТНУЮ причину, почему их нет. Раньше любая ошибка сети возвращала пустой
// список, и экран говорил «в радиусе 7 км ничего не нашлось» — водитель
// крутил категории и не понимал, что связи нет.

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

/** Почему точек нет: сервис недоступен, пусто вокруг или поиск не начинался. */
export type NearbyProblem = "network" | "empty" | "no-position"

export interface NearbyResult {
  places: NearbyPlace[]
  /** null — точки есть или их правда нет; иначе причина, которую показываем */
  problem: NearbyProblem | null
  /** Готовая фраза для экрана — чтобы водитель не гадал */
  message: string | null
}

export const KIND_FILTERS: Record<NearbyKind, string> = {
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

/** Строка запроса Overpass для категории и радиуса. */
export function nearbyQuery(
  lat: number,
  lng: number,
  kind: NearbyKind,
  radiusM = 7000,
  limit = 12,
): string {
  const parts = KIND_FILTERS[kind]
    .split(";")
    .map((selector) => `${selector}(around:${radiusM},${lat},${lng});`)
    .join("")
  return `[out:json][timeout:12];(${parts});out tags ${limit * 3};`
}

/** Расстояние по прямой, км — чтобы модуль не тянул за собой клиент OSRM. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Ответ Overpass → точки рядом с водителем.
 *
 * `raw` — уже разобранный JSON. Мусорные элементы пропускаем: одна битая
 * запись не должна прятать весь список.
 */
export function parseNearby(
  raw: unknown,
  center: { lat: number; lng: number },
  limit = 12,
): NearbyPlace[] {
  const elements: any[] = Array.isArray((raw as any)?.elements) ? (raw as any).elements : []
  const places: NearbyPlace[] = []
  for (const element of elements) {
    const lat = Number(element?.lat)
    const lng = Number(element?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const tags = (element?.tags ?? {}) as Record<string, string>
    const { kind, tag } = kindOf(tags)
    places.push({
      name: tags.name || tags.operator || tag,
      lat,
      lng,
      distanceM: Math.round(distanceKm(center, { lat, lng }) * 1000),
      kind,
      tag,
    })
  }
  places.sort((a, b) => a.distanceM - b.distanceM)
  return places.slice(0, limit)
}

/**
 * Итог для экрана: точки или честная причина, почему их нет.
 *
 * Разница между «сервис недоступен» и «вокруг пусто» — не придирка: в первом
 * случае водителю нужно обновить список или подождать связи, во втором — ехать
 * дальше. Раньше оба случая выглядели одинаково.
 */
export function nearbyOutcome(
  places: NearbyPlace[],
  radiusKm: number,
  failed = false,
): NearbyResult {
  if (failed) {
    return {
      places: [],
      problem: "network",
      message:
        "Не удалось получить данные карты: нет связи или сервис OpenStreetMap недоступен. Нажмите «Обновить список».",
    }
  }
  if (places.length === 0) {
    return {
      places: [],
      problem: "empty",
      message: `В радиусе ${radiusKm} км ничего не нашлось. Попробуйте другую категорию или подъедьте ближе к трассе.`,
    }
  }
  return { places, problem: null, message: null }
}

/** «1,2 км» / «800 м» — коротко для списка на телефоне. */
export function formatMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—"
  if (meters < 1000) return `${Math.round(meters)} м`
  return `${(meters / 1000).toFixed(1).replace(".", ",")} км`
}
