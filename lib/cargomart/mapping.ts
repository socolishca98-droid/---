// lib/cargomart/mapping.ts
//
// Разъём Cargomart: маппинг груза биржи (api/v2/order) во внутренний формат
// накопленной базы. Чистый модуль — без сети и без Prisma, поэтому тесты
// гоняют его на словарях-заглушках (tests/cargomart-mapping.test.mjs).
//
// Правила:
//   · город записывается С РЕГИОНОМ («Ярославль, Ярославская область») —
//     иначе справочник не различает три ярославля в стране;
//   · вес Cargomart приходит в килограммах, внутренний формат — тонны;
//   · идентификатор получает префикс «cargomart:» — груз №123 с двух бирж
//     не сливается в одну строку кэша;
//   · КОНТАКТОВ В МАППИНГЕ НЕТ — ни полей, ни запросов: контакты
//     грузовладельца логист добирает осознанным действием, не сбором.

/** Сырой элемент data.order[] из GET /api/v2/order. */
export interface CargomartLoadRaw {
  id: string | number | null | undefined
  current_price?: string | number | null
  /** Ставка НДС отправителя (процент) или null, если отправитель не плательщик. */
  vat_rate?: number | null
  /** true — цена указана с НДС. */
  is_consignor_vat?: boolean | null
  /** Вес, кг. */
  weight?: number | null
  /** Объём, м³. */
  capacity?: number | null
  kind?: number | null
  truck_type_id?: number | string | null
  consignor_id?: string | null
  loading?: { code?: string | null; date?: string | null } | null
  unloading?: { code?: string | null; date?: string | null } | null
}

/** Словари ответа api/v2/order (data.locality / data.company / data.truck_type). */
export interface CargomartDictionaries {
  /** locality: код КЛАДР → { name, region } */
  locality?: Record<string, { name?: string | null; region?: string | null } | undefined> | null
  company?: Record<string, { short_name?: string | null } | undefined> | null
  truck_type?: Record<string, { name?: string | null } | undefined> | null
}

/** Груз во внутреннем формате накопленной базы. */
export interface CargomartMappedLoad {
  id: string
  source: "cargomart"
  loading: {
    location: { city: string | null; region: string }
    firstDate: string | null
  }
  unloading: {
    location: { city: string | null; region: string }
    firstDate: string | null
  }
  load: {
    /** Тонны — внутренний формат (источник отдаёт килограммы). */
    weight: number | null
    volume: number | null
    cargoType: string | null
  }
  rate: {
    price: number | null
    priceNds: number | null
    priceNoNds: number | null
  }
  route: {
    distance: number | null
  }
  truck: {
    carTypes: string[]
  }
}

/** «Город, Регион» — без дублирования, если регион уже в названии. */
export function cityWithRegion(
  city: string | null | undefined,
  region: string | null | undefined,
): string {
  const name = String(city ?? "").trim()
  const area = String(region ?? "").trim()
  if (!name) return ""
  if (!area || name === "N/A") return name
  if (name.toLowerCase().includes(area.toLowerCase())) return name
  return `${name}, ${area}`
}

/**
 * Ключ города накопленной базы — та же логика, что у ATI (makeCityKey в
 * lib/ati-client.ts): первая часть до запятой, нижний регистр, срез
 * суффиксов типов населённых пунктов. Ключи двух бирж должны совпадать,
 * иначе один и тот же город получит две разные записи кэша.
 */
export function cityKeyOf(route: string | null | undefined): string | null {
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

/** Ключи городов для накопленной базы (routeFromId / routeToId). */
export function cargomartCityKeys(
  load: CargomartMappedLoad,
): { fromKey: string | null; toKey: string | null } {
  return {
    fromKey: cityKeyOf(cityWithRegion(load.loading.location.city, load.loading.location.region)),
    toKey: cityKeyOf(cityWithRegion(load.unloading.location.city, load.unloading.location.region)),
  }
}

/** Число из сырого значения цены («82000» | 82000 | null). */
function priceOf(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/\s/g, ""))
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

/**
 * Груз биржи → внутренний формат. Мусор (null, без городов) не проходит —
 * в накопленную базу пишется только то, что можно показать на карте.
 */
export function mapCargomartLoad(
  raw: CargomartLoadRaw | null | undefined,
  dicts: CargomartDictionaries,
): CargomartMappedLoad | null {
  if (!raw || raw.id === null || raw.id === undefined || String(raw.id).trim() === "") return null

  const fromInfo = dicts.locality?.[String(raw.loading?.code ?? "")] ?? undefined
  const toInfo = dicts.locality?.[String(raw.unloading?.code ?? "")] ?? undefined
  // Города нет в словаре — груз не показать на карте, в базу его не пишем.
  if (!fromInfo?.name || !toInfo?.name) return null

  const price = priceOf(raw.current_price)
  // Cargomart отдаёт цену с НДС, только если отправитель плательщик НДС.
  const withNds = Boolean(raw.is_consignor_vat) && raw.vat_rate !== null && raw.vat_rate !== undefined

  const carType = dicts.truck_type?.[String(raw.truck_type_id ?? "")]?.name?.trim()

  return {
    id: `cargomart:${String(raw.id).trim()}`,
    source: "cargomart",
    loading: {
      location: { city: fromInfo.name.trim(), region: String(fromInfo.region ?? "").trim() },
      firstDate: raw.loading?.date ?? null,
    },
    unloading: {
      location: { city: toInfo.name.trim(), region: String(toInfo.region ?? "").trim() },
      firstDate: raw.unloading?.date ?? null,
    },
    load: {
      // Источник отдаёт килограммы, внутренний формат — тонны.
      weight: raw.weight !== null && raw.weight !== undefined && raw.weight > 0 ? raw.weight / 1000 : null,
      volume: raw.capacity !== null && raw.capacity !== undefined && raw.capacity > 0 ? raw.capacity : null,
      cargoType: null,
    },
    rate: {
      price,
      priceNds: price !== null && withNds ? price : null,
      priceNoNds: price !== null && !withNds ? price : null,
    },
    route: {
      // В api/v2/order расстояния нет: посчитает маршрутизатор.
      distance: null,
    },
    truck: {
      carTypes: carType ? [carType] : [],
    },
  }
}
