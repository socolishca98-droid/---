/**
 * Адрес → подсказки мест (OpenStreetMap Nominatim).
 *
 * Зачем: в настройках автопарка человек вводит адрес базы, а программа должна
 * по нему найти координаты стоянки. Без них помощник не считает, какие грузы
 * ближе, и подсказки городов теряют смысл.
 *
 * Особенность геокодера: он капризен к форме записи. «Ярославская обл. Ул 2-я
 * Суворовская 2» не находит НИЧЕГО, а «Ярославль 2-я Суворовская 2» находит
 * дом. Сокращённое «обл.» впереди адреса его путает. Поэтому если точный адрес
 * не дал результата, пробуем упрощённые варианты — от менее точного к более:
 * без региона, потом «улица + дом + город», потом просто город. Лучше показать
 * центр города, чем сказать «введите координаты вручную» и оставить человека
 * без подсказки.
 */

export type GeoItem = {
  label: string
  lat: number
  lng: number
  /** Насколько точно определили: дом, улица или только населённый пункт */
  precision: "house" | "street" | "city"
  /** Короткая подпись — первая значимая часть адреса (город или улица) */
  short: string
}

import { ATI_CITY_REGIONS, ATI_REGION_NAMES } from "@/lib/ati/ati-city-regions"

const NOMINATIM = "https://nominatim.openstreetmap.org/search"

/** Сокращения, которые геокодер не переваривает в начале адреса. */
const REGION_NOISE =
  /^[^,]*(обл\.|область|край|респ\.|республика|АО|автономный округ)(?![a-zа-яё])[.,]?\s*/i

/**
 * Служебные приставки в части адреса: «г. Тулун», «ул. Ленина 5», «д. 4».
 *
 * Зачем: геокодер на них спотыкается. Замер: «г. Тулун, ул. Ленина 5» он
 * понял как «улица Ленина, 5» и нашёл её в ОМСКЕ — регион вышел «Омская
 * область» вместо Иркутской. Тот же адрес без приставок — «Тулун, Ленина 5» —
 * он разбирает правильно. Поэтому приставки снимаем и пробуем такой вариант
 * адреса первым.
 */
const PART_NOISE =
  /^(г|город|гор|пос|поселок|пос\u0451лок|село|с|д|дом|кв|квартира|квартал|ул|улица|пр-?кт?|проспект|пр-?т|пер|переулок|ш|шоссе|рф|россия|российская\s+федерация)\.?(?![a-zа-яё])[\s.]*/i

/**
 * Населенный пункт без приставки типа и уточнения в скобках.
 *
 * Зачем: ATI пишет точки погрузки и выгрузки как «Среднесибирский п.» или
 * «Шелангер п. (Звениговский р-н)». Геокодер такую запись не понимает
 * совсем — замер: «Среднесибирский п., Россия» отдаёт ноль ответов, а
 * «Среднесибирский» находит поселок в Новосибирской области. Разница между
 * «точка есть» и «точки нет» — это разница между продолжением цепочки плеч
 * и обрывом маршрута на одном плече: «по пути» считается по координатам.
 *
 * Приставки снимаем по тем же правилам, что и cleanAddress, плюс типы
 * населенных пунктов, которых в нем не было: п., рп., пгт., ст-ца, нп.
 */
