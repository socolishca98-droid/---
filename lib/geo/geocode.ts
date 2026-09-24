// lib/geo/geocode.ts
//
// Координаты городов для карты маршрута.
//
// Как это работает:
//   1. сначала смотрим постоянный кэш в таблице GeoCache (адрес → координаты) —
//      он общий для всей платформы, потому что это справочные данные о городах,
//      а не данные организации;
//   2. если адреса нет — спрашиваем Nominatim (OpenStreetMap) и кладём результат
//      в GeoCache, чтобы следующий запрос обошёлся без сети;
//   3. между сетевыми запросами держим паузу: правила Nominatim требуют не чаще
//      одного запроса в секунду с осмысленным User-Agent;
//   4. если координат нет — возвращаем null, и карта честно скажет, какие города
//      не удалось определить, вместо того чтобы рисовать выдуманную точку.
//
// Эндпоинт `/api/ati/geo` тут не подходит: это справочник городов ATI с их
// идентификаторами, без координат.

import { prisma } from "@/lib/prisma"

export type Coordinates = { lat: number; lng: number }

/** Сколько адресов разрешено геокодировать за один запрос (защита от лавины). */
export const MAX_GEOCODES_PER_REQUEST = 12

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
const USER_AGENT = "Loginex-TMS/1.0 (маршрутизация заказов)"
const REQUEST_TIMEOUT_MS = 4000
/**
 * Пауза между сетевыми запросами: политика Nominatim — не чаще 1 раза в секунду.
 * В тестах выставляется в ноль (GEOCODE_PAUSE_MS=0), чтобы прогон не ждал зря.
 */
const PAUSE_BETWEEN_REQUESTS_MS = Number(process.env.GEOCODE_PAUSE_MS ?? 1000)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeKey = (address: string) => address.trim().toLowerCase()

function isCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false
  const { lat, lng } = value as Coordinates
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

async function geocodeRemote(address: string): Promise<Coordinates | null> {
  const query = /росси/i.test(address) ? address : `${address}, Россия`

  try {
    const url = new URL(NOMINATIM_URL)
    url.searchParams.set("q", query)
    url.searchParams.set("format", "json")
    url.searchParams.set("limit", "1")
    url.searchParams.set("countrycodes", "ru")

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ru" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return null

    const data = await response.json()
    if (!Array.isArray(data) || data.length === 0) return null

    const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    return isCoordinates(coords) ? coords : null
  } catch (error) {
    console.error("[geocode] ошибка запроса к Nominatim:", error)
    return null
  }
}

/**
 * Координаты для списка адресов. Возвращает карту «адрес как он был передан» →
 * координаты (или null). Дубликаты адресов запрашиваются один раз.
 */
export async function geocodeAddresses(
  addresses: readonly string[],
): Promise<Map<string, Coordinates | null>> {
  const result = new Map<string, Coordinates | null>()
  const unique = Array.from(new Set(addresses.map((a) => a.trim()).filter((a) => a.length >= 3)))

  if (unique.length === 0) return result

  // 1. постоянный кэш
  const cached = (await prisma.geoCache.findMany({
    where: { address: { in: unique.map(normalizeKey) } },
    select: { address: true, lat: true, lng: true },
  })) as { address: string; lat: number; lng: number }[]

  const byKey = new Map(cached.map((row) => [row.address, { lat: row.lat, lng: row.lng }]))

  const networkQueue: string[] = []
  for (const address of unique) {
    const hit = byKey.get(normalizeKey(address))
    if (hit) {
      result.set(address, hit)
    } else {
      networkQueue.push(address)
    }
  }

  // 2. сеть — по одному адресу за раз, с паузой и записью в кэш
  const limited = networkQueue.slice(0, MAX_GEOCODES_PER_REQUEST)
  for (let index = 0; index < limited.length; index += 1) {
    const address = limited[index]
    if (index > 0) await sleep(PAUSE_BETWEEN_REQUESTS_MS)

    const coords = await geocodeRemote(address)
    result.set(address, coords)
    if (!coords) continue

    try {
      // org-audit: manual — GeoCache общий справочник адресов (города), данные
      // организации к нему не применяются: запись одинакова для всех
      await prisma.geoCache.upsert({
        where: { address: normalizeKey(address) },
        create: { address: normalizeKey(address), lat: coords.lat, lng: coords.lng },
        update: { lat: coords.lat, lng: coords.lng },
      })
    } catch (error) {
      // кэш не критичен: координаты уже получены
      console.error("[geocode] не удалось сохранить в GeoCache:", error)
    }
  }

  // адреса сверх лимита не теряем: они попадут в следующий запрос
  for (const address of networkQueue.slice(MAX_GEOCODES_PER_REQUEST)) {
    result.set(address, null)
  }

  return result
}
