// lib/logist-mobile/load-suggestions.ts
//
// «3 варианта с биржи» для помощника сборки.
//
// Задача: у ATI не спрашивают контакты под автоматическую сборку, поэтому
// помощник не создаёт рейс сам — он показывает логисту ТРИ примерно
// подходящих груза. Логист звонит фрахтователю, договаривается, и только
// потом жмёт «Взять в работу» (POST /api/orders/from-cache) — груз
// становится нашим заказом и дальше идёт по обычному пути: согласование →
// рейс → назначение водителя.
//
// «Примерно подходящий» — это:
//   * груз влезает в одну из машин организации (вес ≤ грузоподъёмности);
//   * маршрут известен (откуда и куда заполнены);
//   * ставка озвучена (иначе нечем мерить выгоду);
//   * дата загрузки не в прошлом.
// Из подходящих берём три лучших по ставке ₽/км — это честная прокси
// выгоды, когда машина едет «пустой» на биржу.
//
// Модуль чистый (без Next, без Prisma, без React) — проверяется юнит-тестом
// tests/logist-mobile-load-suggestions.test.mjs.

// ---------------------------------------------------------------------------
// Вход
// ---------------------------------------------------------------------------

/** Груз биржи, каким его отдаёт /api/ati/loads. */
export interface SuggestionLoad {
  id: string
  loadId: string
  fromCity: string
  toCity: string
  weightKg: number | null
  volumeM3: number | null
  cargoType: string | null
  priceRub: number | null
  priceWithNds: number | null
  distanceKm: number | null
  ratePerKm: number | null
  firmName: string | null
  firmRating: number | null
  firstDate: string | null
  lastDate: string | null
  status: string
}

/** Машина организации (как в помощнике сборки). */
export interface SuggestionVehicle {
  id: string
  plate: string
  type?: string | null
  /** Грузоподъёмность, кг */
  capacity?: number | null
  /** Объём кузова, м³ */
  volume?: number | null
}

// ---------------------------------------------------------------------------
// Выход
// ---------------------------------------------------------------------------

export interface LoadSuggestion {
  load: SuggestionLoad
  /** Машина, в которую груз влезает (лучшая подходящая) */
  vehicle: SuggestionVehicle
  /** Почему помощник выбрал этот груз — показываем словами */
  reason: string
  /** Ставка ₽/км (если посчитана) */
  ratePerKm: number | null
}

// ---------------------------------------------------------------------------
// Логика
// ---------------------------------------------------------------------------

/** Машины, в которые груз влезает по весу и объёму. */
export function vehiclesForLoad(load: SuggestionLoad, vehicles: SuggestionVehicle[]): SuggestionVehicle[] {
  return vehicles.filter((vehicle) => {
    if (load.weightKg != null) {
      if (!vehicle.capacity || vehicle.capacity <= 0) return false
      if (load.weightKg > vehicle.capacity) return false
    }
    if (load.volumeM3 != null) {
      if (!vehicle.volume || vehicle.volume <= 0) return false
      if (load.volumeM3 > vehicle.volume) return false
    }
    return true
  })
}

/** Дата загрузки в прошлом — груз уже неактуален. */
function isOverdue(load: SuggestionLoad, now: Date): boolean {
  const last = load.lastDate ?? load.firstDate
  if (!last) return false
  const date = new Date(last)
  if (Number.isNaN(date.getTime())) return false
  // Небольшой запас: день загрузки «сегодня» ещё актуален
  return date.getTime() < now.getTime() - 12 * 60 * 60 * 1000
}

/** Человеческая причина выбора: «влезает в K215CT790, ставка 45 ₽/км». */
function buildReason(load: SuggestionLoad, vehicle: SuggestionVehicle): string {
  const parts: string[] = []
  if (load.weightKg != null) {
    parts.push(`${Math.round(load.weightKg)} кг влезает в ${vehicle.plate}`)
  } else {
    parts.push(`подходит машине ${vehicle.plate}`)
  }
  if (load.ratePerKm != null) {
    parts.push(`${Math.round(load.ratePerKm)} ₽/км`)
  }
  if (load.priceRub != null && load.priceWithNds != null && load.priceWithNds > load.priceRub) {
    parts.push("с НДС")
  }
  if (load.firmRating != null && load.firmRating >= 4) {
    parts.push(`фрахтователь ${load.firmRating}★`)
  }
  return parts.join(" · ")
}

/**
 * Три примерно подходящих груза с биржи.
 *
 * now — опорное время (в тестах фиксированное), чтобы просроченность
 * считалась предсказуемо.
 */
export function suggestExchangeLoads(
  loads: SuggestionLoad[],
  vehicles: SuggestionVehicle[],
  now: Date = new Date(),
  limit = 3,
): LoadSuggestion[] {
  const candidates: LoadSuggestion[] = []

  for (const load of loads) {
    // Только новые грузы (уже взятые/отклонённые — мимо)
    if (load.status !== "new") continue
    // Маршрут должен быть известен
    if (!load.fromCity || !load.toCity || load.fromCity === "—" || load.toCity === "—") continue
    // Просроченные — мимо
    if (isOverdue(load, now)) continue
    // Ставка должна быть озвучена — иначе нечем мерить выгоду
    const price = load.priceWithNds ?? load.priceRub
    if (price == null || price <= 0) continue

    const fitting = vehiclesForLoad(load, vehicles)
    if (fitting.length === 0) continue

    // Лучшая машина — самая «плотно» подходящая: минимальный запас по весу
    const vehicle = [...fitting].sort((a, b) => {
      if (load.weightKg == null) return 0
      const da = (a.capacity ?? 0) - load.weightKg
      const db = (b.capacity ?? 0) - load.weightKg
      return da - db
    })[0]

    candidates.push({
      load,
      vehicle,
      reason: buildReason(load, vehicle),
      ratePerKm: load.ratePerKm,
    })
  }

  // Лучшие по ставке ₽/км; грузы без ставки — в конец
  candidates.sort((a, b) => {
    const ra = a.ratePerKm ?? -1
    const rb = b.ratePerKm ?? -1
    return rb - ra
  })

  return candidates.slice(0, limit)
}