export function plainPlace(address: string): string {
  const withoutBrackets = address.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ")
  // Типы населенных пунктов и служебные приставки, которые ATI приписывает
  // к названию: «Среднесибирский п.», «Валищево д.», «Кстово г.». Геокодер
  // на них отвечает «ничего не найдено» — замер по Среднесибирскому и
  // Шелангеру. Список — тот же смысл, что у PART_NOISE, плюс «рп.», «пгт.»,
  // «ст-ца», «нп»: их в PART_NOISE не было.
  const PLACE_TYPE =
    /(^|\s)(п|рп|пгт|нп|дп|гп|кп|сл|ст-ца|ст|мк|м-ко|х|аул|улус|рез|пос|поселок|посёлок|село|с|д|г|город|гор|дв)\.?\s*$/i
  const PLACE_TYPE_HEAD =
    /^(п|рп|пгт|нп|дп|гп|кп|сл|ст-ца|ст|мк|м-ко|х|аул|улус|рез|пос|поселок|посёлок|село|с|д|г|город|гор|дв)\.?(?![a-zа-яё])[\s.]*/i
  const parts = withoutBrackets
    .split(",")
    .map((part) => part.trim())
    .map((part) => part.replace(PLACE_TYPE, " ").replace(PLACE_TYPE_HEAD, "").trim())
    .filter(Boolean)
  const out = parts.join(", ").trim()
  return out.length >= 3 ? out : ""
}

/** Часть адреса, которая является улицей или домом — это не город. */
const STREET_PART =
  /^(ул|улица|пр-?кт?|проспект|пр-?т|пер|переулок|ш|шоссе|д|дом|кв|квартира|квартал)\.?(?![a-zа-яё])/i

/** Часть адреса, которая является регионом или страной — это не город. */
const REGION_PART =
  /^(обл|область|край|респ|республика|ао|автономная\s+область|автономный\s+округ|федеральный\s+округ|рф|россия)\.?(?![a-zа-яё])/i

/** Адрес без служебных приставок: «г. Тулун, ул. Ленина 5» -> «Тулун, Ленина 5». */
function cleanAddress(address: string): string {
  return address
    .split(",")
    .map((part) => part.trim().replace(PART_NOISE, "").trim())
    .filter(Boolean)
    .join(", ")
}

/**
 * Города, названные в адресе. Нужны для проверки: геокодер может найти ту же
 * улицу в другом городе, и регион выйдет чужой. Если город из адреса не
 * совпал с разобранным местом — результат не берём.
 */
function cityTokens(address: string): string[] {
  return address
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length >= 3 &&
        !STREET_PART.test(part) &&
        !REGION_PART.test(part) &&
        !/^\d/.test(part),
    )
    .map((part) => part.replace(PART_NOISE, "").trim())
    .filter((part) => part.length >= 3)
}

