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
import { plainPlace, placeWithoutFacility } from "@/lib/geo/nominatim"
import { canonicalCityName } from "@/lib/logist-mobile/city-norm"

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
/** Пауза перед повтором, если геокодер ответил «слишком часто». */
const RETRY_PAUSE_MS = Number(process.env.GEOCODE_RETRY_PAUSE_MS ?? 2500)

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

/**
 * Пауза после ответа «слишком часто».
 *
 * Было: рекурсивный повтор без ограничения — на 16 адресах боевого пула
 * геокодер отвечал 429, и функция уходила в бесконечный цикл «пауза → повтор».
 * Прогрев справочника висел десять минут, а запрос приложения мог так и не
 * ответить. Теперь повтор один, после него Nominatim на минуту исключается из
 * работы, и координаты добирает Photon.
 */
let nominatimBlockedUntil = 0
const NOMINATIM_BLOCK_MS = 60_000

async function geocodeNominatimOnce(
  address: string,
  attempt = 0,
  /**
   * Ограничивать ли поиск Россией.
   *
   * Ограничение нужно: без него «Москва» и «Минск» уезжают в чужие страны, а
   * «Шарапово» находится в Псковской области вместо нужной. Но оно же
   * обнуляло целые направления: Бердянск (Запорожская область) и Харцызск
   * (Донецкая Народная Республика) в данных OSM числятся за Украиной, и
   * страна «Россия» их вырезала — груз оставался без координат, хотя город
   * есть. Замер: «Бердянск, Запорожская область» без countrycodes находит
   * город 46.756, 36.789; с countrycodes=ru — ноль ответов.
   *
   * Поэтому второй проход идёт без ограничения: если в России ничего нет,
   * точка в другой стране лучше, чем отсутствие точки — расстояние до неё
   * считается так же.
   */
  restrictCountry = true,
): Promise<Coordinates | null> {
  if (Date.now() < nominatimBlockedUntil) return null
  // Во втором проходе «Россия» к запросу не приписываем: «Бердянск,
  // Запорожская область, Россия» геокодер честно не находит нигде.
  const query = restrictCountry
    ? /росси/i.test(address)
      ? address
      : `${address}, Россия`
    : address

  try {
    const url = new URL(NOMINATIM_URL)
    url.searchParams.set("q", query)
    url.searchParams.set("format", "json")
    url.searchParams.set("limit", "1")
    if (restrictCountry) url.searchParams.set("countrycodes", "ru")

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ru" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    // 429/503 — «слишком часто». Живой замер: пачки точек считаются
    // параллельно, и часть ответов приходила именно так — города молча
    // оставались без координат (Омск, Абакан, Улан-Удэ). Один повтор с
    // паузой их возвращает.
    if (response.status === 429 || response.status === 503) {
      nominatimBlockedUntil = Date.now() + NOMINATIM_BLOCK_MS
      if (attempt >= 1) return null
      await sleep(RETRY_PAUSE_MS)
      return geocodeNominatimOnce(address, attempt + 1)
    }
    if (!response.ok) return null

    const data = await response.json()
    if (!Array.isArray(data) || data.length === 0) {
      // В России не нашлось — пробуем без ограничения по стране (см. выше).
      return restrictCountry ? geocodeNominatimOnce(address, attempt, false) : null
    }

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

/** Nominatim с одним повтором на «слишком часто». */
async function geocodeNominatim(address: string): Promise<Coordinates | null> {
  return geocodeNominatimOnce(address)
}

/**
 * Варианты одного адреса для геокодера — от точного к грубому.
 *
 * Зачем варианты: точки ATI приходят как «Шелангер п. (Звениговский р-н),
 * Республика Марий Эл» или «Москва, Москва (регион)». Сырую строку геокодер
 * понимает хуже очищенной — замеры: «Шелангер п. …» — ноль ответов, «Москва,
 * Москва (регион), Россия» — Новая Москва в Приморском крае, «Москва, Москва,
 * Россия» — сама Москва. Поэтому сначала пробуем очищенный вариант, затем
 * сырой, и напоследок — один населённый пункт без улицы: точность ниже, зато
 * точка есть, и цепочка плеч считается.
 *
 * Регион в строке оставляем: без него голое «Шарапово» уводит в Псковскую
 * область, где есть одноимённое село.
 */
function addressVariants(address: string): string[] {
  const base = address.replace(/\s+/g, " ").trim()
  const plain = plainPlace(base)

  const out: string[] = []
  // Объект внутри адреса («аэропорт Стригино», «нефтегазоконденсатное
  // месторождение») — не населённый пункт. Замер: «Нижний Новгород аэропорт
  // Стригино, Нижегородская область» — ноль ответов, «Нижний Новгород,
  // Нижегородская область» — город. Пробуем такой вариант первым.
  const withoutFacility = placeWithoutFacility(base)
  if (withoutFacility && withoutFacility !== base) {
    const plainFacility = plainPlace(withoutFacility)
    if (plainFacility) out.push(plainFacility)
    if (!out.includes(withoutFacility)) out.push(withoutFacility)
  }
  // Сначала очищенный вариант, и только потом сырой. Замер: «Москва, Москва
  // (регион), Россия» геокодер отвечает Новой Москвой в Приморском крае, а
  // «Москва, Москва, Россия» — самой Москвой. То же и с приставками: сырой
  // «г. Тулун, ул. Ленина 5» он понимает как улицу Ленина в Омске.
  if (plain) out.push(plain)
  if (base && !out.includes(base)) out.push(base)

  // Последний шанс — только населённый пункт. «Ярославль, Ул. Докучалова 12»
  // геокодер не знает совсем (такой улицы нет в его данных), зато центр
  // Ярославля знает: для расчёта «по пути» это лучше, чем null.
  const parts = (plain || base).split(",").map((part) => part.trim()).filter(Boolean)
  const cityOnly = parts.find(
    (part) =>
      !/^\d/.test(part) &&
      !/^(ул|улица|пр-?кт?|проспект|пр-?т|пер|переулок|ш|шоссе|д|дом)\.?(?![a-zа-яё])/i.test(part) &&
      !/^(обл|область|край|респ|республика|ао)\.?(?![a-zа-яё])/i.test(part),
  )
  if (cityOnly && !out.includes(cityOnly)) out.push(cityOnly)

  // Адрес без запятых: «Москва улица Складская 6», «Ярославль машиностроителей
  // 3». ATI иногда склеивает город и улицу через пробел, и тогда все варианты
  // выше — это целая строка, которую геокодер не знает. Берём первое слово:
  // для расчёта расстояний центр города лучше, чем «нет координат» — именно
  // так груз с таким адресом выпадал из планирования.
  const firstToken = base.split(/\s+/)[0] ?? ""
  if (
    !base.includes(",") &&
    firstToken.length >= 3 &&
    !/^\d/.test(firstToken) &&
    !/^(ул|улица|пр-?кт?|проспект|пр-?т|пер|переулок|ш|шоссе|д|дом)\.?(?![a-zа-яё])/i.test(firstToken) &&
    !out.includes(firstToken)
  ) {
    out.push(firstToken)
  }

  // Город переименован («Свердловск» → «Екатеринбург», «Горький» → «Нижний
  // Новгород»): геокодер знает только нынешнее название, поэтому пробуем его,
  // пока не поздно. Регион из исходной строки сохраняем — он не менялся.
  const current = canonicalCityName(cityOnly ?? base)
  if (current) {
    const region = (plain || base)
      .split(",")
      .map((part) => part.trim())
      .find((part) => /(обл|область|край|респ|республика)\b/i.test(part))
    const withRegion = region ? `${current}, ${region}` : current
    if (!out.includes(withRegion)) out.push(withRegion)
    if (!out.includes(current)) out.push(current)
  }

  return out.filter((value, index) => value.length >= 3 && out.indexOf(value) === index)
}

/**
 * Запасной геокодер — Photon (собственный сервер OSM, без ключа).
 *
 * Зачем третий провайдер. Nominatim на пачке адресов отвечает 429 («слишком
 * часто»), и город молча остаётся без координат: живой прогон на боевом пуле —
 * 16 городов, которые не нашлись ни с первого раза, ни с очищенным названием
 * («Армянск г., Республика Крым», «Дружный сп., Нижегородская область»).
 * С геокодером Photon те же адреса находятся за один запрос.
 *
 * Почему ответ проверяется, а не берётся на веру: Photon на «Бердянск» отдаёт
 * Бердянскую улицу в Краснодарском крае, а на «Харцызск» — Харцызскую улицу.
 * Такая точка хуже отсутствия точки: маршрут «поехал» бы в другое место.
 * Поэтому принимаем только населённый пункт (osm_key = place, тип город/село)
 * и только если имя совпадает с тем, что просили.
 */
const PHOTON_URL = "https://photon.komoot.io/api/"
/** Типы населённых пунктов Photon: улицы и районы не принимаем. */
const PHOTON_PLACE_TYPES = new Set(["city", "town", "village", "hamlet", "locality"])
const PHOTON_COUNTRIES = new Set(["ru", "by", "kz", "ua"])

/** Сравнение названий: регистр, ё/е и хвостовые приставки не важны. */
function samePlaceName(left: string, right: string): boolean {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/\s+(г|сп|вп|п|с|д|пос|пгт|рп|нп)\.?$/i, "")
      .replace(/[^\wа-я]+/g, " ")
      .trim()
  return norm(left) === norm(right)
}

async function geocodePhoton(address: string): Promise<Coordinates | null> {
  // Спрашиваем два варианта и пять ответов: с limit=1 Photon на «Дружный»
  // отдаёт одноимённую улицу, а сам посёлок оказывается вторым. Ответ
  // проверяется, поэтому лишние строки — не риск, а шанс найти населённый пункт.
  const variants = addressVariants(address)
  const queries = [...new Set([variants[variants.length - 1], variants[0]].filter(Boolean) as string[])]
  for (const query of queries) {
    try {
      const url = new URL(PHOTON_URL)
      url.searchParams.set("q", query)
      url.searchParams.set("limit", "5")
      const response = await fetch(url.toString(), {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "ru" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) continue
      const data = await response.json()
      const wanted = (query.split(",")[0] ?? query).trim()
      for (const feature of data?.features ?? []) {
        const properties = feature?.properties ?? {}
        if (properties.osm_key !== "place") continue
        if (!PHOTON_PLACE_TYPES.has(String(properties.osm_value))) continue
        if (!PHOTON_COUNTRIES.has(String(properties.countrycode ?? "").toLowerCase())) continue
        // Имя обязано совпасть: «Бердянск» ≠ «Бердянская улица».
        if (!samePlaceName(String(properties.name ?? ""), wanted)) continue
        const [lng, lat] = feature.geometry?.coordinates ?? []
        const coords = { lat: Number(lat), lng: Number(lng) }
        if (isCoordinates(coords)) return coords
      }
    } catch (error) {
      console.error("[geocode] ошибка запроса к Photon:", error)
    }
  }
  return null
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

  // Последний шанс: Photon. Источник честно называется «nominatim» —
  // в интерфейсе это «данные OpenStreetMap», а не отдельная строка правды
  // про то, какой из двух серверов OSM ответил.
  const photon = await geocodePhoton(address)
  if (photon) return { coords: photon, source: "nominatim" }

  return { coords: null, source: "none" }
}

/** Координаты для списка адресов + источник каждой точки. */
/**
 * Кэш в памяти процесса: адрес → координаты или «не найден».
 *
 * Зачем: промахи (адрес не распознан) в постоянный GeoCache не попадают —
 * там только найденные координаты. Из-за этого каждый запрос заново шёл в
 * Nominatim, с паузой между адресами, и /api/m/route отвечал 13–17 секунд:
 * приложение водителя опрашивает его каждые 30 секунд.
 *
 * «Не найден» тоже результат: держим его 10 минут и не дёргаем чужой сервис
 * повторно. Найденные адреса живут в памяти 30 минут, постоянный GeoCache при
 * этом остаётся источником правды для новых процессов.
 */
const HIT_TTL_MS = 30 * 60_000
const MISS_TTL_MS = 10 * 60_000
const memoryCache = new Map<string, { at: number; coords: Coordinates | null }>()

function memoryGet(key: string): { hit: boolean; coords: Coordinates | null } {
  const entry = memoryCache.get(key)
  if (!entry) return { hit: false, coords: null }
  const ttl = entry.coords ? HIT_TTL_MS : MISS_TTL_MS
  if (Date.now() - entry.at > ttl) {
    memoryCache.delete(key)
    return { hit: false, coords: null }
  }
  return { hit: true, coords: entry.coords }
}

function memorySet(key: string, coords: Coordinates | null): void {
  // Простейшее ограничение размера: процесс живёт недолго, но разрастаться не даём
  if (memoryCache.size > 500) memoryCache.clear()
  memoryCache.set(key, { at: Date.now(), coords })
}

/**
 * Сброс памяти процесса геокодера — только для тестов.
 *
 * Тесты провайдеров и изоляции делят один процесс: первый тест кладёт адрес
 * в memoryCache (в том числе как «не найден»), и остальные получают
 * memory-hit без единого запроса к провайдеру — тест проверял бы кэш,
 * а не геокодер. Постоянный GeoCache этот сброс НЕ трогает.
 */
export function resetGeocodeMemoryForTests(): void {
  memoryCache.clear()
}

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
    const key = normalizeKey(address)

    // 1а. Память процесса — в том числе «не найден»
    const memory = memoryGet(key)
    if (memory.hit) {
      result.set(address, memory.coords)
      sources.set(address, memory.coords ? "cache" : "none")
      continue
    }

    const hit = byKey.get(key)
    if (hit) {
      memorySet(key, hit)
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
    memorySet(normalizeKey(address), coords)
    if (!coords) continue

    try {
      // org-audit: manual — GeoCache общий справочник адресов (города), данные
      // организации к нему не применяются: запись одинакова для всех
      // Статус и источник пишутся всегда: без них запись кэша нельзя ни
      // проверить, ни отличить проверенную точку от догадки геокодера.
      // В расчёте участвуют только `verified` (см. lib/routing/geo/places.ts).
      await prisma.geoCache.upsert({
        where: { address: normalizeKey(address) },
        create: {
          address: normalizeKey(address),
          lat: coords.lat,
          lng: coords.lng,
          source: String(source ?? "geocoder"),
          status: "unverified",
          checkedAt: new Date(),
        },
        update: {
          lat: coords.lat,
          lng: coords.lng,
          source: String(source ?? "geocoder"),
          status: "unverified",
          checkedAt: new Date(),
        },
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
