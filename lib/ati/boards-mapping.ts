// lib/ati/boards-mapping.ts
// Грузы с площадок ATI (GET /v1.0/loads/search/byboards) → внутренний формат
// сканера. Чистый модуль без Prisma — покрывается unit-тестами.
//
// Зачем: в ответе byboards приходит только CityId (без имени города) и
// другая структура полей, чем в прежнем loads/search. Имена городов
// подставляет resolveAtiCities (lib/ati/ati-city-resolver.ts) — сюда
// приходит готовый Map.

/** Типы кузова ATI (Transport.CarType) → подпись. */
const CAR_TYPES: Record<number, string> = {
  1: "Тент",
  2: "Фургон",
  3: "Цельнометаллический",
  4: "Рефрижератор",
  5: "Изотермический",
  6: "Бортовой",
  7: "Самосвал",
  8: "Контейнеровоз",
  9: "Автовоз",
  10: "Негабарит",
  11: "Тент-крышка",
  12: "Микроавтобус",
}

/** Типы погрузки/выгрузки ATI (Transport.LoadingType) → подпись. */
const LOADING_TYPES: Record<number, string> = {
  1: "Верхняя",
  2: "Боковая",
  3: "Задняя",
  4: "Любая",
  5: "Верхняя/боковая",
  6: "Задняя/боковая",
}

export type AtiCityMap = Map<number, { name: string; region: string }>

/**
 * Груз byboards → внутренний формат сканера (loading/unloading.location,
 * route.distance, load.weight, rate.*, truck.*) — дальше идут общие
 * фильтры профиля, saveToCache и биржа.
 */
export function mapBoardsLoad(load: any, cities: AtiCityMap): any {
  const cityInfo = (
    loc: any
  ): { city: string | null; region: string } => {
    const cityId = Number(loc?.CityId) || 0
    const hit = cityId ? cities.get(cityId) : undefined
    return {
      city: hit?.name ?? (cityId ? `Город #${cityId}` : null),
      region: hit?.region ?? "",
    }
  }

  const from = cityInfo(load?.Loading)
  const to = cityInfo(load?.Unloading)

  const cargo = load?.Cargo || {}
  const payment = load?.Payment || {}
  const transport = load?.Transport || {}
  const carTypeId = Number(transport.CarType) || 0
  const loadingTypeId = Number(transport.LoadingType) || 0

  const firstDate = load?.FirstDate || load?.LastDate || null
  const price =
    Number(payment.SumWithNDS) ||
    Number(payment.SumWithoutNDS) ||
    Number(payment.RateSum) ||
    0

  return {
    id: String(load?.Id ?? ""),
    // Фрахтователь: в грузе приходит только FirmId — имя и телефон фрахтователя
    // дотягиваем отдельным запросом карточки фирмы (POST /api/ati/loads/contacts)
    firm: {
      id: load?.FirmId ? String(load.FirmId) : null,
      name: null,
    },
    loading: {
      location: { city: from.city, region: from.region },
      firstDate,
    },
    unloading: {
      location: { city: to.city, region: to.region },
    },
    route: { distance: Number(load?.Distance) || 0 },
    load: {
      weight: Number(cargo.Weight) || 0,
      volume: Number(cargo.Volume) || null,
      cargoType: cargo.CargoType || "Груз",
    },
    rate: {
      priceNds: Number(payment.SumWithNDS) || undefined,
      priceNoNds: Number(payment.SumWithoutNDS) || undefined,
      price: price || undefined,
    },
    truck: {
      carTypes: carTypeId ? [CAR_TYPES[carTypeId] || `Кузов #${carTypeId}`] : [],
      loadingTypes: loadingTypeId
        ? [LOADING_TYPES[loadingTypeId] || `Погрузка #${loadingTypeId}`]
        : [],
    },
  }
}

/** Все CityId погрузки/выгрузки из грузов byboards (для resolveAtiCities). */
export function collectCityIds(loads: any[]): number[] {
  const ids = new Set<number>()
  for (const load of loads) {
    for (const side of ["Loading", "Unloading"] as const) {
      const cityId = Number(load?.[side]?.CityId)
      if (Number.isFinite(cityId) && cityId > 0) ids.add(cityId)
    }
  }
  return [...ids]
}
