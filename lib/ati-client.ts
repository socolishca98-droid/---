// lib/ati-client.ts
// ATI.su интеграция — без лишних логов и без создания Order

import { prisma } from "@/lib/prisma"
import { atiFetch, atiHeaders, atiHttpError, ATI_API_BASE } from "./ati/http"
import { geocodeAddresses, type Coordinates } from "@/lib/geo/geocode"

// Токен больше не глобальный: каждая организация подключает СВОЙ аккаунт
// ATI.SU (своя подписка, свои площадки, свои лимиты), токен передаётся
// в функции из lib/ati/connection.ts. Прежний адрес loads.ati.su/webapi —
// внутренний недокументированный API сайта: правила ATI (п. 2.9) запрещают
// недокументированные возможности, поэтому все запросы переведены на
// официальный https://api.ati.su.

// CITIES: статический справочник id городов ATI для гео-фильтра профилей
// расписания. Никаких запросов к ATI не делает — фильтрация идёт по ответу.
const CITIES = [
  { id: 151, atiId: 151, name: "Москва", region: "Москва", priority: 1 },
  { id: 153, atiId: 153, name: "Санкт-Петербург", region: "Санкт-Петербург", priority: 1 },
  { id: 78, atiId: 78, name: "Нижний Новгород", region: "Нижегородская область", priority: 1 },
  { id: 54, atiId: 54, name: "Казань", region: "Республика Татарстан", priority: 1 },
  { id: 9, atiId: 9, name: "Самара", region: "Самарская область", priority: 1 },
  { id: 43, atiId: 43, name: "Уфа", region: "Республика Башкортостан", priority: 1 },
  { id: 40, atiId: 40, name: "Краснодар", region: "Краснодарский край", priority: 1 },
  { id: 7, atiId: 7, name: "Ростов-на-Дону", region: "Ростовская область", priority: 1 },
  { id: 21, atiId: 21, name: "Екатеринбург", region: "Свердловская область", priority: 1 },
  { id: 86, atiId: 86, name: "Челябинск", region: "Челябинская область", priority: 1 },
  { id: 80, atiId: 80, name: "Новосибирск", region: "Новосибирская область", priority: 1 },
  { id: 20, atiId: 20, name: "Барнаул", region: "Алтайский край", priority: 0 },
  { id: 81, atiId: 81, name: "Омск", region: "Омская область", priority: 0 },
  { id: 3, atiId: 3, name: "Пермь", region: "Пермский край", priority: 1 },
  { id: 11, atiId: 11, name: "Саратов", region: "Саратовская область", priority: 0 },
  { id: 63, atiId: 63, name: "Астрахань", region: "Астраханская область", priority: 0 },
  { id: 26, atiId: 26, name: "Воронеж", region: "Воронежская область", priority: 1 },
  { id: 67, atiId: 67, name: "Волгоград", region: "Волгоградская область", priority: 1 },
  { id: 65, atiId: 65, name: "Брянск", region: "Брянская область", priority: 0 },
  { id: 74, atiId: 74, name: "Курск", region: "Курская область", priority: 0 },
  { id: 66, atiId: 66, name: "Владимир", region: "Владимирская область", priority: 0 },
  { id: 69, atiId: 69, name: "Иваново", region: "Ивановская область", priority: 0 },
  { id: 88, atiId: 88, name: "Ярославль", region: "Ярославская область", priority: 0 },
  { id: 15, atiId: 15, name: "Тюмень", region: "Тюменская область", priority: 0 },
  { id: 16, atiId: 16, name: "Сургут", region: "ХМАО – Югра", priority: 0 },
  { id: 61, atiId: 61, name: "Хабаровск", region: "Хабаровский край", priority: 0 },
  { id: 60, atiId: 60, name: "Владивосток", region: "Приморский край", priority: 0 },
  { id: 71, atiId: 71, name: "Калининград", region: "Калининградская область", priority: 0 },
]

const HUB_IDS_PRIORITY_1 = CITIES.filter((c: any) => c.priority === 1).map((c: any) => c.atiId)
const ALL_HUB_IDS = HUB_IDS_PRIORITY_1

