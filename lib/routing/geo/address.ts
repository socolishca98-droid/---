// lib/routing/geo/address.ts
//
// Разбор адреса и ключи сравнения населённых пунктов.
//
// У названия ДВА ключа, и путать их нельзя:
//   cityKey(raw)        — по всей строке; им индексируются точки маршрута и
//                         сохранённые ключи (менять нельзя);
//   cityLookupKey(name) — ключ ПОИСКА в справочнике: только название пункта,
//                         без региона, типа и регистра («энгельс»).
//
// Правило разбора: запятая внутри скобок не режет. «Коромыслово д.
// (Гаврилов-Ямский р-н), Ярославская область» — два сегмента, а не три.

export type CityType =
  | "city"
  | "town"
  | "urban"
  | "settlement"
  | "village"
  | "rural"
  | "station"
  | "unknown"

export interface ParsedAddress {
  raw: string
  city: string | null
  region: string | null
  district: string | null
  street: string | null
  type: CityType
}

const REGION_RE =
  /(область|обл\.|край|республик|респ\.|автономн|авт\.?\s*округ|\bао\b|\(регион\)|регион\b)/i
const DISTRICT_RE = /(\bрайон\b|\bр-н\b|\bм\.?\s*о\.\b)/i
/** «д.» считается улицей только перед числом: «Шарапово д.» — деревня. */
const STREET_RE =
  /(\bул\.?\s|\bулиц|\bпроспект|\bпр-?т\b|\bпр\.\s|\bпереулок|\bпер\.\s|\bшоссе|\bш\.\s|\bнабережн|\bнаб\.\s|\bбульвар|\bб-р\b|\bплощад|\bпл\.\s|\bпроезд|\bтупик|\bмкр\b|\bмикрорайон|\bквартал|\bдом\b|\bд\.\s*\d|\bкв\.\s*\d|\bкорп\b|\bстр\.\s*\d|\bвладение\b|\bздание\b)/i

const TYPE_TOKENS: Array<{ re: RegExp; type: CityType }> = [
  { re: /(^|\s)(г\.|город)$/i, type: "city" },
  { re: /(^|\s)(пгт\.?|пос\.?\s*гор\.?\s*типа|рп\.?)$/i, type: "urban" },
  { re: /(^|\s)(п\.|пос\.|посёлок|поселок|село|с\.)$/i, type: "settlement" },
  { re: /(^|\s)(д\.|деревня|дер\.)$/i, type: "village" },
  { re: /(^|\s)(ст\.|станция|разъезд)$/i, type: "station" },
  { re: /(^|\s)(х\.|хутор|аул|станица|снт|днп)$/i, type: "rural" },
]

function stripParens(value: string): string {
  return value.replace(/\([^)]*\)/g, " ").replace(/\([^)]*$/, " ")
}

