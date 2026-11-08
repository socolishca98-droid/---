// lib/routing/geo/resolve.ts
//
// Определение точки по названию: точное → головной пункт → район → регион →
// «сырое» название. Каждому ответу присваивается СТАТУС: насколько ему можно
// верить. Догадка «нашёл регион» точкой не считается — именно так в кэш когда-то
// попал Шарапово из Тверской области вместо подмосковного (496 км вместо 51).
//
// Регион организации (`preferredRegion`) используется ТОЛЬКО как разрешение
// ничьей и всегда оставляет пометку.

import { cityKey, cityLookupKey, districtKey, regionLookupKey, splitSegments } from "./address"

export type PlaceStatus =
  | "reference-exact"
  | "reference-district"
  | "reference-head"
  | "reference-type"
  | "reference-region"
  | "reference-name"
  | "cache-verified"
  | "geocoder-unverified"
  | "no-coordinates"
  | "ambiguous"
  | "missing"

/** Статусы, которым можно доверять в расчёте. `reference-region` здесь нет. */
export const TRUSTED_STATUSES: PlaceStatus[] = [
  "reference-exact",
  "reference-district",
  "reference-head",
  "reference-type",
  "reference-name",
  "cache-verified",
]

export function isTrusted(status: PlaceStatus): boolean {
  return TRUSTED_STATUSES.includes(status)
}

/** Постоянная пометка для решений, принятых по региону организации. */
export const REGION_FROM_SETTINGS = "выбрано по региону организации"

export interface ReferenceRow {
  name: string
  region?: string | null
  lat?: number | null
  lon?: number | null
}

export interface ResolvedPoint {
  name: string
  region: string | null
  lat: number
  lon: number
}

export interface Resolution {
  point: ResolvedPoint | null
  status: PlaceStatus
  note: string | null
  candidates: number
}

interface Indexed extends ResolvedPoint {
  keyExact: string
  keyHead: string
  keyDistrict: string | null
  keyRegion: string
  keyRaw: string
}

export interface PlaceIndex {
  exact: Map<string, Indexed[]>
  head: Map<string, Indexed[]>
  raw: Map<string, Indexed[]>
  byRegion: Map<string, Indexed[]>
  size: number
}

/** Индекс справочника по всем ключам, которыми мы будем искать. */
export function buildPlaceIndex(rows: ReferenceRow[]): PlaceIndex {
  const exact = new Map<string, Indexed[]>()
  const head = new Map<string, Indexed[]>()
  const raw = new Map<string, Indexed[]>()
  const byRegion = new Map<string, Indexed[]>()
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    if (!key) return
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }

  for (const row of rows) {
    if (typeof row.lat !== "number" || typeof row.lon !== "number") continue
    if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue
    const headName = splitSegments(row.name)[0] ?? row.name
    const inside = row.name.match(/\(([^)]*)\)/)?.[1] ?? null
    const item: Indexed = {
      name: row.name,
      region: row.region?.trim() ? row.region.trim() : null,
      lat: row.lat,
      lon: row.lon,
      keyExact: cityLookupKey(row.name) + (inside ? `|${districtKey(inside)}` : ""),
      keyHead: cityLookupKey(headName),
      keyDistrict: inside ? districtKey(inside) : null,
      keyRegion: regionLookupKey(row.region),
      keyRaw: cityKey(row.name),
    }
    push(exact, item.keyExact, item)
    push(head, item.keyHead, item)
    push(raw, item.keyRaw, item)
    push(byRegion, item.keyRegion, item)
  }

  return { exact, head, raw, byRegion, size: rows.length }
}

/**
 * Города федерального значения: их регион в справочнике — сам город
 * («Москва (регион)» → ключ «москва»), а в адресах и на биржах к ним пишут
 * область («Москва, Московская область» → ключ «московская»). Без этой
 * пары город не находился ни в каком написании: у трёх деревень «Москва»
 * регионы другие, у города — «москва», и фильтр по «московская» был пуст,
 * хотя адрес явно указывал на город. Прилагательная форма — тот же пункт.
 */
const FEDERAL_CITY_REGION_ALIASES: Record<string, readonly string[]> = {
  // Формы — фактические ключи адреса: «область» в ключе сохраняется
  // (срез слов в regionLookupKey опирается на \b, который не работает
  // после кириллицы), поэтому перечислены обе записи — с «область» и без.
  москва: ["московская", "московская область", "московская обл"],
  "санкт-петербург": ["ленинградская", "ленинградская область", "ленинградская обл"],
}

