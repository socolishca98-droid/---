// lib/routing/geo/places.ts
//
// Точки для расчёта: справочник ATI → проверенный кэш → геокодер (по флагу).
//
// Правила:
//   · кэш участвует только со статусом `verified` — непроверенная запись в
//     маршрут не идёт;
//   · догадка «знаю регион, но не пункт» точкой не становится;
//   · геокодер вызывается ТОЛЬКО если вызывающий передал функцию, и не больше
//     `geocodeLimit` адресов за расчёт.

import { cityKey, parseAddress } from "./address"
import {
  buildPlaceIndex,
  isTrusted,
  resolvePlace,
  type PlaceIndex,
  type PlaceStatus,
  type ReferenceRow,
} from "./resolve"
import type { Place } from "../types"
import { CITY_TIMEZONES, timeZoneForRegion } from "../timezones"

export interface GeoSource {
  cities: (names: string[]) => Promise<ReferenceRow[]>
  cache: (
    addresses: string[],
  ) => Promise<Array<{ address: string; lat: number; lng: number; region: string | null; status: string | null }>>
}

export interface GeoOptions {
  geocode?: (names: string[]) => Promise<Map<string, { lat: number; lng: number }>>
  geocodeLimit?: number
  preferredRegion?: string | null
}

export interface GeoStats {
  total: number
  fromReference: number
  fromCache: number
  fromGeocoder: number
  ambiguous: number
  noCoordinates: number
  missing: number
}

export interface GeoResult {
  /** Точки по ключу cityKey(raw) — ровно те ключи, которыми пользуется адаптер */
  places: Map<string, Place>
  statuses: Map<string, { status: PlaceStatus; note: string | null }>
  unresolved: Array<{ raw: string; status: PlaceStatus; note: string | null }>
  stats: GeoStats
  geocoded: string[]
}

function toPlace(
  raw: string,
  point: { name?: string; region: string | null; lat: number; lon: number },
): Place {
  const parsed = parseAddress(raw)
  const city = parsed.city ?? point.name ?? raw
  const region = point.region?.trim() ? point.region.trim() : parsed.region
  return {
    id: cityKey(city),
    city: point.name && point.name.trim() ? point.name.trim() : city,
    region,
    point: { lat: point.lat, lng: point.lon },
    timeZone: timeZoneForRegion(region) ?? CITY_TIMEZONES[cityKey(city)] ?? null,
  }
}

const EMPTY_INDEX = (): PlaceIndex => ({
  exact: new Map(),
  head: new Map(),
  raw: new Map(),
  byRegion: new Map(),
  size: 0,
})

/** Точки для набора «сырых» названий — вместе с судьбой каждой строки. */
export async function loadPlaces(
  rawNames: string[],
  source: GeoSource,
  options: GeoOptions = {},
): Promise<GeoResult> {
  const raws = [...new Set(rawNames.map((name) => String(name ?? "").trim()).filter(Boolean))]
  const places = new Map<string, Place>()
  const statuses = new Map<string, { status: PlaceStatus; note: string | null }>()
  const unresolved: GeoResult["unresolved"] = []
  const stats: GeoStats = {
    total: raws.length,
    fromReference: 0,
    fromCache: 0,
    fromGeocoder: 0,
    ambiguous: 0,
    noCoordinates: 0,
    missing: 0,
  }
  const geocoded: string[] = []
  if (raws.length === 0) return { places, statuses, unresolved, stats, geocoded }

  const preferredRegion = options.preferredRegion ?? null

  let index: PlaceIndex = EMPTY_INDEX()
  try {
    index = buildPlaceIndex(await source.cities(raws))
  } catch {
    index = EMPTY_INDEX()
  }

  const pending: string[] = []
  for (const raw of raws) {
    const parsed = parseAddress(raw)
    const resolved = resolvePlace(raw, parsed, index, { preferredRegion })
    if (resolved.point) {
      places.set(cityKey(raw), toPlace(raw, resolved.point))
      statuses.set(raw, { status: resolved.status, note: resolved.note })
      stats.fromReference += 1
      continue
    }
    if (resolved.status === "ambiguous") stats.ambiguous += 1
    if (resolved.status === "reference-region") stats.noCoordinates += 1
    statuses.set(raw, { status: resolved.status, note: resolved.note })
    pending.push(raw)
  }

  if (pending.length > 0) {
    try {
      const rows = await source.cache(pending)
      const byAddress = new Map(rows.map((row) => [row.address.trim().toLowerCase(), row]))
      for (const raw of [...pending]) {
        const row = byAddress.get(raw.trim().toLowerCase())
        if (!row) continue
        if (String(row.status ?? "").toLowerCase() !== "verified") {
          statuses.set(raw, {
            status: "geocoder-unverified",
            note: "в кэше есть непроверенная запись — в маршрут не берём, пока её не проверят",
          })
          continue
        }
        places.set(cityKey(raw), toPlace(raw, { region: row.region, lat: row.lat, lon: row.lng }))
        statuses.set(raw, { status: "cache-verified", note: null })
        stats.fromCache += 1
        pending.splice(pending.indexOf(raw), 1)
      }
    } catch {
      // кэш не критичен
    }
  }

  if (pending.length > 0 && options.geocode) {
    const limit = Math.max(0, options.geocodeLimit ?? 12)
    const batch = pending.slice(0, limit)
    if (batch.length > 0) {
      try {
        const found = await options.geocode(batch)
        for (const raw of batch) {
          const point = found.get(raw)
          if (!point) continue
          places.set(cityKey(raw), toPlace(raw, { region: null, lat: point.lat, lon: point.lng }))
          statuses.set(raw, {
            status: "geocoder-unverified",
            note: "координаты от геокодера — не сверены с регионом, в расчёт идут с пометкой",
          })
          stats.fromGeocoder += 1
          geocoded.push(raw)
          pending.splice(pending.indexOf(raw), 1)
        }
      } catch {
        // геокодер недоступен — места останутся без координат, и это будет сказано
      }
    }
  }

  for (const raw of pending) {
    const known = statuses.get(raw)
    const status = known?.status ?? "missing"
    if (status === "missing") stats.missing += 1
    unresolved.push({
      raw,
      status,
      note: known?.note ?? "не найдено ни в справочнике, ни в проверенном кэше",
    })
  }

  return { places, statuses, unresolved, stats, geocoded }
}

/** Регион населённого пункта по справочнику — для базы организации. */
export async function regionOfCity(
  source: GeoSource,
  city: string | null | undefined,
): Promise<string | null> {
  const name = String(city ?? "").trim()
  if (!name) return null
  try {
    const index = buildPlaceIndex(await source.cities([name]))
    const resolved = resolvePlace(name, parseAddress(name), index, {})
    if (resolved.point && isTrusted(resolved.status)) return resolved.point.region ?? null
    return null
  } catch {
    return null
  }
}
