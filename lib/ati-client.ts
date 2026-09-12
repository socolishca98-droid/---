// lib/ati-client.ts
// ATI.su интеграция — без лишних логов и без создания Order

import { prisma } from "./prisma"

const ATI_TOKEN = process.env.ATI_TOKEN || ""
const ATI_API = "https://loads.ati.su/webapi/v1.0"

// ВАЖНО: соответствует тарифу ATI — 10 записей на страницу
const ITEMS_PER_PAGE = 10

// CITIES: эмпирически выученные from.id (по brute-force)
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

const HUB_IDS_PRIORITY_1 = CITIES.filter((c) => c.priority === 1).map((c) => c.atiId)
const ALL_HUB_IDS = HUB_IDS_PRIORITY_1

type ScanMode = "fast" | "normal" | "deep"

interface ScanFilters {
  minPrice?: number
  maxPrice?: number
  minDistance?: number
  maxDistance?: number
  minPricePerKm?: number
  maxWeight?: number
  minWeight?: number
}

interface ModeConfig {
  cityLimit?: number
  segmentsPerCity: number
  maxPages: number
  sortTypes: number[]
}

const MODE_CONFIG: Record<ScanMode, ModeConfig> = {
  fast: {
    cityLimit: HUB_IDS_PRIORITY_1.length,
    segmentsPerCity: 1,
    maxPages: 1,
    sortTypes: [2],
  },
  normal: {
    cityLimit: HUB_IDS_PRIORITY_1.length,
    segmentsPerCity: 2,
    maxPages: 2,
    sortTypes: [2],
  },
  deep: {
    cityLimit: HUB_IDS_PRIORITY_1.length,
    segmentsPerCity: 3,
    maxPages: 10,
    sortTypes: [2, 4],
  },
}

const DATE_SEGMENTS = [
  { option: "today", name: "Сегодня" },
  { option: "tomorrow", name: "Завтра" },
  { option: "week", name: "Неделя" },
]

const DEFAULT_FILTERS: ScanFilters = {
  minDistance: 50,
}

