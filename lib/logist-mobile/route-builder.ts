// lib/logist-mobile/route-builder.ts
//
// Сборщик МАРШРУТА из грузов биржи ATI — «сердце» помощника.
//
// Зачем отдельно от route-assistant: помощник сборки заказов решал другую
// задачу — раскладывать СВОИ заказы по направлениям. Здесь логика другая,
// ровно как работает реальный логист на бирже:
//
//   1. есть точка старта — база или город, где стоит машина;
//   2. из неё ищем груз в соседний город, из того города — груз дальше,
//      и так складывается цепочка: А → Б → В → Г;
//   3. на каждом плече машина едет гружёной, прибыль плеча = ставка − топливо;
//   4. если плечо убыточное — оно нам не нужно, берём следующее по выгоде;
//   5. в конце цепочки стараемся вернуться домой с грузом, а не пустым.
//
// Модуль чистый (без Next, Prisma, React) — его проверяет юнит-тест
// tests/logist-mobile-route-builder.test.mjs.

import { estimateFuelL } from "../fleet/fuel"
import { cityKey } from "./route-assistant"
import { formatMoney, shortCity } from "./format"

// ---------------------------------------------------------------------------
// Вход
// ---------------------------------------------------------------------------

/** Груз биржи, каким его отдаёт /api/ati/loads (строка AtiCache). */
export interface BuilderLoad {
  /** id строки в нашей базе — по нему потом «берём в работу» */
  id: string
  loadId: string
  fromCity: string
  toCity: string
  weightKg: number | null
  volumeM3: number | null
  cargoType: string | null
  /** Ставка фрахтователя, ₽ */
  priceRub: number | null
  /** Ставка с НДС, если включена */
  priceWithNds: number | null
  /** Километры гружёного плеча по данным ATI */
  distanceKm: number | null
  firmName: string | null
  /** Телефон фрахтователя — чтобы позвонить и договориться */
  contactPhone: string | null
  /** Дата загрузки (ISO) — просроченные грузы не берём */
  loadingDate: string | null
  status: string
}

/** Машина автопарка, какая нужна билдеру. */
export interface BuilderVehicle {
  id: string
  plate: string
  type?: string | null
  /** Грузоподъёмность, кг */
  capacity?: number | null
  /** Объём, м³ */
  volume?: number | null
  status?: string | null
  /** Паспортный расход, л/100 км */
  fuelConsumptionPer100?: number | null
}

export interface BuildRouteOptions {
  /** Город, где стоит машина (база). Пусто — начнём от самого выгодного груза */
  startCity: string
  /** Грузы биржи */
  loads: BuilderLoad[]
  /** Автопарк */
  vehicles: BuilderVehicle[]
  /** Цена литра топлива для оценки себестоимости; null — нечем считать */
  fuelPriceRubPerL: number | null
  /** Сколько плеч максимум собирать (по умолчанию 4) */
  maxLegs?: number
  /**
   * Минимальная прибыльность плеча, ₽/км. Ниже — плечо не берём: логист
   * не поедет за копейки. По умолчанию 25 ₽/км.
   */
  minProfitPerKm?: number
  /**
   * Грузы, которые обязательно оставляем в маршруте: уже согласованы
   * звонком. Пересборка «заменить отказавшего» не должна выкидывать их.
   */
  keepIds?: readonly string[]
  /** Грузы, которые не берём: отказались, уже в работе, скрыты логистом */
  excludeIds?: readonly string[]
  now?: Date
}

// ---------------------------------------------------------------------------
// Выход
// ---------------------------------------------------------------------------

/** Одно плечо маршрута: один груз от города отправления до города выгрузки. */
export interface RouteLeg {
  load: BuilderLoad
  /** Порожний пробег до погрузки, км (груз берём из города, где стоим) */
  deadheadKm: number
  /** Гружёное плечо, км */
  loadedKm: number
  revenue: number
  fuelLiters: number | null
  fuelCostRub: number | null
  profitRub: number | null
  profitPerKm: number | null
  /** Груз везёт машину домой — обратный плечо уже занято */
  returnsHome: boolean
}

