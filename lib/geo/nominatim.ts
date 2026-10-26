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
  /^[^,]*\b(обл\.|область|край|респ\.|республика|АО|автономный округ)\b[.,]?\s*/i

async function nominatim(query: string, limit: number): Promise<any[]> {
  const q = query.trim()
  if (q.length < 3) return []
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
  const out: string[] = [base]

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