function normalize(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Разбиение адреса по запятым вне скобок. */
export function splitSegments(raw: string): string[] {
  const text = String(raw ?? "")
  const out: string[] = []
  let depth = 0
  let current = ""
  for (const char of text) {
    if (char === "(") depth += 1
    if (char === ")") depth = Math.max(0, depth - 1)
    if ((char === "," || char === ";") && depth === 0) {
      out.push(current)
      current = ""
      continue
    }
    current += char
  }
  out.push(current)
  return out.map((part) => part.trim()).filter(Boolean)
}

/** Тип населённого пункта по названию. */
export function cityTypeOfName(name: string | null | undefined): CityType {
  const value = stripParens(String(name ?? "")).trim()
  if (!value) return "unknown"
  for (const { re, type } of TYPE_TOKENS) {
    if (re.test(value)) return type
  }
  if (/\sг\.?$/i.test(value)) return "city"
  if (/^\s*г\.\s/i.test(value)) return "city"
  if (/^\s*город\s/i.test(value)) return "city"
  return "unknown"
}

/** Головная часть названия: до первой запятой вне скобок. */
export function cityNameHead(name: string | null | undefined): string {
  const segments = splitSegments(String(name ?? ""))
  return (segments[0] ?? "").trim()
}

/** Ключ сравнения точек маршрута. Поведение сохранено ради прежних ключей. */
export function cityKey(city: string): string {
  return String(city ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+(г\.|город|п\.|пос\.|с\.|д\.|пгт)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Ключ ПОИСКА пункта в справочнике: только название, без типа и региона. */
export function cityLookupKey(name: string | null | undefined): string {
  let value = stripParens(cityNameHead(name ?? ""))
  value = normalize(value)
  if (!value) return ""
  value = value
    .replace(/^(г|город|пгт|рп|пос|поселок|п|село|с|деревня|д|ст|станция|х|хутор|аул)\.?\s+/i, "")
    .replace(/\s+(г|город|пгт|рп|пос|поселок|п|село|с|деревня|д|ст|станция|х|хутор|аул)\.?$/i, "")
  value = value.replace(/[.,;:()"«»]/g, " ")
  return value.replace(/\s+/g, " ").trim()
}

/** Ключ сравнения регионов: «Ярославская обл.» = «Ярославская область». */
export function regionLookupKey(region: string | null | undefined): string {
  let value = stripParens(String(region ?? ""))
  value = normalize(value)
  if (!value) return ""
  value = value
    .replace(/\b(область|обл|край|республика|респ|автономный округ|автономная область|ао|округ|район|р-н|регион)\b\.?/g, " ")
    .replace(/[.,;:()"«»]/g, " ")
  return value.replace(/\s+/g, " ").trim()
}

/** Ключ сравнения районов. */
export function districtKey(district: string | null | undefined): string {
  let value = stripParens(String(district ?? ""))
  value = normalize(value)
  if (!value) return ""
  value = value.replace(/\b(муниципальный|городской|административный)\b/g, " ")
  value = value.replace(/\b(район|р-н|округ|м\.?\s*о)\b\.?/g, " ")
  return value.replace(/[.,;:()"«»]/g, " ").replace(/\s+/g, " ").trim()
}

function isStreet(value: string): boolean {
  return STREET_RE.test(value)
}

function isRegion(value: string): boolean {
  return REGION_RE.test(value)
}

function isDistrict(value: string): boolean {
  return DISTRICT_RE.test(value) && !isStreet(value)
}

/**
 * Разбор адреса на части.
 *
 * Город — первый сегмент, который не регион, не район и не улица: правило
 * «вторая часть после запятой» давало город «ул. Докучалова 12» на строке
 * «Ярославль, ул. Докучалова 12».
 */
export function parseAddress(address: string | null | undefined): ParsedAddress {
  const raw = String(address ?? "").trim()
  const out: ParsedAddress = {
    raw,
    city: null,
    region: null,
    district: null,
    street: null,
    type: "unknown",
  }
  if (!raw) return out

  let segments = splitSegments(raw)

  // «Ярославль. Ул. Докучалова 12» — город отделён точкой, а не запятой.
  if (segments.length === 1) {
    const dot = raw.match(/^([^.,()]+?)\.\s+(.+)$/)
    if (dot && !isStreet(dot[1]) && !isRegion(dot[1]) && dot[1].trim().split(/\s+/).length <= 2) {
      segments = [dot[1].trim(), dot[2].trim()]
    }
  }

  for (const segment of segments) {
    if (!out.region && isRegion(segment)) {
      out.region = segment
      continue
    }
    if (!out.city && !isStreet(segment) && !isDistrict(segment)) {
      out.city = segment
      continue
    }
    if (!out.district && isDistrict(segment)) {
      out.district = segment
      continue
    }
    if (!out.street && isStreet(segment)) {
      out.street = segment
      continue
    }
    if (!out.street) out.street = segment
  }

  if (out.city && /^[\d\s\-/]+$/.test(out.city)) out.city = null

  // Район может стоять в скобках внутри названия города — он часть названия,
  // но полезен: по району уточняется неоднозначное название.
  if (!out.district && out.city) {
    const inside = out.city.match(/\(([^)]*)\)/)
    if (inside && isDistrict(inside[1])) out.district = inside[1].trim()
  }

  out.type = cityTypeOfName(out.city)
  return out
}
