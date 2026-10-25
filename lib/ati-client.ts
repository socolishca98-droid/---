// lib/ati-client.ts
// ATI.su интеграция — без лишних логов и без создания Order

import { prisma } from "@/lib/prisma"
import { atiFetch, atiHeaders, atiHttpError, ATI_API_BASE } from "./ati/http"
import { resolveAtiCities } from "./ati/ati-city-resolver"
import { mapBoardsLoad, collectCityIds } from "./ati/boards-mapping"
import { geocodeAddresses } from "./geo/geocode"
import { searchExchange } from "./ati/exchange-client"
import { loadMatchesGeo, type GeoQuery } from "./ati/search-geo"

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

  // Тип кузова: ATI отдаёт его в truck.carTypes — фильтруем по ответу
  if (filters.truckTypes && filters.truckTypes.length > 0) {
    const carTypes: string[] = Array.isArray(item.truck?.carTypes) ? item.truck.carTypes : []
    const haystack = carTypes.join(" ").toLowerCase()
    const wanted = filters.truckTypes.some((type) => haystack.includes(String(type).toLowerCase()))
    if (!wanted) return false
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

/**
 * Официальный метод: площадки, на которых организация может видеть грузы
 * (GET /v2/boards/public/boards/canView). Поиск грузов через API поддержан
 * ТОЛЬКО по персональным площадкам — документированное ограничение ATI.SU.
 */
async function fetchBoardIds(token: string, organizationId: string): Promise<string[]> {
  const boards = await fetchBoardInfo(token, organizationId)
  return boards.map((board) => board.id)
}

/** Площадки организации с названиями — чтобы честно показать источник грузов. */
export async function fetchBoardInfo(
  token: string,
  organizationId: string,
): Promise<Array<{ id: string; name: string }>> {
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
    .map((board: any) => ({
      id: String(board?.id ?? board?.Id ?? ""),
      name: String(board?.name ?? board?.Name ?? "").trim(),
    }))
    .filter((board: { id: string }) => board.id.length > 0)
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

  // Источник грузов: "boards" — площадки организации (официальный API ATI),
  // "exchange" — общая биржа (поиск сайта loads.ati.su), "both" — оба сразу.
  // Источники независимы: один может не работать, второй продолжает.
  const source: "boards" | "exchange" | "both" =
    params?.source === "exchange" || params?.source === "both" ? params.source : "boards"

  try {
    // Ручной поиск
    if (params?.manualMode) {
      if (source === "both") {
        const [boardsResult, exchangeResult] = await Promise.all([
          manualSearch(params, customFilters, token, organizationId).catch((error: any) => ({
            success: false,
            error: error?.message ?? "Площадки не ответили",
          })),
          exchangeManualSearch(params, customFilters, token, organizationId).catch((error: any) => ({
            success: false,
            error: error?.message ?? "Биржа не ответила",
          })),
        ])
        const boardLoads: any[] = (boardsResult as any)?.loads ?? []
        const exchangeLoads: any[] = (exchangeResult as any)?.loads ?? []
        const seen = new Set(boardLoads.map((load: any) => String(load?.id)))
        const merged = [...boardLoads, ...exchangeLoads.filter((load: any) => !seen.has(String(load?.id)))]
        return {
          success: Boolean((boardsResult as any)?.success || (exchangeResult as any)?.success),
          count: merged.length,
          found: merged.length,
          loads: merged,
          requests: 2,
          // По какому источнику сколько нашли — интерфейс показывает это словами
          bySource: {
            boards: (boardsResult as any)?.found ?? 0,
            exchange: (exchangeResult as any)?.found ?? 0,
          },
          errors: [
            (boardsResult as any)?.error,
            (exchangeResult as any)?.error,
          ].filter(Boolean),
        }
      }
      if (source === "exchange") {
        return await exchangeManualSearch(params, customFilters, token, organizationId)
      }
      return await manualSearch(params, customFilters, token, organizationId)
    }

    const boards = await fetchBoardIds(token, organizationId)
    const rawLoads = await fetchLoadsByBoards(token, organizationId)
    const cities = await resolveAtiCities(collectCityIds(rawLoads))
    let loads = rawLoads.map((load) => mapBoardsLoad(load, cities))

    // Общая биржа в плановом скане: добираем грузы вокруг городов профиля,
    // которых на площадках нет. Ошибка биржи не должна ронять скан площадок.
    let exchangeFound = 0
    if (source === "exchange" || source === "both") {
      for (const cityId of profileCityIds.slice(0, 3)) {
        try {
          const exchange = await searchExchange(token, organizationId, {
            fromCityId: cityId,
            fromRadiusKm: Number(params?.radius) || 300,
            maxPages: 4,
          })
          exchangeFound += exchange.loads.length
          loads = loads.concat(exchange.loads as any[])
        } catch (error) {
          console.error("[scanAtiLoads] общая биржа не ответила:", error)
        }
      }
    }

    const picked: any[] = []
    for (const load of loads) {
      if (cityKeys.length > 0) {
        const fromKey = normalizeLoadFromToCityKey(load)
        const toKey = normalizeLoadToCityKey(load)
        // Город профиля — это и «откуда», и «куда»: груз, который везёт домой
        // в город базы, маршруту нужен не меньше, чем груз из базы. Раньше
        // матчился только город отправления, и обратка в кэш не попадала.
        const hit =
          (fromKey !== null && cityKeys.includes(fromKey)) ||
          (toKey !== null && cityKeys.includes(toKey))
        if (!hit) continue
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
      exchangeFound,
    }
  } catch (e: any) {
    console.error("[scanAtiLoads] Fatal error:", e)
    return { success: false, error: e.message || "ATI scan failed" }
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
 * Живой поиск по площадкам: «Откуда / Куда / радиус / вес».
 *
 * Гео-фильтр — как на сайте ATI: точное совпадение города ИЛИ попадание
 * точки груза в радиус от центра запрошенного города. Раньше работало
 * только точное совпадение, и запрос «Ярославль» не находил груз,
 * выгружающийся в Корюково (8 км от Ярославля), — город в грузе назван
 * иначе. Радиус из интерфейса при этом молча игнорировался.
 */
async function manualSearch(
  params: any,
  filters: ScanFilters,
  token: string,
  organizationId: string,
) {
  const fromCityKey = normalizeGeoToCityKey(params.fromGeo)
  const toCityKey = normalizeGeoToCityKey(params.toGeo)
  const fromRadiusKm = Math.max(0, Number(params.fromRadius) || 0)
  const toRadiusKm = Math.max(0, Number(params.toRadius) || 0)

  // Центры городов запроса: без них радиус не с чем сравнивать. Геокодер
  // общий, с постоянным кэшем (GeoCache) — повторный вопрос бесплатный.
  const geoName = (geo: any): string | null => {
    if (!geo) return null
    const name = geo.fullName || geo.name || null
    return name ? String(name).trim() : null
  }
  const fromName = geoName(params.fromGeo)
  const toName = geoName(params.toGeo)
  const geoQueries = [fromName, toName].filter((v): v is string => Boolean(v))
  const geoPoints =
    geoQueries.length > 0 ? await geocodeAddresses(geoQueries) : new Map<string, { lat: number; lng: number } | null>()
  const centerOf = (name: string | null) =>
    name ? geoPoints.get(name) ?? null : null

  const fromQuery: GeoQuery = {
    cityKey: fromCityKey,
    center: centerOf(fromName),
    radiusKm: fromRadiusKm,
  }
  const toQuery: GeoQuery = {
    cityKey: toCityKey,
    center: centerOf(toName),
    radiusKm: toRadiusKm,
  }

  const rawLoads = await fetchLoadsByBoards(token, organizationId)
  const cities = await resolveAtiCities(collectCityIds(rawLoads))
  const loads = rawLoads.map((load) => mapBoardsLoad(load, cities))
  const allLoads: any[] = []
  let byCity = 0
  let byRadius = 0
  for (const load of loads) {
    const match = loadMatchesGeo(load, fromQuery, toQuery)
    if (!match.ok) continue
    if (match.fromReason === "city" || match.toReason === "city") byCity += 1
    else byRadius += 1
    if (addIfNew(load, filters)) allLoads.push(load)
  }

  const saved = await saveToCache(allLoads, organizationId)
  return {
    success: true,
    count: saved.length,
    found: allLoads.length,
    loads: saved,
    requests: 1,
    // Честная расшифровка выдачи: сколько нашли по городу, сколько — по радиусу
    matched: { byCity, byRadius },
    // Центр не нашёлся — радиус не применился, и это надо сказать словами
    // Предупреждаем ТОЛЬКО если город запрошен, но его центр не нашёлся:
    // пустое поле «Откуда» — это не ошибка, радиус там и не нужен.
    geoWarning:
      fromQuery.cityKey && fromRadiusKm > 0 && !fromQuery.center
        ? "Не удалось определить центр города «Откуда» — искали только по точному названию"
        : toQuery.cityKey && toRadiusKm > 0 && !toQuery.center
          ? "Не удалось определить центр города «Куда» — искали только по точному названию"
          : null,
  }
}

/**
 * Живой поиск по ОБЩЕЙ бирже (тот же поиск, что на loads.ati.su).
 *
 * Отличие от manualSearch (площадки): город задаётся идентификатором ATI,
 * гео-фильтр берёт на себя сайт — радиус работает по-настоящему, а не по
 * совпадению названий. Ответ сразу с именем фрахтователя.
 *
 * Город запроса: id приходит из гео-подсказки (/api/ati/geo). Если id нет,
 * пробуем найти его в справочнике городов по названию — иначе биржа не поймёт
 * фильтр, и лучше сказать об этом словами, чем молча вернуть всю Россию.
 */
async function exchangeManualSearch(
  params: any,
  filters: ScanFilters,
  token: string,
  organizationId: string,
) {
  const fromId = Number(params?.fromCityId ?? params?.fromGeo?.id) || 0
  const toId = Number(params?.toCityId ?? params?.toGeo?.id) || 0
  const fromName = params?.fromGeo?.name || params?.fromGeo?.fullName || ""
  const toName = params?.toGeo?.name || params?.toGeo?.fullName || ""

  const fromCityId = fromId || findCityIdByName(fromName)
  const toCityId = toId || findCityIdByName(toName)

  if (!fromCityId && !toCityId) {
    return {
      success: false,
      error: "Не удалось определить город для поиска по бирже — уточните его в подсказках",
    }
  }

  const exchange = await searchExchange(token, organizationId, {
    fromCityId,
    toCityId,
    fromRadiusKm: Number(params?.fromRadius) || 0,
    toRadiusKm: Number(params?.toRadius) || 0,
    maxPages: Number(params?.maxPages) || 20,
    pageStart: Number(params?.pageStart) || 1,
  })

  const picked: any[] = []
  for (const load of exchange.loads) {
    if (addIfNew(load, filters)) picked.push(load)
  }
  const pageStartUsed = Math.max(1, Number(params?.pageStart) || 1)

  const saved = await saveToCache(picked, organizationId)
  return {
    success: true,
    count: saved.length,
    found: picked.length,
    loads: saved,
    requests: exchange.requests,
    source: "exchange" as const,
    // Сколько грузов биржа обещает по этому фильтру — честный масштаб
    totalItems: exchange.totalItems,
    pages: exchange.pages,
    // До какой страницы дошли — следующим нажатием идём глубже
    nextPageStart: pageStartUsed + exchange.pages,
    flags: exchange.flags,
  }
}

/**
 * id города ATI по названию — из того же справочника, что использует гео.
 * Нужно, когда интерфейс прислал только текст («Ярославль»).
 */
function findCityIdByName(name: unknown): number | null {
  const text = String(name ?? "").trim().toLowerCase()
  if (!text) return null
  const first = text.split(",")[0].trim()
  const hit = CITIES.find((city: any) => {
    const cityName = city.name.toLowerCase()
    return cityName === first || cityName === text || cityName.startsWith(`${first} `)
  })
  return hit ? hit.atiId : null
}

// =============================================================================
// СОХРАНЕНИЕ В КЭШ (без rawJson и без контактов)
// =============================================================================

async function saveToCache(rawLoads: any[], organizationId: string): Promise<any[]> {
  const now = new Date()
  if (rawLoads.length === 0) return []

  // Один запрос вместо запроса на каждый груз: сбор региона тянет сотни
  // грузов, и поштучный findFirst превращал сбор в трехминутное ожидание.
  const ids = rawLoads.map((item) => String(item.id))
  // org-audit: ok — строки ищутся в накопленной базе своей организации
  const existingRows = await prisma.atiCache.findMany({
    where: { organizationId, atiLoadId: { in: ids } },
  })
  const existingById = new Map(existingRows.map((row: any) => [row.atiLoadId, row]))

  const toCreate: any[] = []
  const toUpdate: any[] = []

  for (const item of rawLoads) {
    const atiId = String(item.id)
    const existing = existingById.get(atiId)
    const isExchange = item.source === "exchange"

    if (existing) {
      // Обновляем только то, чего в записи ещё нет: точки, фрахтователь,
      // источник. scannedAt трогаем только у «new» — как и раньше.
      if (existing.status !== "new") continue
      const pointsJson = JSON.stringify({
        fromPoint: item.loading?.point ?? null,
        toPoint: item.unloading?.point ?? null,
        source: isExchange ? "exchange" : "boards",
      })
      const hasPoints = Boolean(item.loading?.point || item.unloading?.point)
      const needsPoints = hasPoints && (!existing.rawJson || !existing.rawJson.startsWith("{"))
      const needsFirm = !existing.firmId && item.firm?.id
      let needsSource = false
      if (isExchange && existing.rawJson) {
        try {
          const parsed = JSON.parse(existing.rawJson)
          needsSource = !parsed || typeof parsed !== "object" || !parsed.source
        } catch {
          needsSource = true
        }
      }
      if (!needsPoints && !needsFirm && !needsSource) continue

      toUpdate.push({
        id: existing.id,
        scannedAt: now,
        firmId: existing.firmId ?? (item.firm?.id ? String(item.firm.id) : null),
        rawJson: needsPoints ? pointsJson : undefined,
      })
      continue
    }

    const locFrom = item.loading?.location
    const locTo = item.unloading?.location
    const fromCity = locFrom?.city || locFrom?.cityName || "N/A"
    const fromRegion = locFrom?.region || locFrom?.region_name || ""
    const toCity = locTo?.city || locTo?.cityName || "N/A"
    const toRegion = locTo?.region || locTo?.region_name || ""
    const routeFrom = fromRegion && fromCity !== "N/A" ? `${fromCity}, ${fromRegion}` : fromCity
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

    toCreate.push({
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
      // Точные координаты точек погрузки/выгрузки: помощник берёт по ним
      // грузы "по пути" (геокодер мелкие сёла не знает)
      rawJson: JSON.stringify({
        fromPoint: item.loading?.point ?? null,
        toPoint: item.unloading?.point ?? null,
        // Откуда груз: общая биржа или площадка организации.
        source: isExchange ? "exchange" : "boards",
      }),
      scannedAt: now,
      expiresAt,
    })
  }

  // Новые грузы — одним запросом. Дубл внутри пачки (биржа иногда отдаёт
  // один груз дважды) отсекаем по atiLoadId, иначе createMany упадёт.
  const seen = new Set<string>()
  const uniqueCreate = toCreate.filter((row) => {
    if (seen.has(row.atiLoadId)) return false
    seen.add(row.atiLoadId)
    return true
  })
  if (uniqueCreate.length > 0) {
    try {
      // skipDuplicates не поддерживается схемой SQLite (каноничная схема
      // проекта), а дубли внутри пачки мы уже отсекли сами.
      await prisma.atiCache.createMany({ data: uniqueCreate })
    } catch (error) {
      console.error("[saveToCache] createMany:", error)
    }
  }
  for (const row of toUpdate) {
    try {
      await prisma.atiCache.update({ where: { id: row.id }, data: row })
    } catch (error) {
      console.error("[saveToCache] update:", error)
    }
  }

  // Возвращаем актуальные строки: и созданные, и обновлённые — интерфейсу
  // нужны точки и источник, а не только счётчики.
  const createdIds = uniqueCreate.map((row) => row.atiLoadId)
  const updatedIds = toUpdate.map((row) => row.id)
  if (createdIds.length === 0 && updatedIds.length === 0) return []
  const rows = await prisma.atiCache.findMany({
    where: {
      organizationId,
      OR: [{ atiLoadId: { in: createdIds } }, { id: { in: updatedIds } }],
    },
  })
  return rows.map((row: any) => decorateCacheRow(row))
}

/**
 * Строка кэша → удобный для интерфейса вид: точки погрузки/выгрузки и
 * источник груза достаются из rawJson. Нужно, чтобы живой поиск отдавал
 * грузы сразу пригодными для сборщика маршрутов, а не «сырой» json.
 */
function decorateCacheRow(row: any): any {
  if (!row || typeof row !== "object") return row
  let fromPoint = null
  let toPoint = null
  let source: "boards" | "exchange" = "boards"
  if (typeof row.rawJson === "string" && row.rawJson.startsWith("{")) {
    try {
      const parsed = JSON.parse(row.rawJson)
      fromPoint = parsed.fromPoint ?? null
      toPoint = parsed.toPoint ?? null
      if (parsed.source === "exchange") source = "exchange"
    } catch {
      /* битый rawJson — отдаём без точек, это не ошибка */
    }
  }
  const { rawJson: _rawJson, ...rest } = row
  return { ...rest, fromPoint, toPoint, source }
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