// lib/geo/geocode.ts
//
// Координаты городов для карты маршрута.
//
// Как это работает:
//   1. сначала смотрим постоянный кэш в таблице GeoCache (адрес → координаты) —
//      он общий для всей платформы, потому что это справочные данные о городах,
//      а не данные организации;
//   2. если адреса нет — спрашиваем координаты (сначала «как написано»,
//      потом «только населенный пункт»: ATI пишет «Среднесибирский п.», а
//      геокодер такую запись не понимает). Приоритет у Яндекс.Геокодера
//      (если задан YANDEX_GEOCODER_API_KEY): российские адреса он знает лучше,
//      и лимит 1 запрос/сек Nominatim сильно тормозит оптимизатор. Без ключа —
//      Nominatim (OpenStreetMap), результат кладётся в GeoCache, чтобы
//      следующий запрос обошёлся без сети;
//   3. между сетевыми запросами держим паузу: правила Nominatim требуют не чаще
//      одного запроса в секунду с осмысленным User-Agent;
//   4. если координат нет — возвращаем null, и карта честно скажет, какие города
//      не удалось определить, вместо того чтобы рисовать выдуманную точку.
//
// Эндпоинт `/api/ati/geo` тут не подходит: это справочник городов ATI с их
// идентификаторами, без координат.

import { prisma } from "@/lib/prisma"
import { plainPlace } from "@/lib/geo/nominatim"

export type Coordinates = { lat: number; lng: number }

/** Откуда взялись координаты — чтобы интерфейс не врал об источнике. */
export type GeocodeSource = "yandex" | "nominatim" | "cache" | "none"

/** Сколько адресов разрешено геокодировать за один запрос (защита от лавины). */
export const MAX_GEOCODES_PER_REQUEST = 12

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
const YANDEX_GEOCODE_URL = "https://geocode-maps.yandex.ru/1.x/"
const USER_AGENT = "Loginex-TMS/1.0 (route planning)"
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

/**
 * Признак «геокодер ничего не нашёл, но вернул точку».
 *
 * Яндекс на заведомо несуществующий адрес отвечает HTTP 200 и одной точкой —
 * центром страны (в проверке: 61.698657, 99.505405, Эвенкия), с
 * `kind: "country"` и `Address.formatted === "Россия"`. Формально это валидные
 * координаты, поэтому проверка диапазона их не отсекает, и адрес считался
 * успешно геокодированным. Такой ответ — отказ, а не результат.
 */
function isYandexNotFound(geoObject: unknown): boolean {
  const meta = (geoObject as { metaDataProperty?: { GeocoderMetaData?: { kind?: string } } })
    ?.metaDataProperty?.GeocoderMetaData
  // kind: "country" — совпала только страна, ни населённый пункт, ни улица.
  return meta?.kind === "country"
}

/**
 * Яндекс.Геокодер. Ключ выдают в Кабинете разработчика отдельно от ключа
 * Маршрутизации: ключ геокодера для пробок НЕ работает и наоборот.
 */