/** Груз, который не попал в маршрут, и почему. */
export interface ExcludedLoad {
  load: BuilderLoad
  reason: string
}

export interface BuiltRoute {
  /** Стабильный ключ для React и кэша */
  id: string
  startCity: string
  /** Города по порядку: старт → точки погрузки/выгрузки */
  path: string[]
  legs: RouteLeg[]
  vehicle: BuilderVehicle | null
  /** Возврат к точке старта: порожний пробег, км. 0 — вернулись с грузом */
  returnDeadheadKm: number
  /** Последнее плечо — домой с грузом */
  returnsHomeWithLoad: boolean
  totalDistanceKm: number
  totalRevenue: number
  totalFuelCostRub: number | null
  totalProfitRub: number | null
  /** Прибыль на километр всего маршрута */
  profitPerKm: number | null
  /** Прибыль нечем посчитать: у машины не заполнен расход топлива */
  needsFuelSetup: boolean
  /** Маршрут в убыток — отправлять только осознанно */
  unprofitable: boolean
  /** Не влезло/не подошло — с причинами, ничего не пропадает молча */
  excluded: ExcludedLoad[]
  /** Почему собрали именно так — для экрана */
  reasons: string[]
}

// ---------------------------------------------------------------------------
// Помощники
// ---------------------------------------------------------------------------

/** Цена груза: с НДС важнее без. */
export function loadPrice(load: BuilderLoad): number {
  return Math.max(0, load.priceWithNds ?? load.priceRub ?? 0)
}

/** Груз ещё актуален: дата загрузки не в прошлом (сегодня — ещё можно). */
function isFresh(load: BuilderLoad, now: Date): boolean {
  if (!load.loadingDate) return true
  const date = new Date(load.loadingDate)
  if (Number.isNaN(date.getTime())) return true
  return date.getTime() > now.getTime() - 12 * 60 * 60 * 1000
}

/** Машины, которые вообще можно ставить (не на ТО, не в архиве). */
function usableVehicles(vehicles: BuilderVehicle[]): BuilderVehicle[] {
  return vehicles.filter((vehicle) => vehicle.status !== "maintenance")
}

/** Влезает ли груз в машину по весу и объёму. */
export function loadFitsVehicle(load: BuilderLoad, vehicle: BuilderVehicle): boolean {
  if (load.weightKg != null) {
    const capacity = vehicle.capacity ?? 0
    if (capacity > 0 && load.weightKg > capacity) return false
  }
  if (load.volumeM3 != null) {
    const volume = vehicle.volume ?? 0
    if (volume > 0 && load.volumeM3 > volume) return false
  }
  return true
}

/** Ставка за километр гружёного плеча — быстрая оценка выгоды. */
export function loadRatePerKm(load: BuilderLoad): number | null {
  if (!load.distanceKm || load.distanceKm <= 0) return null
  const price = loadPrice(load)
  if (price <= 0) return null
  return price / load.distanceKm
}

/** Деньги плеча: выручка минус топливо на пробег. */
function legMoney(
  load: BuilderLoad,
  distanceKm: number,
  vehicle: BuilderVehicle,
  fuelPrice: number | null,
): { revenue: number; fuelLiters: number | null; fuelCostRub: number | null; profitRub: number | null } {
  const revenue = loadPrice(load)
  const fuelLiters = distanceKm > 0 ? estimateFuelL(vehicle, distanceKm, load.weightKg ?? 0) : null
  const fuelCostRub =
    fuelLiters !== null && fuelPrice !== null && fuelPrice > 0
      ? Math.round(fuelLiters * fuelPrice)
      : null
  const profitRub = fuelCostRub !== null ? revenue - fuelCostRub : null
  return { revenue, fuelLiters, fuelCostRub, profitRub }
}

/**
 * Цепочка под конкретную машину.
 *
 * Жадный обход: из текущего города берём самый выгодный груз (прибыль на
 * километр), переезжаем в его город выгрузки, повторяем. Убыточные плечи
 * не берём — маршрут должен окупаться на каждом шаге. Грузы из keepIds
 * (уже согласованы звонком) имеют приоритет на своём плече.
 */