/** Первое слово названия — с ним и сравниваем («Ярославская обл.» -> «Ярославская»). */
function firstWord(value: string): string {
  return value
    .toLowerCase()
    .replace(/\u0451/g, "\u0435")
    .replace(/[^a-z\u0430-\u044f0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)[0]
}

/** Совпал ли геокодер с городом из запроса. */
function labelHasCity(row: any, cities: string[]): boolean {
  const label = String(row?.display_name ?? "")
    .toLowerCase()
    .replace(/\u0451/g, "\u0435")
  if (!label) return false
  return cities.some((city) => {
    const needle = firstWord(city)
    return needle.length >= 4 && label.includes(needle)
  })
}

/**
 * Пауза между обращениями к геокодеру.
 *
 * Зачем: он отвечает «429 Too many requests», если стучать часто. Мы и так
 * бережно (один адрес базы на организацию, результат в кэше процесса), но
 * перебор вариантов адреса — это несколько запросов подряд, и на таком
 * переборе лимит достигался. Поэтому между запросами держим паузу.
 */
let lastCallAt = 0

async function pace(): Promise<void> {
  const wait = 1100 - (Date.now() - lastCallAt)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastCallAt = Date.now()
}

async function nominatim(query: string, limit: number): Promise<any[]> {
  const q = query.trim()
  if (q.length < 3) return []
  await pace()
  try {
    const url =
      `${NOMINATIM}?format=json&limit=${limit}` +
      `&accept-language=ru&addressdetails=1&q=${encodeURIComponent(q)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(url, {
      headers: { "User-Agent": "LoginexTMS/1.0" },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!response.ok) return []
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch (error) {
    /* геокодер недоступен — отдаём пусто, вызывающий код сам предложит ручной ввод */
    return []
  }
}

/**
 * Города региона по его названию — из официального словаря ATI.
 *
 * Зачем: человек пишет адрес как «Ярославская обл. Ул 2-я Суворовская 2».
 * Геокодер такой адрес не понимает совсем, а имя города в нём не названо —
 * названа область. Из «Ярославская» город «Ярославль» никаким правилом не
 * вывести, зато он есть в словаре ATI: город -> id региона. Отсюда и берём
 * кандидатов, чтобы перебрать «улица дом, город».
 */
function citiesOfRegion(regionText: string): string[] {
  const wanted = regionText
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!wanted) return []

  const regionId = Object.keys(ATI_REGION_NAMES).find((id) => {
    const name = ATI_REGION_NAMES[Number(id)].toLowerCase().replace(/ё/g, "е")
    const clear = name.replace(/\s+(область|край|республика).*$/, "")
    return wanted.includes(clear) || clear.includes(wanted)
  })
  if (!regionId) return []

  const id = Number(regionId)
  const cities: string[] = []
  for (const [city, cityRegion] of Object.entries(ATI_CITY_REGIONS)) {
    if (cityRegion === id) cities.push(city)
  }
  // Столица региона обычно в начале списка не гарантирована, но пробуем все
  return cities.slice(0, 12)
}

/** Часть адреса, похожая на область/край/республику. */
function regionPartOf(base: string): string | null {
  const part = base
    .split(",")
    .map((p) => p.trim())
    .find((p) => /\b(обл\.|область|край|респ\.|республика|АО)\b/i.test(p))
  if (part) return part
  // Без запятых: «Ярославская обл. Ул 2-я Суворовская 2»
  const head = base.match(/^[^,]*(?:обл\.|область|край|респ\.|республика)/i)
  return head ? head[0].trim() : null
}

/**
 * Варианты одного и того же адреса — от точного к грубому.
 * Первый, который что-то найдёт, и используется.
 */
function addressVariants(address: string): string[] {
  const base = address.replace(/\s+/g, " ").trim()
  const out: string[] = []

  // Без «г.», «ул.», «д.» — таким вариантом и начинаем: замер показал, что
  // сырой адрес с приставками геокодер понимает как улицу и находит её в
  // другом городе («г. Тулун, ул. Ленина 5» -> Омск), а очищенный — верно.
  const cleaned = cleanAddress(base)
  if (cleaned && cleaned !== base) out.push(cleaned)

  out.push(base)

  // Без «Ярославская обл.» и подобного в начале — геокодер его не любит
  const withoutRegion = base.replace(REGION_NOISE, "").trim()
  if (withoutRegion && withoutRegion !== base) out.push(withoutRegion)

  // «Улица Дом» + город из справочника ATI: именно такая форма геокодер
  // понимает («2-я Суворовская 2, Ярославль»), а область в начале — нет.
  const street = base.match(/(?:ул\.?|улица|пр-?т\.?|проспект|пер\.?|ш\.?|шоссе)\s*[^,]+/i)?.[0]?.trim()
  if (street) {
    const region = regionPartOf(base)
    const cities = region ? citiesOfRegion(region) : []
    // Геокодер понимает «2-я Суворовская 2, Ярославль», но не понимает
    // «Ул 2-я Суворовская 2, Ярославль» — приставку типа улицы убираем.
    const bare = street
      .replace(/^(ул\.?|улица|пр-?т\.?|проспект|пер\.?|ш\.?|шоссе)\s*/i, "")
      .trim()
    if (bare) {
      for (const city of cities) out.push(`${bare}, ${city}`)
    }
    // И с приставкой — на случай, если геокодер её всё же примет
    for (const city of cities) out.push(`${street}, ${city}`)
  }

  // «Улица Дом, Город» — переставим части, если адрес начат с улицы
  const parts = base.split(",").map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const streetPart = parts.find((p) => /^(ул\.?|улица|пр-?т\.?|проспект|пер\.?|ш\.?|шоссе)/i.test(p))
    const cityPart = parts.find((p) => !/^(ул\.|улица|пр-т|проспект|пер\.|ш\.|шоссе|обл\.|область|край|респ\.)/i.test(p))
    if (streetPart && cityPart) out.push(`${streetPart}, ${cityPart}`)
  }

  // Последний шанс — город без улицы: точность ниже, но подсказка будет
  const cityOnly = parts[parts.length - 1]?.trim()
  if (cityOnly && !out.includes(cityOnly)) out.push(cityOnly)

  return out.filter((v, i) => v.length >= 3 && out.indexOf(v) === i)
}

/** Насколько точно геокодер определил место — честно покажем пользователю. */
function precisionOf(row: any): GeoItem["precision"] {
  const type = String(row?.type ?? "")
  const cls = String(row?.class ?? "")
  if (type === "house" || cls === "building") return "house"
  if (type === "residential" || type === "road" || cls === "highway") return "street"
  return "city"
}

/** Короткая подпись: первый осмысленный кусок адреса без номера дома. */
function shortLabel(row: any): string {
  const parts = String(row?.display_name ?? "").split(",").map((p) => p.trim()).filter(Boolean)
  return parts.slice(0, 2).join(", ") || parts[0] || ""
}

function toItems(rows: any[], limit: number): GeoItem[] {
  return rows
    .map((row) => ({
      label: String(row?.display_name ?? "").split(",").slice(0, 4).join(",").trim(),
      short: shortLabel(row),
      lat: Number(row?.lat),
      lng: Number(row?.lon),
      precision: precisionOf(row),
    }))
    .filter((item) => item.label && Number.isFinite(item.lat) && Number.isFinite(item.lng))
    .slice(0, limit)
}

/**
 * Регион места по его адресу — из разобранного ответа геокодера
 * (address.state / address.region).
 *
 * Зачем: свой словарь городов покрывает 199 городов, в основном областные
 * центры. Замер: «Ярославль» → Ярославская область, «Биробиджан» → Еврейская
 * АО, но «Тулун», «Кировск», «Надым», «Оханск» → ничего. Для организации из
 * такого города не определялся ни регион сбора, ни фильтр помощника.
 * Геокодер знает все регионы, поэтому его ответ и закрывает пробел.
 *
 * Кэш в памяти процесса: адрес базы не меняется, а к геокодеру стоит
 * обращаться бережно.
 */
const REGION_CACHE = new Map<string, string | null>()

export async function regionOfPlace(query: string): Promise<string | null> {
  const key = String(query ?? "").trim().toLowerCase()
  if (key.length < 3) return null
  if (REGION_CACHE.has(key)) return REGION_CACHE.get(key) ?? null

  const cities = cityTokens(query)
  let found: string | null = null
  for (const variant of addressVariants(query)) {
    const rows = await nominatim(variant, 3)
    for (const row of rows) {
      const address = row?.address ?? {}
      // state — для области/края/республики, region — запасной вариант
      const candidate = address.state || address.region || null
      if (!candidate) continue
      const region = String(candidate).trim()
      if (!region) continue
      // Город в адресе назван, а геокодер вернул другое место — это чужая
      // улица с тем же названием. Такой регион не берём: лучше «не знаю»,
      // чем отправить сборщик в чужой регион.
      if (cities.length && !labelHasCity(row, cities)) continue
      found = region
      break
    }
    if (found) break
  }

  REGION_CACHE.set(key, found)
  return found
}

/**
 * Подсказки мест по адресу. Если точный адрес не нашёлся — пробуем упрощённые
 * варианты, поэтому результат есть почти всегда (хотя бы центр города).
 */
export async function searchPlaces(query: string, limit = 5): Promise<GeoItem[]> {
  for (const variant of addressVariants(query)) {
    const rows = await nominatim(variant, limit)
    if (rows.length > 0) return toItems(rows, limit)
  }
  return []
}