async function geocodeYandex(address: string): Promise<Coordinates | null> {
  const apiKey = process.env.YANDEX_GEOCODER_API_KEY
  if (!apiKey) return null

  const query = /росси/i.test(address) ? address : `${address}, Россия`

  try {
    const url = new URL(YANDEX_GEOCODE_URL)
    url.searchParams.set("apikey", apiKey)
    url.searchParams.set("geocode", query)
    url.searchParams.set("format", "json")
    url.searchParams.set("results", "1")
    // Ограничиваем Россией: без этого «Минск» и «Москва» уезжают не туда
    url.searchParams.set("bbox", "19.0,41.0~180.0,82.0")

    const response = await fetch(url.toString(), {
      headers: { "Accept-Language": "ru" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return null

    const data = await response.json()
    const collection = data?.response?.GeoObjectCollection
    const geoObject = collection?.featureMember?.[0]?.GeoObject
    // found === "0" — Яндекс прямо говорит, что совпадений нет
    const found = collection?.metaDataProperty?.GeocoderResponseMetaData?.found
    if (found === "0" || found === 0) return null
    if (isYandexNotFound(geoObject)) return null

    const pos = geoObject?.Point?.pos
    if (typeof pos !== "string") return null

    const [lng, lat] = pos.split(" ").map(Number)
    const coords = { lat, lng }
    return isCoordinates(coords) ? coords : null
  } catch (error) {
    console.error("[geocode] ошибка запроса к Яндекс.Геокодеру:", error)
    return null
  }
}

async function geocodeNominatim(address: string): Promise<Coordinates | null> {
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
    if (!isCoordinates(coords)) return null
    // Тот же случай, что и у Яндекса: Nominatim на заведомо несуществующий
    // адрес отвечает «страна» (class: "place", type: "country") — это отказ,
    // а не найденная точка.
    if (data[0].class === "place" && data[0].type === "country") return null
    return coords
  } catch (error) {
    console.error("[geocode] ошибка запроса к Nominatim:", error)
    return null
  }
}

/**
 * Варианты одного адреса для геокодера — от точного к грубому.
 *
 * Зачем второй вариант: точки ATI приходят как «Шелангер п. (Звениговский
 * р-н), Республика Марий Эл». Геокодер такую запись не переваривает (замер:
 * ноль ответов), а «Шелангер, Республика Марий Эл» — находит. Регион в
 * строке оставляем: без него голое «Шарапово» уводит в Псковскую область,
 * где есть одноимённое село.
 */
function addressVariants(address: string): string[] {
  const base = address.replace(/\s+/g, " ").trim()
  const plain = plainPlace(base)
  const out = [base]
  if (plain && plain !== base) out.push(plain)
  return out.filter((value, index) => value.length >= 3 && out.indexOf(value) === index)
}

/**
 * Один сетевой запрос координат. Сначала Яндекс (если ключ есть), затем
 * Nominatim: провайдер может отдать null, и тогда пробуем следующий.
 * Возвращает ещё и источник, чтобы интерфейс показывал правду.
 */
async function geocodeRemote(
  address: string,
): Promise<{ coords: Coordinates | null; source: GeocodeSource }> {
  for (const variant of addressVariants(address)) {
    const yandex = await geocodeYandex(variant)
    if (yandex) return { coords: yandex, source: "yandex" }

    const nominatim = await geocodeNominatim(variant)
    if (nominatim) return { coords: nominatim, source: "nominatim" }
  }

  return { coords: null, source: "none" }
}

/** Координаты для списка адресов + источник каждой точки. */
export async function geocodeAddressesWithSource(
  addresses: readonly string[],
): Promise<{
  coords: Map<string, Coordinates | null>
  sources: Map<string, GeocodeSource>
}> {
  const result = new Map<string, Coordinates | null>()
  const sources = new Map<string, GeocodeSource>()
  const unique = Array.from(new Set(addresses.map((a) => a.trim()).filter((a) => a.length >= 3)))

  if (unique.length === 0) return { coords: result, sources }

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
      sources.set(address, "cache")
    } else {
      networkQueue.push(address)
    }
  }

  // 2. сеть — по одному адресу за раз, с паузой и записью в кэш
  const limited = networkQueue.slice(0, MAX_GEOCODES_PER_REQUEST)
  for (let index = 0; index < limited.length; index += 1) {
    const address = limited[index]
    if (index > 0) await sleep(PAUSE_BETWEEN_REQUESTS_MS)

    const { coords, source } = await geocodeRemote(address)
    result.set(address, coords)
    sources.set(address, source)
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
    sources.set(address, "none")
  }

  return { coords: result, sources }
}

/**
 * Координаты для списка адресов — карта «адрес как он был передан» →
 * координаты (или null). Дубликаты адресов запрашиваются один раз.
 * Тонкая обёртка над geocodeAddressesWithSource для старых вызовов.
 */
export async function geocodeAddresses(
  addresses: readonly string[],
): Promise<Map<string, Coordinates | null>> {
  const { coords } = await geocodeAddressesWithSource(addresses)
  return coords
}

/** Сводный источник координат: «yandex», «nominatim», «cache» или «none». */
export function summarizeGeocodeSource(
  sources: Map<string, GeocodeSource>,
): GeocodeSource {
  if (sources.size === 0) return "none"
  const values = Array.from(sources.values())
  if (values.every((value) => value === "yandex")) return "yandex"
  if (values.some((value) => value === "yandex")) return "yandex"
  if (values.every((value) => value === "nominatim")) return "nominatim"
  if (values.every((value) => value === "cache")) return "cache"
  if (values.some((value) => value === "nominatim" || value === "cache")) return "nominatim"
  return "none"
}