/** Кандидат подходит под регион адреса? Федеральные города — с алиасами. */
function regionMatches(item: Indexed, regionKey: string): boolean {
  if (item.keyRegion === regionKey) return true
  const aliases = FEDERAL_CITY_REGION_ALIASES[item.keyRegion]
  return aliases !== undefined && aliases.includes(regionKey)
}

/**
 * Выбор одного варианта из нескольких.
 * Варианты в РАЗНЫХ регионах — неоднозначность, а не находка.
 */
function pick(
  list: Indexed[],
  parsed: { region: string | null; district: string | null },
  preferredRegion: string | null,
): { item: Indexed | null; note: string | null; ambiguous: number } {
  if (list.length === 0) return { item: null, note: null, ambiguous: 0 }
  if (list.length === 1) return { item: list[0], note: null, ambiguous: 0 }

  if (parsed.district) {
    const key = districtKey(parsed.district)
    const byDistrict = list.filter((item) => item.keyDistrict === key)
    if (byDistrict.length === 1) return { item: byDistrict[0], note: null, ambiguous: 0 }
    if (byDistrict.length > 1) list = byDistrict
  }

  if (parsed.region) {
    const key = regionLookupKey(parsed.region)
    const byRegion = list.filter((item) => regionMatches(item, key))
    if (byRegion.length === 1) return { item: byRegion[0], note: null, ambiguous: 0 }
    if (byRegion.length > 1) list = byRegion
  }

  if (preferredRegion) {
    const key = regionLookupKey(preferredRegion)
    const byPreferred = list.filter((item) => regionMatches(item, key))
    if (byPreferred.length === 1) {
      return { item: byPreferred[0], note: REGION_FROM_SETTINGS, ambiguous: 0 }
    }
    if (byPreferred.length > 1) {
      return { item: byPreferred[0], note: REGION_FROM_SETTINGS, ambiguous: byPreferred.length }
    }
  }

  const regions = new Set(list.map((item) => item.keyRegion))
  if (regions.size > 1) return { item: null, note: null, ambiguous: list.length }
  return { item: list[0], note: null, ambiguous: list.length }
}

/** Разрешение названия по справочнику — по лестнице от точного к слабому. */
export function resolvePlace(
  raw: string,
  parsed: { city: string | null; region: string | null; district: string | null; type: string },
  index: PlaceIndex,
  options: { preferredRegion?: string | null } = {},
): Resolution {
  const preferredRegion = options.preferredRegion ?? null
  const headName = cityLookupKey(parsed.city ?? raw)
  const inside = String(parsed.city ?? raw).match(/\(([^)]*)\)/)?.[1] ?? parsed.district ?? null
  const exactKey = headName + (inside ? `|${districtKey(inside)}` : "")

  const exactList = index.exact.get(exactKey) ?? []
  if (exactList.length === 1) {
    return { point: exactList[0], status: "reference-exact", note: null, candidates: 1 }
  }

  const headList = index.head.get(headName) ?? []
  if (headList.length > 0) {
    const chosen = pick(headList, { region: parsed.region, district: inside }, preferredRegion)
    if (chosen.item) {
      const status: PlaceStatus =
        chosen.ambiguous > 1
          ? "reference-head"
          : headList.length === 1
            ? "reference-head"
            : "reference-district"
      return { point: chosen.item, status, note: chosen.note, candidates: headList.length }
    }
    if (chosen.ambiguous > 1) {
      return {
        point: null,
        status: "ambiguous",
        note: `название «${parsed.city ?? raw}» есть в ${chosen.ambiguous} местах, регион не указан`,
        candidates: chosen.ambiguous,
      }
    }
  }

  const rawList = index.raw.get(cityKey(raw)) ?? []
  if (rawList.length > 0) {
    const chosen = pick(rawList, { region: parsed.region, district: inside }, preferredRegion)
    if (chosen.item) {
      return { point: chosen.item, status: "reference-name", note: chosen.note, candidates: rawList.length }
    }
  }

  // Только регион известен — это НЕ точка, а догадка: экран скажет «знаю регион,
  // но не пункт».
  const regionKey = regionLookupKey(parsed.region)
  if (regionKey) {
    const inRegion = index.byRegion.get(regionKey) ?? []
    if (inRegion.length > 0) {
      return {
        point: null,
        status: "reference-region",
        note: `пункт не найден, известен только регион «${parsed.region}»`,
        candidates: inRegion.length,
      }
    }
  }

  return { point: null, status: "missing", note: null, candidates: 0 }
}
