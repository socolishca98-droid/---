// lib/ati/regions.ts
//
// Справочник регионов ATI и поиск по региону в общей бирже.
//
// Зачем: биржа loads.ati.su принимает в фильтре «откуда» числовой id, и это
// id РЕГИОНА, а не города. Проверено живьём: from:{id:88} — это Ярославская
// область (2899 грузов со всей области, поэтому радиус в фильтре и не влиял),
// from:{id:86} — Челябинская область (4094 груза). Идентификатор региона
// совпадает с RegionId официального словаря ATI.
//
// Именно поэтому объём сбора — «регион базы»: у каждой организации свой
// регион, и он определяется её городом, а не списком из 28 городов.

import { atiFetch, atiHeaders } from "./http"
import { ATI_CITY_REGIONS, ATI_REGION_NAMES } from "./ati-city-regions"

export type AtiRegion = {
  /** Идентификатор региона — его и принимает фильтр биржи */
  id: number
  /** «Ярославская область» */
  name: string
  /** «Ярославская» — без типа, для нечёткого сравнения */
  clearName: string
}

const REGIONS_URL = "https://api.ati.su/v1.0/dictionaries/regions"

/** Кэш на процесс: справочник меняется раз в годы, дёргать его на каждый
 *  поиск незачем. Ключ — организация: у каждой свой токен и свои лимиты. */
const cache = new Map<string, { at: number; regions: AtiRegion[] }>()
const TTL_MS = 24 * 60 * 60 * 1000

/** Регионы России из официального словаря ATI. */
export async function fetchAtiRegions(
  token: string,
  organizationId: string,
): Promise<AtiRegion[]> {
  const hit = cache.get(organizationId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.regions

  const res = await atiFetch(
    REGIONS_URL,
    { headers: atiHeaders(token), signal: AbortSignal.timeout(15_000) },
    organizationId,
  )
  if (!res.ok) return hit?.regions ?? []

  const raw: any = await res.json().catch(() => [])
  const regions: AtiRegion[] = (Array.isArray(raw) ? raw : [])
    .filter((row) => Number(row?.CountryId) === 1 && Number.isFinite(Number(row?.Id)))
    .map((row) => ({
      id: Number(row.Id),
      name: String(row.Name ?? ""),
      clearName: String(row.RegionClearName ?? row.Name ?? ""),
    }))

  if (regions.length > 0) cache.set(organizationId, { at: Date.now(), regions })
  return regions
}

/**
 * Регион по названию города или самого региона — БЕЗ запроса к ATI.
 *
 * Первым делом смотрим выписанный справочник (199 городов из официального
 * словаря ATI): он точный, мгновенный и не тратит лимит 10 запросов в
 * секунду. Дальше — по началу слова, и только потом в интернет.
 */
export function findRegionByNameLocal(query: string): AtiRegion | null {
  const q = normalize(query)
  if (!q) return null

  // 1. Город из справочника: «тула» -> Тульская область.
  //    Сначала вся строка, потом первое слово — пользователи пишут и
  //    «Ярославль», и «ЯРОСЛАВЛЬ, Ярославская область», и «Челябинск г.».
  const head = q.split(" ")[0]
  const direct = ATI_CITY_REGIONS[q] ?? ATI_CITY_REGIONS[head]
  if (direct && ATI_REGION_NAMES[direct]) {
    return { id: direct, name: ATI_REGION_NAMES[direct], clearName: clearOf(ATI_REGION_NAMES[direct]) }
  }

  // 2. Название региона: «Тульская область» / «Тульская»
  const asName = Object.entries(ATI_REGION_NAMES).find(
    ([id, name]) => normalize(name) === q || clearOf(name).toLowerCase() === q,
  )
  if (asName) {
    const [id, name] = asName
    return { id: Number(id), name, clearName: clearOf(name) }
  }

  return null
}

/** «Тульская область» -> «Тульская» */
function clearOf(name: string): string {
  return name.replace(/\s+(область|край|республика|автономная область|автономный округ)$/i, "").trim()
}

/**
 * Регион по названию города или самого региона.
 *
 * «Ярославль» → Ярославская область, «Челябинская область» → она же,
 * «Вологда» → Вологодская область.
 */
export function findRegionByName(
  query: string,
  regions: AtiRegion[],
): AtiRegion | null {
  const q = normalize(query)
  if (!q) return null

  // 0. Выписанный справочник — точно и без запроса к ATI
  const local = findRegionByNameLocal(query)
  if (local) return local

  // 1. Точное совпадение названия региона
  const exact = regions.find((r) => normalize(r.name) === q || normalize(r.clearName) === q)
  if (exact) return exact

  // 2. Регион по общему началу с городом: «Ярославль» ↔ «Ярославская»,
  //    «Челябинск» ↔ «Челянинская», «Вологда» ↔ «Вологодская».
  //    Сравниваем именно начало, а не отбрасывание окончаний: в русском
  //    «Ярославль» → «Ярославская» меняется и основа, один суффикс не снять.
  let best: AtiRegion | null = null
  let bestLen = 0
  for (const region of regions) {
    const regionName = normalize(region.clearName || region.name)
    if (!regionName) continue
    const len = commonPrefixLen(q, regionName)
    if (len > bestLen) {
      bestLen = len
      best = region
    }
  }
  // Не меньше 4 совпадающих букв и город не короче 4: иначе «Орёл» уехал бы
  // в Орловскую, а «Париж» — куда угодно.
  if (best && bestLen >= 4 && q.length >= 4) return best

  // 3. Частичное совпадение — на случай «Ярославская обл.»
  const partial = regions.find(
    (r) => normalize(r.name).includes(q) || normalize(r.clearName).includes(q),
  )
  return partial ?? null
}

/** Длина общего начала двух строк. */
function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  return i
}

/** Нижний регистр, ё→е, без «область/край/республика» и лишних символов. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

