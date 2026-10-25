// lib/ati/search-geo.ts
// Гео-фильтр живого поиска грузов: «в радиусе N км от города».
//
// Зачем отдельным чистым модулем: сайт ATI ищет грузы радиусом от города
// («Тюмень → Ярославль, радиус 300 км»), а наш ручной поиск сравнивал только
// точное совпадение названий. Для логиста из Ярославля это означало ноль
// грузов: груз, выгружающийся в Корюково (8 км от Ярославля), не находится
// запросом «Ярославль», потому что город в грузе называется иначе.
//
// Модуль намеренно чистый (без Prisma, без сети) — правила одинаково нужны
// серверу (lib/ati-client.ts, manualSearch) и тестам.

export type Point = { lat: number; lng: number }

/** Что мы знаем о городе запроса: ключ названия и, если удалось, центр. */
export type GeoQuery = {
  /** Ключ названия (makeCityKey) или null — фильтр по этой стороне выключен. */
  cityKey: string | null
  /** Координаты центра города — для радиусного поиска. */
  center: Point | null
  /** Радиус в км; 0 — радиус не задан. */
  radiusKm: number
}

/** Как груз попал в выдачу — чтобы интерфейс не врал о причине. */
export type GeoMatchReason = "city" | "radius" | null

/**
 * Ключ города для сравнения: первая часть до запятой, нижний регистр,
 * без служебных сокращений («г.», «д.», «с.»). Те же правила, что в
 * makeCityKey (lib/ati-client.ts): «Вязники г., Владимирская область» и
 * «Вязники» должны совпасть, иначе груз не находится по названию.
 */
export function normalizeCityKey(route: string | null | undefined): string | null {
  if (!route) return null
  const trimmed = route.trim()
  if (!trimmed) return null

  let first = trimmed.split(",")[0].trim().toLowerCase()
  first = first
    .replace(/\s+г\.\s*$/i, "")
    .replace(/\s+г\s*$/i, "")
    .replace(/\s+д\.\s*$/i, "")
    .replace(/\s+пос\.\s*$/i, "")
    .replace(/\s+п\.\s*$/i, "")
    .replace(/\s+с\.\s*$/i, "")
    .replace(/\s+х\.\s*$/i, "")
    .trim()

  return first || null
}

/** Расстояние по большой окружности, км. */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Корректная ли это точка (в грузах ATI 0/0 значит «неизвестно»). */
export function isUsablePoint(point: unknown): point is Point {
  if (!point || typeof point !== "object") return false
  const { lat, lng } = point as Point
  if (typeof lat !== "number" || typeof lng !== "number") return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat === 0 && lng === 0) return false
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

/**
 * Проходит ли груз по одной стороне (погрузка или выгрузка).
 *
 * Правило, как на сайте ATI:
 *   1. точное совпадение города — груз подходит всегда;
 *   2. иначе, если задан радиус и известны обе точки (центр запроса и точка
 *      груза) — подходит, если расстояние не больше радиуса;
 *   3. иначе груз не подходит: молча выбрасывать нельзя, иначе логист
 *      получает «ничего не найдено» там, где грузы есть.
 */
export function matchesGeoQuery(
  query: GeoQuery,
  cityKey: string | null,
  point: Point | null,
): GeoMatchReason {
  const wanted = normalizeCityKey(query.cityKey)
  if (!wanted) return null
  const got = normalizeCityKey(cityKey)
  if (got && wanted === got) return "city"
  if (
    query.radiusKm > 0 &&
    query.center &&
    isUsablePoint(point) &&
    haversineKm(query.center, point) <= query.radiusKm
  ) {
    return "radius"
  }
  return null
}

/** Пустой запрос: фильтр выключен. */
export function emptyGeoQuery(): GeoQuery {
  return { cityKey: null, center: null, radiusKm: 0 }
}

/**
 * Отбор груза по двум сторонам. Обе стороны необязательны: логист может
 * искать только «откуда» или только «куда» — как на бирже.
 */
export function loadMatchesGeo(
  load: {
    loading?: { location?: { city?: string | null; region?: string | null }; point?: Point | null }
    unloading?: { location?: { city?: string | null; region?: string | null }; point?: Point | null }
  },
  from: GeoQuery,
  to: GeoQuery,
): { ok: boolean; fromReason: GeoMatchReason; toReason: GeoMatchReason } {
  const fromReason = matchesGeoQuery(
    from,
    sideCityKey(load.loading),
    load.loading?.point ?? null,
  )
  if (from.cityKey && !fromReason) {
    return { ok: false, fromReason, toReason: null }
  }
  const toReason = matchesGeoQuery(
    to,
    sideCityKey(load.unloading),
    load.unloading?.point ?? null,
  )
  if (to.cityKey && !toReason) {
    return { ok: false, fromReason, toReason }
  }
  return { ok: true, fromReason, toReason }
}

/** Ключ названия города стороны груза — уже нормализованный. */
export function sideCityKey(side?: {
  location?: { city?: string | null; region?: string | null }
}): string | null {
  const city = side?.location?.city
  if (!city) return null
  const region = side?.location?.region ?? ""
  return normalizeCityKey(region ? `${city}, ${region}` : city)
}
