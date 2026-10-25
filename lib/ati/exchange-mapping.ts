// lib/ati/exchange-mapping.ts
// Грузы ОБЩЕЙ биржи ATI (внутренний поиск сайта loads.ati.su) → внутренний
// формат сканера. Чистый модуль без Prisma и без сети — покрывается тестами.
//
// Зачем отдельно от boards-mapping: у двух источников разная форма ответа.
// boards (официальный API) отдаёт CityId без имени, Latitude/Longitude и
// только FirmId. Общая биржа отдаёт сразу город с координатами (lat/lon),
// название фирмы и рейтинг — но другие имена полей. Сведение в один формат
// нужно, чтобы помощник сборки не знал, откуда пришёл груз.
//
// Источник помечается полем source: «boards» — площадки организации,
// «exchange» — общая биржа. В интерфейсе это видно, оба источника работают
// независимо и не мешают друг другу.

/** Типы кузова ATI (id из сайтовой выдачи) → подпись. */
const CAR_TYPES: Record<string, string> = {
  "1": "Тент",
  "2": "Фургон",
  "3": "Цельнометаллический",
  "4": "Рефрижератор",
  "5": "Изотермический",
  "6": "Бортовой",
  "7": "Самосвал",
  "8": "Контейнеровоз",
  "9": "Автовоз",
  "10": "Негабарит",
  "11": "Тент-крышка",
  "12": "Микроавтобус",
}

/** Типы погрузки/выгрузки (id) → подпись. */
const LOADING_TYPES: Record<string, string> = {
  "1": "Верхняя",
  "2": "Боковая",
  "3": "Задняя",
  "4": "Любая",
  "5": "Верхняя/боковая",
  "6": "Задняя/боковая",
}

export type ExchangePoint = { lat: number; lng: number } | null

/** Груз общей биржи во внутреннем формате (как у boards-mapping). */
export type ExchangeMappedLoad = {
  id: string
  firm: { id: string | null; name: string | null }
  loading: {
    location: { city: string | null; region: string }
    firstDate: string | null
    point: ExchangePoint
  }
  unloading: {
    location: { city: string | null; region: string }
    point: ExchangePoint
  }
  route: { distance: number }
  load: { weight: number; volume: number | null; cargoType: string }
  rate: {
    priceNds: number | undefined
    priceNoNds: number | undefined
    price: number | undefined
  }
  truck: { carTypes: string[]; loadingTypes: string[] }
  /** Откуда груз: общая биржа, а не площадка организации */
  source: "exchange"
  /** Площадки, на которых опубликован груз (для честной подписи в UI) */
  boards: string[]
}