function buildChain(
  startCity: string,
  pool: BuilderLoad[],
  vehicle: BuilderVehicle,
  fuelPrice: number | null,
  maxLegs: number,
  minProfitPerKm: number,
  keepIds: readonly string[],
): RouteLeg[] {
  const legs: RouteLeg[] = []
  const used = new Set<string>()
  let current = cityKey(startCity)

  for (let step = 0; step < maxLegs; step += 1) {
    const candidates = pool.filter(
      (load) => !used.has(load.id) && cityKey(load.fromCity) === current && loadFitsVehicle(load, vehicle),
    )

    // Сначала согласованные: логист уже договорился — они в приоритете
    const ordered = [...candidates].sort((a, b) => {
      const aKeep = keepIds.includes(a.id) ? 0 : 1
      const bKeep = keepIds.includes(b.id) ? 0 : 1
      if (aKeep !== bKeep) return aKeep - bKeep
      const ra = loadRatePerKm(a) ?? -1
      const rb = loadRatePerKm(b) ?? -1
      return rb - ra
    })

    let best: { load: BuilderLoad; money: ReturnType<typeof legMoney>; profitPerKm: number } | null = null
    for (const load of ordered) {
      const km = Math.max(0, load.distanceKm ?? 0)
      const money = legMoney(load, km, vehicle, fuelPrice)
      if (money.revenue <= 0) continue
      if (money.profitRub !== null && money.profitRub <= 0) continue
      if (km > 0) {
        const perKm = money.profitRub !== null ? money.profitRub / km : money.revenue / km
        if (perKm < minProfitPerKm) continue
      }
      best = { load, money, profitPerKm: km > 0 ? (money.profitRub ?? money.revenue) / km : 0 }
      break
    }

    if (!best) break

    used.add(best.load.id)
    legs.push({
      load: best.load,
      deadheadKm: 0,
      loadedKm: Math.max(0, best.load.distanceKm ?? 0),
      revenue: best.money.revenue,
      fuelLiters: best.money.fuelLiters === null ? null : Math.round(best.money.fuelLiters),
      fuelCostRub: best.money.fuelCostRub,
      profitRub: best.money.profitRub,
      profitPerKm: Math.round(best.profitPerKm),
      returnsHome: cityKey(best.load.toCity) === cityKey(startCity),
    })
    current = cityKey(best.load.toCity)
  }

  return legs
}

// ---------------------------------------------------------------------------
// Сборка маршрута
// ---------------------------------------------------------------------------

/**
 * Собрать маршрут из грузов биржи.
 *
 * Перебираем автопарк: для каждой машины строим цепочку и оставляем вариант
 * с лучшей прибылью на километр. Так «маленькая машина рядом» не съедает
 * выгодный длинный маршрут на фуре, и наоборот.
 *
 * null — собрать нечего: объяснение лежит в поле `reason` вызывающему
 * через исключения (см. excludeLoads), либо массив грузов пуст.
 */