interface ScanFilters {
  minPrice?: number
  maxPrice?: number
  minDistance?: number
  maxDistance?: number
  minPricePerKm?: number
  maxWeight?: number
  minWeight?: number
  /**
   * Нужные типы кузова («тент», «изотермический», «рефрижератор»).
   * ATI не фильтрует по типу кузова в запросе, поэтому отбираем по ответу.
   */
  truckTypes?: string[]
  /**
   * Окно даты погрузки в днях от сегодня (0 — сегодня, 3 — ближайшие три дня).
   * Как и остальные поля формы ATI, применяется к ответу: в запросе ATI
   * такого фильтра нет.
   */
  loadingWithinDays?: number
}

const DEFAULT_FILTERS: ScanFilters = {
  minDistance: 50,
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function filterLoad(item: any, filters: ScanFilters): boolean {
  const distance = item.route?.distance || 0
  const weight = item.load?.weight ? Math.round(item.load.weight * 1000) : 0

  let price = 0
  if (item.rate) {
    price = item.rate.priceNds || item.rate.priceNoNds || item.rate.price || 0
  }
  const isNegotiable = price === 0
  const pricePerKm = distance > 0 && price > 0 ? Math.round(price / distance) : 0

  if (filters.minDistance && distance < filters.minDistance) return false
  if (filters.maxDistance && distance > filters.maxDistance) return false
  if (filters.minWeight && weight < filters.minWeight) return false
  if (filters.maxWeight && weight > filters.maxWeight) return false

  if (!isNegotiable) {
    if (filters.minPrice && price < filters.minPrice) return false
    if (filters.maxPrice && price > filters.maxPrice) return false
    if (filters.minPricePerKm && pricePerKm < filters.minPricePerKm) return false
  }

  // Окно даты погрузки (поле формы ATI): груз вне окна не показываем;
  // если ATI дату не отдал — груз остаётся (лучше показать, чем потерять)
  if (filters.loadingWithinDays != null) {
    const date = parseLoadingDate(item)
    if (date) {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = start.getTime() + (filters.loadingWithinDays + 1) * 86400000
      const ts = date.getTime()
      if (ts < start.getTime() || ts > end) return false
    }
  }

  // Тип кузова: ATI отдаёт его в truck.carTypes — фильтруем по ответу
  if (filters.truckTypes && filters.truckTypes.length > 0) {
    const carTypes: string[] = Array.isArray(item.truck?.carTypes) ? item.truck.carTypes : []
    const haystack = carTypes.join(" ").toLowerCase()
    const wanted = filters.truckTypes.some((type) => haystack.includes(String(type).toLowerCase()))
    if (!wanted) return false
  }
  return true
}

/** Дата погрузки из ответа ATI:_iso или дд.мм.гггг — иначе null. */
function parseLoadingDate(load: any): Date | null {
  const raw =
    load?.loading?.date ??
    load?.loading?.dateStart ??
    load?.loadingDate ??
    load?.loadDate ??
    null
  if (!raw) return null
  if (typeof raw === "string" && /^\d{1,2}\.\d{1,2}\.\d{4}/.test(raw)) {
    const [d, m, y] = raw.split(".").map((part: string) => Number(part))
    const date = new Date(y, (m || 1) - 1, d || 1)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Расстояние по дуге, км — для радиуса вокруг города в ручном поиске. */
function distanceKm(a: Coordinates, b: Coordinates): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Координаты точки погрузки/выгрузки из ответа ATI, если они там есть. */
function locationCoords(location: any): Coordinates | null {
  if (!location) return null
  const lat = Number(location.latitude ?? location.lat)
  const lng = Number(location.longitude ?? location.lng ?? location.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

let globalSeenIds: Set<string> = new Set()

function addIfNew(load: any, filters: ScanFilters): boolean {
  const id = String(load.id)
  if (globalSeenIds.has(id)) return false
  if (!filterLoad(load, filters)) return false
  globalSeenIds.add(id)
  return true
}

// =============================================================================
// НОРМАЛИЗАЦИЯ ГОРОДА
// =============================================================================

function makeCityKey(route: string | null | undefined): string | null {
  if (!route) return null
  const trimmed = route.trim()
  if (!trimmed) return null

  let firstPart = trimmed.split(",")[0].trim().toLowerCase()

  firstPart = firstPart
    .replace(/\s+г\.\s*$/i, "")
    .replace(/\s+г\s*$/i, "")
    .replace(/\s+д\.\s*$/i, "")
    .replace(/\s+пос\.\s*$/i, "")
    .replace(/\s+п\.\s*$/i, "")
    .replace(/\s+с\.\s*$/i, "")
    .replace(/\s+х\.\s*$/i, "")
    .trim()

  if (!firstPart) return null
  return firstPart
}

function normalizeGeoToCityKey(geo: any): string | null {
  if (!geo) return null
  const base: string =
    (geo.fullName as string | undefined) || (geo.name as string | undefined) || ""
  return makeCityKey(base)
}

function normalizeLoadFromToCityKey(load: any): string | null {
  const locFrom = load.loading?.location
  const city = locFrom?.city || locFrom?.cityName || null
  const region = locFrom?.region || locFrom?.region_name || ""
  const route = city ? (region ? `${city}, ${region}` : city) : null
  return makeCityKey(route)
}

// =============================================================================
// ЗАПРОСЫ К ATI API
// =============================================================================

/**
 * Официальный метод: площадки, на которых организация может видеть грузы
 * (GET /v2/boards/public/boards/canView). Поиск грузов через API поддержан
 * ТОЛЬКО по персональным площадкам — документированное ограничение ATI.SU.
 */
async function fetchBoardIds(token: string, organizationId: string): Promise<string[]> {
  const res = await atiFetch(
    `${ATI_API_BASE}/v2/boards/public/boards/canView`,
    {
      headers: atiHeaders(token),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
    organizationId,
  )
  if (!res.ok) throw new Error(atiHttpError(res.status, "Список площадок"))
  const data: any = await res.json()
  const rows = Array.isArray(data) ? data : data?.boards ?? data?.items ?? []
  return rows
    .map((board: any) => String(board?.id ?? board?.Id ?? ""))
    .filter((id: string) => id.length > 0)
}

/**
 * Официальный метод: грузы, размещённые на площадках организации
 * (GET /v1.0/loads/search/byboards). Свои и чужие грузы участников площадок.
 */
async function fetchLoadsByBoards(token: string, organizationId: string): Promise<any[]> {
  const res = await atiFetch(
    `${ATI_API_BASE}/v1.0/loads/search/byboards`,
    {
      headers: atiHeaders(token),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
    organizationId,
  )
  if (!res.ok) throw new Error(atiHttpError(res.status, "Поиск грузов"))
  const data: any = await res.json()
  return Array.isArray(data) ? data : data?.loads ?? data?.items ?? []
}

// =============================================================================
// СКАНИРОВАНИЕ
// =============================================================================

export async function scanAtiLoads(params?: any) {
  const token: string | null = params?.token ?? null
  const organizationId: string | null = params?.organizationId ?? null
  if (!token || !organizationId) {
    return {
      success: false,
      code: "ati_not_connected",
      error: "Скан не выполнен: организация не подключена к ATI.SU",
    }
  }

  const customFilters: ScanFilters = params?.filters || DEFAULT_FILTERS
  globalSeenIds = new Set()

  // Города профиля расписания (ATI id) → ключи имён: официальный поиск по
  // площадкам не фильтрует гео на сервере, поэтому отбираем по ответу.
  const profileCityIds: number[] = Array.isArray(params?.cityIds)
    ? params.cityIds.filter((id: unknown) => Number.isFinite(Number(id))).map(Number)
    : []
  const cityKeys = profileCityIds
    .map((id) => CITIES.find((city: any) => city.atiId === id))
    .filter(Boolean)
    .map((city: any) => makeCityKey(city.name))
    .filter((key): key is string => Boolean(key))

  try {
    // Ручной поиск
    if (params?.manualMode) {
      return await manualSearch(params, customFilters, token, organizationId)
    }

    const boards = await fetchBoardIds(token, organizationId)
    const loads = await fetchLoadsByBoards(token, organizationId)

    const picked: any[] = []
    for (const load of loads) {
      if (cityKeys.length > 0) {
        const key = normalizeLoadFromToCityKey(load)
        if (!key || !cityKeys.includes(key)) continue
      }
      if (addIfNew(load, customFilters)) picked.push(load)
    }

    const saved = await saveToCache(picked, organizationId)
    return {
      success: true,
      count: saved.length,
      found: picked.length,
      requests: 2,
      errors: 0,
      boards: boards.length,
    }
  } catch (e: any) {
    console.error("[scanAtiLoads] Fatal error:", e)
    return { success: false, error: e.message || "Не удалось получить грузы с ATI" }
  }
}

/** Город выгрузки из ответа ATI (пара к normalizeLoadFromToCityKey). */
function normalizeLoadToCityKey(load: any): string | null {
  const locTo = load.unloading?.location
  const city = locTo?.city || locTo?.cityName || null
  const region = locTo?.region || locTo?.region_name || ""
  const route = city ? (region ? `${city}, ${region}` : city) : null
  return makeCityKey(route)
}

/**
 * Ручной поиск: те же грузы площадок организации + фильтры по городу
 * погрузки/выгрузки и параметрам (цена, вес, расстояние) по ответу.
 */
/**
 * Город попадает в радиус: координаты груза из ответа ATI сравниваем с
 * центром города (геокодер с кэшем GeoCache); если координат у груза нет —
 * fallback на точное совпадение названия города, как при радиусе 0.
 */
async function cityMatcher(
  geo: any,
  radiusKm: number,
  pick: (load: any) => string | null,
  pickLocation: (load: any) => any,
) {
  const cityKey = normalizeGeoToCityKey(geo)
  if (!cityKey) return null
  if (!radiusKm || radiusKm <= 0) {
    return (load: any) => pick(load) === cityKey
  }
  const label = String(geo?.fullName || geo?.name || cityKey)
  let center: Coordinates | null = null
  try {
    const coords = await geocodeAddresses([label])
    center = coords.get(label) ?? null
  } catch {
    center = null
  }
  if (!center) return (load: any) => pick(load) === cityKey
  return (load: any) => {
    const point = locationCoords(pickLocation(load))
    if (point) return distanceKm(center as Coordinates, point) <= radiusKm
    return pick(load) === cityKey
  }
}

async function manualSearch(
  params: any,
  filters: ScanFilters,
  token: string,
  organizationId: string,
) {
  const fromMatch = await cityMatcher(
    params.fromGeo,
    Number(params.fromRadius) || 0,
    normalizeLoadFromToCityKey,
    (load: any) => load?.loading?.location,
  )
  const toMatch = await cityMatcher(
    params.toGeo,
    Number(params.toRadius) || 0,
    normalizeLoadToCityKey,
    (load: any) => load?.unloading?.location,
  )

  const loads = await fetchLoadsByBoards(token, organizationId)
  const allLoads: any[] = []
  for (const load of loads) {
    if (fromMatch && !fromMatch(load)) continue
    if (toMatch && !toMatch(load)) continue
    if (addIfNew(load, filters)) allLoads.push(load)
  }

  const saved = await saveToCache(allLoads, organizationId)
  return {
    success: true,
    count: saved.length,
    found: allLoads.length,
    loads: saved,
    requests: 1,
  }
}

// =============================================================================
// СОХРАНЕНИЕ В КЭШ (без rawJson и без контактов)
// =============================================================================

async function saveToCache(rawLoads: any[], organizationId: string): Promise<any[]> {
  const saved: any[] = []
  const now = new Date()

  for (const item of rawLoads) {
    try {
      const atiId = String(item.id)

      // org-audit: ok — строка ищется в накопленной базе своей организации
      const existing = await prisma.atiCache.findFirst({
        where: { organizationId, atiLoadId: atiId },
      })
      if (existing) {
        // Обновляем только scannedAt для "new" записей
        if (existing.status === "new") {
          await prisma.atiCache.update({
            where: { id: existing.id },
            data: { scannedAt: now },
          })
        }
        saved.push(existing)
        continue
      }

      const locFrom = item.loading?.location
      const locTo = item.unloading?.location

      const fromCity = locFrom?.city || locFrom?.cityName || "N/A"
      const fromRegion = locFrom?.region || locFrom?.region_name || ""
      const toCity = locTo?.city || locTo?.cityName || "N/A"
      const toRegion = locTo?.region || locTo?.region_name || ""

      const routeFrom =
        fromRegion && fromCity !== "N/A" ? `${fromCity}, ${fromRegion}` : fromCity
      const routeTo = toRegion && toCity !== "N/A" ? `${toCity}, ${toRegion}` : toCity

      const fromKey = makeCityKey(routeFrom)
      const toKey = makeCityKey(routeTo)

      let price = 0
      let priceType: "with_nds" | "without_nds" | "unknown" | null = null
      if (item.rate) {
        if (item.rate.priceNds) {
          price = item.rate.priceNds
          priceType = "with_nds"
        } else if (item.rate.priceNoNds) {
          price = item.rate.priceNoNds
          priceType = "without_nds"
        } else if (item.rate.price) {
          price = item.rate.price
          priceType = "unknown"
        }
      }

      let loadingDate = new Date()
      if (item.loading?.firstDate) {
        const d = new Date(item.loading.firstDate)
        if (!isNaN(d.getTime())) loadingDate = d
      }

      const distance = item.route?.distance || 0
      const weight = item.load?.weight ? Math.round(item.load.weight * 1000) : 0

      // TTL: 2 дня от даты загрузки
      const ttlSource = loadingDate || now
      const expiresAt = new Date(ttlSource.getTime() + 2 * 24 * 60 * 60 * 1000)

      const created = await prisma.atiCache.create({
        data: {
          organizationId,
          atiLoadId: atiId,
          routeFrom,
          routeFromId: fromKey,
          routeTo,
          routeToId: toKey,
          distance,
          weight,
          volume: item.load?.volume || null,
          cargoType: item.load?.cargoType || "Груз",
          truckType: item.truck?.carTypes?.join(", ") || null,
          loadingType: item.truck?.loadingTypes?.join(", ") || null,
          price: Math.round(price),
          priceType: priceType || undefined,
          firmId: item.firm?.id ? String(item.firm.id) : null,
          firmName: item.firm?.name || "Частник",
          loadingDate,
          status: "new",
          contactName: null,
          contactPhone: null,
          note: null,
          rawJson: null,
          scannedAt: now,
          expiresAt,
        },
      })

      saved.push(created)
    } catch (error) {
      console.error("[saveToCache] Error on item:", error)
    }
  }
  return saved
}

// =============================================================================
// ПОЛУЧЕНИЕ КОНТАКТОВ ФИРМЫ (ТОЛЬКО ПО ЗАПРОСУ ПОЛЬЗОВАТЕЛЯ)
// =============================================================================
// Реализация живёт в lib/ati/contacts.ts — модуле без Prisma, чтобы его можно
// было импортировать из роутов, не тянущих клиент базы.
export { fetchFirmContacts } from "./ati/contacts"
export type { FirmContacts } from "./ati/contacts"

// =============================================================================
// ПОИСК ПО ЛОКАЛЬНОЙ БАЗЕ
// =============================================================================

export async function getAtiCache(params: any) {
  const {
    status = "new",
    search,
    limit = 50,
    offset = 0,
    minPrice,
    maxPrice,
    minDistance,
    maxDistance,
    minPricePerKm,
    sortBy = "scannedAt",
    sortOrder = "desc",
  } = params

  // org-audit: ok — накопленная база у каждой организации своя (organizationId
  // приходит из проверенной сессии, а не из тела запроса)
  const where: any = { status, organizationId: params.organizationId ?? null }

  if (search) {
    where.OR = [
      { routeFrom: { contains: search } },
      { routeTo: { contains: search } },
      { firmName: { contains: search } },
    ]
  }

  if (minPrice) {
    where.price = { ...(where.price || {}), gte: Number(minPrice) || 0 }
  }
  if (maxPrice) {
    where.price = { ...(where.price || {}), lte: Number(maxPrice) || 0 }
  }

  if (minDistance) {
    where.distance = { ...(where.distance || {}), gte: Number(minDistance) || 0 }
  }
  if (maxDistance) {
    where.distance = { ...(where.distance || {}), lte: Number(maxDistance) || 0 }
  }

  const orderBy: any = {}
  const order: "asc" | "desc" = sortOrder === "asc" ? "asc" : "desc"

  if (sortBy === "price") {
    orderBy.price = order
  } else if (sortBy === "distance") {
    orderBy.distance = order
  } else if (sortBy === "loadingDate") {
    orderBy.loadingDate = order
  } else {
    orderBy.scannedAt = order
  }

  let items = await prisma.atiCache.findMany({
    where,
    skip: offset,
    take: limit * 3,
    orderBy,
  })

  if (minPricePerKm) {
    const minPpk = Number(minPricePerKm) || 0
    items = items.filter((item: any) => {
      const distance = item.distance || 0
      const price = item.price || 0
      if (!distance || !price) return false
      const ppk = Math.round(price / distance)
      return ppk >= minPpk
    })
  }

  const sliced = items.slice(0, limit)
  const total = await prisma.atiCache.count({ where })

  return {
    items: sliced,
    total,
    limit,
    offset,
    hasMore: offset + sliced.length < total,
  }
}

export async function getAtiStats(organizationId: string | null = null) {
  // org-audit: ok — все счётчики только по строкам своей организации
  const total = await prisma.atiCache.count({ where: { organizationId } })
  // «Взято в работу» — строки базы, на которые организация завела заказ
  // (Order.atiCacheId), плюс легас-строки, помеченные прежним «импортом».
  const legacyImported = await prisma.atiCache.count({
    where: { organizationId, status: "imported" },
  })
  const takenOrders = await prisma.order.findMany({
    where: { organizationId, atiCacheId: { not: null } },
    select: { atiCacheId: true },
    distinct: ["atiCacheId"],
  })
  const imported = takenOrders.length + legacyImported
  const expired = await prisma.atiCache.count({ where: { organizationId, status: "expired" } })
  const fresh = Math.max(0, total - imported - expired)

  const now = new Date()
  const soonThreshold = new Date(now.getTime() + 6 * 60 * 60 * 1000) // 6 часов
  const expiringSoon = await prisma.atiCache.count({
    where: {
      organizationId,
      status: "new",
      expiresAt: { lte: soonThreshold },
    },
  })

  return {
    total,
    new: fresh,
    imported,
    expired,
    expiringSoon,
  }
}

// =============================================================================
// ОЧИСТКА УСТАРЕВШИХ ЗАПИСЕЙ
// =============================================================================

export async function cleanExpiredCache() {
  const now = new Date()

  // 1. Удаляем "new" с истекшим TTL
  const deletedNew = await prisma.atiCache.deleteMany({
    where: {
      status: "new",
      expiresAt: { lt: now },
    },
  })

  // 2. Помечаем "expired" те imported, которым > 7 дней
  const expiredThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const markedExpired = await prisma.atiCache.updateMany({
    where: {
      status: "imported",
      scannedAt: { lt: expiredThreshold },
    },
    data: { status: "expired" },
  })

  // 3. Удаляем expired старше 30 дней
  const deleteThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const deletedExpired = await prisma.atiCache.deleteMany({
    where: {
      status: "expired",
      scannedAt: { lt: deleteThreshold },
    },
  })

  return {
    deletedNew: deletedNew.count,
    markedExpired: markedExpired.count,
    deletedExpired: deletedExpired.count,
  }
}

// =============================================================================
// ВЗЯТЬ ГРУЗ В РАБОТУ
// =============================================================================
//
// Прежняя функция importAtiLoadToOrder удалена намеренно: она помечала строку
// ОБЩЕЙ таблицы AtiCache как «imported», из-за чего груз исчезал из базы у всех
// остальных организаций, а заказ так и не создавался.
//
// Теперь «взять в работу» = POST /api/orders/from-cache: создаёт заказ своей
// организации на этапе «Поиск» и не меняет общую базу. Связь заказа со строкой
// базы хранится в Order.atiCacheId (уникально в рамках организации).

// =============================================================================
// ЭКСПОРТЫ
// =============================================================================

export function getCitiesList() {
  return CITIES
}

export { CITIES, ALL_HUB_IDS, DEFAULT_FILTERS }
export type { ScanFilters }