/** Корректная ли точка (0/0 в ответе значит «неизвестно»). */
function point(loc: any): ExchangePoint {
  const lat = Number(loc?.lat)
  const lng = Number(loc?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat === 0 && lng === 0) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

/** Город и регион из location общей биржи. */
function location(loc: any): { city: string | null; region: string } {
  const city = loc?.city ? String(loc.city).trim() : null
  // region в сайтовой выдаче часто пустой — тогда берём его из полного имени
  // («Ярославль, Ярославская область, Россия»), иначе «город, » выглядит
  // криво и ломает сравнение ключей городов.
  let region = loc?.region ? String(loc.region).trim() : ""
  if (!region && loc?.fullGeoName) {
    const parts = String(loc.fullGeoName)
      .split(",")
      .map((part: string) => part.trim())
      .filter(Boolean)
    if (parts.length > 1) region = parts[1]
  }
  return { city: city || null, region }
}

/**
 * Груз общей биржи → внутренний формат.
 *
 * Вес приходит в тоннах (как и в boards), цену берём с НДС, затем без НДС,
 * затем «как есть» — тот же порядок, что в boards-mapping, чтобы ставка не
 * терялась молча.
 */
export function mapExchangeLoad(raw: any): ExchangeMappedLoad {
  const from = location(raw?.loading?.location)
  const to = location(raw?.unloading?.location)

  const payment = raw?.rate || {}
  const price =
    Number(payment.SumWithNDS) ||
    Number(payment.priceNds) ||
    Number(payment.priceNoNds) ||
    Number(payment.price) ||
    0

  const carTypes = Array.isArray(raw?.truck?.carTypes)
    ? raw.truck.carTypes.map((id: unknown) => CAR_TYPES[String(id)] || `Кузов #${id}`)
    : []
  const loadingTypes = Array.isArray(raw?.truck?.loadingTypes)
    ? raw.truck.loadingTypes.map(
        (id: unknown) => LOADING_TYPES[String(id)] || `Погрузка #${id}`,
      )
    : []

  const boards = Array.isArray(raw?.boards)
    ? raw.boards.map((board: any) => String(board?.name ?? board?.id ?? "")).filter(Boolean)
    : []

  return {
    id: String(raw?.id ?? ""),
    // Фрахтователь в общей бирже приходит сразу с именем — телефон добираем
    // кнопкой «Узнать телефон», как и для грузов площадок.
    firm: {
      id: raw?.firm?.id ? String(raw.firm.id) : null,
      name: raw?.firm?.name ? String(raw.firm.name) : null,
    },
    loading: {
      location: from,
      firstDate: raw?.loading?.firstDate ? String(raw.loading.firstDate) : null,
      point: point(raw?.loading?.location),
    },
    unloading: {
      location: to,
      point: point(raw?.unloading?.location),
    },
    route: { distance: Number(raw?.route?.distance) || 0 },
    load: {
      weight: Number(raw?.load?.weight) || 0,
      volume: raw?.load?.volume ? Number(raw.load.volume) : null,
      cargoType: raw?.load?.cargoType ? String(raw.load.cargoType) : "Груз",
    },
    rate: {
      priceNds: Number(payment.priceNds) || undefined,
      priceNoNds: Number(payment.priceNoNds) || undefined,
      price: price || undefined,
    },
    truck: { carTypes, loadingTypes },
    source: "exchange",
    boards,
  }
}

/** Фильтр поиска по общей бирже — форма, которую принимает сайт. */
export type ExchangeFilterParams = {
  /** id города ATI («откуда»); 0/undefined — без фильтра */
  fromCityId?: number | null
  toCityId?: number | null
  fromRadiusKm?: number
  toRadiusKm?: number
}

/**
 * Тело фильтра для POST /webapi/v1.0/loads/search.
 *
 * `type: 1` — искать по городу (0 ищет по точке), `exact_only: true` —
 * только точный город, иначе радиус. Радиус 0 означает «без радиуса».
 */
export function buildExchangeFilter(params: ExchangeFilterParams): Record<string, unknown> {
  const filter: Record<string, unknown> = { sorting_type: 2 }

  const fromId = Number(params.fromCityId) || 0
  const toId = Number(params.toCityId) || 0
  const fromRadius = Math.max(0, Number(params.fromRadiusKm) || 0)
  const toRadius = Math.max(0, Number(params.toRadiusKm) || 0)

  if (fromId > 0) {
    filter.from = {
      id: fromId,
      type: 1,
      radius: fromRadius,
      exact_only: fromRadius === 0,
    }
  }
  if (toId > 0) {
    filter.to = {
      id: toId,
      type: 1,
      radius: toRadius,
      exact_only: toRadius === 0,
    }
  }
  return filter
}

/** Сколько грузов просим за одну страницу: сайт отдаёт страницами. */
export const EXCHANGE_ITEMS_PER_PAGE = 50

/** Сколько страниц обходим за один сбор (защита от бесконечного цикла). */
export const EXCHANGE_MAX_PAGES = 20

/** Адрес внутреннего поиска сайта: он же используется браузером на loads.ati.su. */
export const EXCHANGE_SEARCH_URL = "https://loads.ati.su/webapi/v1.0/loads/search"