export function buildRoute(options: BuildRouteOptions): BuiltRoute | null {
  const now = options.now ?? new Date()
  const maxLegs = Math.max(1, Math.min(options.maxLegs ?? 4, 6))
  const minProfitPerKm = options.minProfitPerKm ?? 25
  const fuelPrice = options.fuelPriceRubPerL
  const excludeIds = new Set(options.excludeIds ?? [])
  const keepIds = options.keepIds ?? []

  const excluded: ExcludedLoad[] = []
  const pool: BuilderLoad[] = []

  for (const load of options.loads) {
    if (load.status !== "new") {
      excluded.push({ load, reason: "груз уже не в бирже" })
      continue
    }
    if (excludeIds.has(load.id)) {
      excluded.push({ load, reason: "исключён вами" })
      continue
    }
    if (!cityKey(load.fromCity) || !cityKey(load.toCity)) {
      excluded.push({ load, reason: "маршрут неизвестен" })
      continue
    }
    if (loadPrice(load) <= 0) {
      excluded.push({ load, reason: "ставка не озвучена" })
      continue
    }
    if (!isFresh(load, now)) {
      excluded.push({ load, reason: "дата загрузки прошла" })
      continue
    }
    pool.push(load)
  }

  if (pool.length === 0) return null

  // Точка старта: база машины, иначе город самого выгодного груза
  const startCity = options.startCity.trim()
  const startFromCity = startCity.length > 0
  const effectiveStart = startFromCity
    ? startCity
    : (shortCity(pool[0].fromCity) ?? startCity)

  const vehicles = usableVehicles(options.vehicles)
  if (vehicles.length === 0) return null

  // Перебор машин: маленькие сначала — дешевле рейс
  const vehicleOrder = [...vehicles].sort((a, b) => {
    const byStatus = Number(a.status !== "available") - Number(b.status !== "available")
    if (byStatus !== 0) return byStatus
    return (a.capacity ?? Number.MAX_SAFE_INTEGER) - (b.capacity ?? Number.MAX_SAFE_INTEGER)
  })

  let bestRoute: BuiltRoute | null = null

  for (const vehicle of vehicleOrder) {
    // Грузы, которые влезают в эту машину
    const fitting = pool.filter((load) => loadFitsVehicle(load, vehicle))
    if (fitting.length === 0) continue

    const legs = buildChain(
      effectiveStart,
      fitting,
      vehicle,
      fuelPrice,
      maxLegs,
      minProfitPerKm,
      keepIds,
    )
    if (legs.length === 0) continue

    const totalRevenue = legs.reduce((sum, leg) => sum + leg.revenue, 0)
    const totalLoaded = legs.reduce((sum, leg) => sum + leg.loadedKm, 0)
    const lastCity = shortCity(legs[legs.length - 1].load.toCity)
    const homeKey = cityKey(effectiveStart)
    const atHome = cityKey(legs[legs.length - 1].load.toCity) === homeKey

    const route = finalize({
      legs,
      vehicle,
      effectiveStart,
      startFromCity,
      pool,
      preExcluded: excluded,
      excludeIds,
      keepIds,
      fuelPrice,
      totalRevenue,
      totalLoaded,
      lastCity,
      atHome,
      now,
      minProfitPerKm,
    })
    if (!route) continue

    if (
      bestRoute === null ||
      (route.profitPerKm ?? -1) > (bestRoute.profitPerKm ?? -1) ||
      (route.profitPerKm === bestRoute.profitPerKm && route.totalRevenue > bestRoute.totalRevenue)
    ) {
      bestRoute = route
    }
  }

  return bestRoute
}

interface FinalizeInput {
  legs: RouteLeg[]
  vehicle: BuilderVehicle
  effectiveStart: string
  startFromCity: boolean
  pool: BuilderLoad[]
  /** Грузы, отсеянные ещё до цепочки: не в бирже, исключены вами, без ставки… */
  preExcluded: ExcludedLoad[]
  excludeIds: Set<string>
  keepIds: readonly string[]
  fuelPrice: number | null
  totalRevenue: number
  totalLoaded: number
  lastCity: string
  atHome: boolean
  now: Date
  minProfitPerKm: number
}