// Карта "краткое имя города" -> наш выученный from.id для ручного поиска
const CITY_NAME_TO_FROM_ID: Record<string, number> = {
  Москва: 151,
  "Санкт-Петербург": 153,
  "Нижний Новгород": 78,
  Казань: 54,
  Самара: 9,
  Уфа: 43,
  Краснодар: 40,
  "Ростов-на-Дону": 7,
  Екатеринбург: 21,
  Челябинск: 86,
  Новосибирск: 80,
  Пермь: 3,
  Воронеж: 26,
  Волгоград: 67,
  Ярославль: 88,
  Тюмень: 15,
  Хабаровск: 61,
  Владивосток: 60,
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

function getHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${ATI_TOKEN}`,
    Cookie: `sid=${ATI_TOKEN};`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
    Referer: "https://loads.ati.su/",
    Origin: "https://loads.ati.su",
    "Content-Type": "application/json",
    Accept: "application/json",
  }
}

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
  return true
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

async function fetchLoadsPage(filter: any, page: number): Promise<any[]> {
  try {
    const res = await fetch(`${ATI_API}/loads/search`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        exclude_geo_dicts: true,
        page,
        items_per_page: ITEMS_PER_PAGE,
        filter,
      }),
      cache: "no-store",
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.loads || []
  } catch (error) {
    console.error("[ATI fetchLoadsPage] Error:", error)
    return []
  }
}

// =============================================================================
// СКАНИРОВАНИЕ
// =============================================================================

export async function scanAtiLoads(params?: any) {
  const scanMode = (params?.mode || "normal") as ScanMode
  const cfg = MODE_CONFIG[scanMode] || MODE_CONFIG.normal
  const customFilters: ScanFilters = params?.filters || DEFAULT_FILTERS
  globalSeenIds = new Set()

  const hubsBase = HUB_IDS_PRIORITY_1
  const cityLimit = cfg.cityLimit ?? hubsBase.length
  const hubsToScan = hubsBase.slice(0, cityLimit)

  try {
    // Ручной поиск
    if (params?.manualMode) {
      return await manualSearch(params, customFilters)
    }

    let totalFound = 0
    let totalSaved = 0
    let totalRequests = 0
    let errors = 0

    for (let i = 0; i < hubsToScan.length; i++) {
      const cityId = hubsToScan[i]

      try {
        const { loads, requests } = await scanCity(cityId, cfg, customFilters)
        totalRequests += requests
        totalFound += loads.length

        if (loads.length > 0) {
          const saved = await saveToCache(loads)
          totalSaved += saved.length
        }
      } catch (e: any) {
        errors++
      }
      await delay(300)
    }

    return {
      success: true,
      count: totalSaved,
      found: totalFound,
      requests: totalRequests,
      errors,
      hubs: hubsToScan.length,
    }
  } catch (e: any) {
    console.error("[scanAtiLoads] Fatal error:", e)
    return { success: false, error: e.message || "ATI scan failed" }
  }
}

async function scanCity(
  cityId: number,
  cfg: ModeConfig,
  filters: ScanFilters,
): Promise<{ loads: any[]; requests: number }> {
  const allLoads: any[] = []
  let requests = 0
  const sortTypes = cfg.sortTypes
  const maxPages = cfg.maxPages

  for (const dateSeg of DATE_SEGMENTS.slice(0, cfg.segmentsPerCity)) {
    for (const sortType of sortTypes) {
      let page = 1

      while (page <= maxPages) {
        try {
          const filter: any = {
            dates: { date_option: dateSeg.option },
            sorting_type: sortType,
            from: {
              id: cityId,
              type: 1,
              radius: 100,
              exact_only: false,
            },
          }

          const loads = await fetchLoadsPage(filter, page)
          requests++
          if (!loads.length) break

          for (const load of loads) {
            if (addIfNew(load, filters)) allLoads.push(load)
          }

          if (loads.length < ITEMS_PER_PAGE) break
          page++
          await delay(300)
        } catch {
          break
        }
      }
    }
  }

  return { loads: allLoads, requests }
}

async function manualSearch(params: any, filters: ScanFilters) {
  let fromId = params.fromCityId || params.fromGeo?.id
  const toId = params.toCityId || params.toGeo?.id
  const fromRadius = params.fromRadius || 0
  const toRadius = params.toRadius || 0

  if (params.fromGeo) {
    const geoName: string = params.fromGeo.name || ""
    const geoFullName: string = params.fromGeo.fullName || ""

    for (const [cityName, learnedId] of Object.entries(CITY_NAME_TO_FROM_ID)) {
      if (geoName === cityName || geoFullName.includes(cityName)) {
        fromId = learnedId
        break
      }
    }
  }

  if (!fromId) return { success: false, error: "City ID required" }

  const allLoads: any[] = []
  let requests = 0
  const fromCityKey = normalizeGeoToCityKey(params.fromGeo)
  const maxPages = 10

  for (const dateSeg of DATE_SEGMENTS) {
    let page = 1

    while (page <= maxPages) {
      try {
        const filter: any = {
          dates: { date_option: dateSeg.option },
          sorting_type: 2,
          from: {
            id: fromId,
            type: 1,
            radius: fromRadius,
            exact_only: fromRadius === 0,
          },
        }
        if (toId) {
          filter.to = {
            id: toId,
            type: 1,
            radius: toRadius,
            exact_only: toRadius === 0,
          }
        }

        const loads = await fetchLoadsPage(filter, page)
        requests++
        if (!loads.length) break

        for (const load of loads) {
          if (fromRadius === 0 && fromCityKey) {
            const loadFromKey = normalizeLoadFromToCityKey(load)
            if (!loadFromKey || loadFromKey !== fromCityKey) continue
          }

          if (addIfNew(load, filters)) allLoads.push(load)
        }

        if (loads.length < ITEMS_PER_PAGE) break
        page++
        await delay(300)
      } catch {
        break
      }
    }
  }

  const saved = await saveToCache(allLoads)
  return {
    success: true,
    count: saved.length,
    found: allLoads.length,
    loads: saved,
    requests,
  }
}

// =============================================================================
// СОХРАНЕНИЕ В КЭШ (без rawJson и без контактов)
// =============================================================================

async function saveToCache(rawLoads: any[]): Promise<any[]> {
  const saved: any[] = []
  const now = new Date()

  for (const item of rawLoads) {
    try {
      const atiId = String(item.id)

      const existing = await prisma.atiCache.findUnique({
        where: { atiLoadId: atiId },
      })
      if (existing) {
        // Обновляем только scannedAt для "new" записей
        if (existing.status === "new") {
          await prisma.atiCache.update({
            where: { atiLoadId: atiId },
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
// ПРОВЕРКА АКТУАЛЬНОСТИ ГРУЗА НА ATI (временно пропускаем)
// =============================================================================

async function checkAtiLoadActual(_atiLoadId: string): Promise<boolean> {
  // Ранее здесь был запрос к /loads/{id}, который часто давал 404.
  // Пока пропускаем проверку, чтобы не блокировать импорт.
  return true
}

// =============================================================================
// ПОЛУЧЕНИЕ КОНТАКТОВ ФИРМЫ (ТОЛЬКО ПО ЗАПРОСУ ПОЛЬЗОВАТЕЛЯ)
// =============================================================================

async function fetchFirmContacts(firmId: string | number) {
  if (!ATI_TOKEN) {
    return {
      phone: null as string | null,
      name: null as string | null,
      email: null as string | null,
    }
  }

  try {
    const res = await fetch(`https://api.ati.su/v1.0/firms/${firmId}`, {
      headers: {
        Authorization: `Bearer ${ATI_TOKEN}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      return { phone: null, name: null, email: null }
    }

    const firmData = await res.json()
    let phone: string | null = null
    let name: string | null = null
    let email: string | null = null

    if (Array.isArray(firmData.contacts) && firmData.contacts.length > 0) {
      const contact = firmData.contacts[0]
      if (contact?.name) name = contact.name

      if (Array.isArray(contact?.phones)) {
        const phones = contact.phones
          .map((p: any) => p.number || p.phone)
          .filter(Boolean)
        if (phones.length > 0) phone = phones.join(", ")
      }

      if (Array.isArray(contact?.emails)) {
        email = contact.emails[0]?.email || null
      }
    }

    if (!phone && firmData.phone) phone = firmData.phone
    if (!name && firmData.contact_name) name = firmData.contact_name

    return { phone, name, email }
  } catch (error) {
    console.error("[fetchFirmContacts] Error:", error)
    return { phone: null, name: null, email: null }
  }
}

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

  const where: any = { status }

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
    items = items.filter((item) => {
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

export async function getAtiStats() {
  const total = await prisma.atiCache.count()
  const imported = await prisma.atiCache.count({ where: { status: "imported" } })
  const expired = await prisma.atiCache.count({ where: { status: "expired" } })
  const fresh = total - imported - expired

  const now = new Date()
  const soonThreshold = new Date(now.getTime() + 6 * 60 * 60 * 1000) // 6 часов
  const expiringSoon = await prisma.atiCache.count({
    where: {
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
// ИМПОРТ ГРУЗА В ПЕСОЧНИЦУ (БЕЗ создания Order)
// =============================================================================

export async function importAtiLoadToOrder(
  cacheId: string,
  opts?: { fetchContacts?: boolean },
) {
  try {
    const cache = await prisma.atiCache.findUnique({
      where: { id: cacheId },
    })

    if (!cache) {
      return { success: false, error: "Запись в кэше не найдена" }
    }

    const atiLoadId = cache.atiLoadId
    if (!atiLoadId) {
      return { success: false, error: "У записи нет atiLoadId" }
    }

    // Уже импортирован? Возвращаем то, что есть
    if (cache.status === "imported") {
      return {
        success: true,
        cacheId,
        alreadyImported: true,
        contact: {
          phone: cache.contactPhone,
          name: cache.contactName,
          email: null,
          firmName: cache.firmName,
          firmId: cache.firmId ? String(cache.firmId) : null,
        },
      }
    }

    // Проверка актуальности (пока всегда true)
    const actual = await checkAtiLoadActual(atiLoadId)
    if (!actual) {
      await prisma.atiCache.update({
        where: { id: cacheId },
        data: { status: "expired" },
      })
      return {
        success: false,
        expired: true,
        error: "Груз на ATI.su уже неактуален или снят",
        cacheId,
      }
    }

    // Получаем контакты фирмы (по запросу)
    let contactPhone: string | null = cache.contactPhone || null
    let contactName: string | null = cache.contactName || null
    let contactEmail: string | null = null

    if (opts?.fetchContacts && (!contactPhone || !contactName) && cache.firmId) {
      const { phone, name, email } = await fetchFirmContacts(cache.firmId)
      contactPhone = contactPhone || phone
      contactName = contactName || name
      contactEmail = contactEmail || email
    }

    await prisma.atiCache.update({
      where: { id: cacheId },
      data: {
        status: "imported",
        contactPhone,
        contactName,
      },
    })

    return {
      success: true,
      cacheId,
      contact: {
        phone: contactPhone,
        name: contactName,
        email: contactEmail,
        firmName: cache.firmName,
        firmId: cache.firmId ? String(cache.firmId) : null,
      },
    }
  } catch (error: any) {
    console.error("[importAtiLoadToOrder] Error:", error)
    return { success: false, error: error.message || "Ошибка импорта" }
  }
}

// =============================================================================
// ЭКСПОРТЫ
// =============================================================================

export function getCitiesList() {
  return CITIES
}

export { CITIES, ALL_HUB_IDS, DEFAULT_FILTERS }
export type { ScanFilters }