/** Считать итоги маршрута и собрать объяснения — один раз на вариант. */
function finalize(input: FinalizeInput): BuiltRoute | null {
  const {
    legs,
    vehicle,
    effectiveStart,
    startFromCity,
    pool,
    preExcluded,
    excludeIds,
    keepIds,
    fuelPrice,
    totalRevenue,
    totalLoaded,
    lastCity,
    atHome,
  } = input

  // Обратное плечо: домой с грузом — иначе порожний возврат (в прибыль не
  // включаем: точное расстояние домой без координат городов не узнать, а
  // занижать прибыль молча — обманывать логиста).
  const returnsHomeWithLoad = atHome || legs.some((leg) => leg.returnsHome)

  const totalDistanceKm = totalLoaded
  const hasFuel = legs.every((leg) => leg.fuelCostRub !== null)
  const totalFuelCostRub = hasFuel
    ? legs.reduce((sum, leg) => sum + (leg.fuelCostRub as number), 0)
    : null
  const totalProfitRub = totalFuelCostRub !== null ? totalRevenue - totalFuelCostRub : null
  const profitPerKm =
    totalProfitRub !== null && totalDistanceKm > 0 ? Math.round(totalProfitRub / totalDistanceKm) : null
  const needsFuelSetup = vehicle.fuelConsumptionPer100 == null || vehicle.fuelConsumptionPer100 <= 0

  // Что осталось за бортом — с причинами. Сначала отсеянные до цепочки
  // (их причина известена точно), потом непопавшие грузы из общего пула.
  const usedIds = new Set(legs.map((leg) => leg.load.id))
  const excluded: ExcludedLoad[] = [...preExcluded]
  for (const load of pool) {
    if (usedIds.has(load.id)) continue
    if (excluded.some((item) => item.load.id === load.id)) continue
    let reason = "другое направление"
    if (excludeIds.has(load.id)) reason = "исключён вами"
    else if (loadPrice(load) <= 0) reason = "ставка не озвучена"
    else if (!loadFitsVehicle(load, vehicle)) reason = "не влезает в выбранную машину"
    else if (legs.some((leg) => cityKey(leg.load.toCity) === cityKey(load.fromCity))) {
      const km = Math.max(0, load.distanceKm ?? 0)
      const money = legMoney(load, km, vehicle, fuelPrice)
      if (money.profitRub !== null && money.profitRub <= 0) reason = "плечо в убыток"
      else if (km > 0 && (money.profitRub ?? money.revenue) / km < input.minProfitPerKm) {
        reason = "слишком низкая ставка"
      }
    }
    excluded.push({ load, reason })
  }

  const reasons: string[] = []
  if (!startFromCity) {
    reasons.push(`Город старта не указан — начали от самого выгодного груза в ${shortCity(effectiveStart)}`)
  }
  if (legs.length > 1) {
    reasons.push(`Цепочка из ${legs.length} плеч: ${shortCity(effectiveStart)} → ${lastCity}`)
  }
  if (returnsHomeWithLoad) {
    reasons.push(`Возврат домой с грузом — машина не поедет пустой`)
  } else if (!atHome) {
    reasons.push(`Обратно в ${shortCity(effectiveStart)} — порожним пробегом, точное расстояние посчитает навигатор`)
  }
  if (needsFuelSetup) {
    reasons.push("У машины не заполнен расход топлива — прибыль не посчитана")
  }
  if (keepIds.length > 0) {
    const kept = legs.filter((leg) => keepIds.includes(leg.load.id)).length
    if (kept > 0) reasons.push(`Согласованные грузы сохранены: ${kept}`)
  }

  const path = [shortCity(effectiveStart)]
  for (const leg of legs) path.push(shortCity(leg.load.toCity))

  return {
    id: `route:${legs.map((leg) => leg.load.id).join("-")}`,
    startCity: shortCity(effectiveStart),
    path,
    legs,
    vehicle,
    returnDeadheadKm: 0,
    returnsHomeWithLoad,
    totalDistanceKm,
    totalRevenue,
    totalFuelCostRub,
    totalProfitRub,
    profitPerKm,
    needsFuelSetup,
    unprofitable: totalProfitRub !== null && totalProfitRub < 0,
    excluded,
    reasons,
  }
}

/** Строка-итог маршрута для карточек и шапок. */
export function routeSummaryLine(route: BuiltRoute): string {
  const parts = [
    `${route.legs.length} ${pluralLegs(route.legs.length)}`,
    route.totalDistanceKm > 0 ? `${route.totalDistanceKm} км` : null,
    route.totalRevenue > 0 ? formatMoney(route.totalRevenue) : null,
    route.totalProfitRub !== null
      ? route.totalProfitRub < 0
        ? `убыток ${formatMoney(Math.abs(route.totalProfitRub))}`
        : `прибыль ${formatMoney(route.totalProfitRub)}`
      : null,
  ]
  return parts.filter(Boolean).join(" · ")
}

export function pluralLegs(count: number): string {
  const n = Math.abs(count) % 100
  const tail = n % 10
  if (n > 10 && n < 20) return "плеч"
  if (tail > 1 && tail < 5) return "плеча"
  if (tail === 1) return "плечо"
  return "плеч"
}
