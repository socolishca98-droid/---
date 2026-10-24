// lib/logist-mobile/route-builder.ts
//
// Сборщик МАРШРУТА из грузов биржи ATI — «сердце» помощника.
//
// Зачем отдельно от route-assistant: помощник сборки заказов решал другую
// задачу — раскладывать СВОИ заказы по направлениям. Здесь логика другая,
// ровно как работает реальный логист на бирже:
//
//   1. есть точка старта — база или город, где стоит машина;
//   2. из неё берём груз (из того же города или «по пути» — в пределах
//      радиуса, если известны координаты) и едем в его город выгрузки;
//   3. оттуда — следующий груз, и так складывается цепочка А → Б → В;
//   4. на каждом плече машина едет гружёной; прибыль = ставка − топливо
//      на гружёный путь и на подъезд к погрузке;
//   5. убыточные плечи не берём — маршрут должен окупаться на каждом шаге;
//   6. в конце цепочки считаем дорогу домой: если обратного груза нет,
//       порожний пробег входит в расходы, и прибыль это учитывает.
//
// Модуль чистый (без Next, Prisma, React) — его проверяет юнит-тест
// tests/logist-mobile-route-builder.test.mjs.

import { estimateFuelL } from "../fleet/fuel"
import { normalizeCityKey } from "./city-norm"
import { formatMoney, shortCity } from "./format"

// ---------------------------------------------------------------------------
// Вход
// ---------------------------------------------------------------------------

/** Точка на карте. */
export interface Point {
  lat: number
  lng: number
}

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
  /** Координаты города погрузки — если геокодер знает город */
  fromPoint?: Point | null
  /** Координаты города выгрузки */
  toPoint?: Point | null
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
  /**
   * Расход не заполнен в карточке машины — стоит оценка по типу кузова.
   * Экран честно пишет об этом: прибыль примерная, точные литры появятся,
   * когда расход заполнят.
   */
  fuelEstimated?: boolean
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
   * Радиус «по пути», км: груз можно взять, если его город погрузки
   * не дальше этого от текущей точки маршрута. Ноль — только точное
   * совпадение города. По умолчанию 150 км.
   */
  detourKm?: number
  /** Координаты города старта — для радиуса «по пути» и возврата домой */
  startPoint?: Point | null
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

/** Одно плечо маршрута: один груз от текущей точки до города выгрузки. */
export interface RouteLeg {
  load: BuilderLoad
  /** Порожний пробег до погрузки, км (0 — груз из города, где стоим) */
  deadheadKm: number
  /** Гружёное плечо, км */
  loadedKm: number
  revenue: number
  fuelLiters: number | null
  fuelCostRub: number | null
  profitRub: number | null
  profitPerKm: number | null
  /** Груз везёт машину домой — обратное плечо уже занято */
  returnsHome: boolean
  /** Груз «по пути»: город погрузки не совпал, но рядом с маршрутом */
  byTheWay: boolean
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
  /** Города по порядку: старт → точки выгрузки */
  path: string[]
  legs: RouteLeg[]
  vehicle: BuilderVehicle | null
  /** Дорога домой в конце маршрута, км. 0 — вернулись с грузом */
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

/** Машины, которые вообще можно ставить (не на ТО). */
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

/**
 * Расстояние между двумя точками по дуге, км (формула гаверсинуса).
 * Точность на сотнях километров — с ошибкой меньше километра, для
 * решения «взять или нет» этого хватает.
 */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
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
 * Жадный обход: из текущего города берём самый выгодный груз — из того же
 * города или «по пути» (если точка погрузки в пределах радиуса), переезжаем
 * в его город выгрузки, повторяем. Убыточные плечи не берём. Грузы из
 * keepIds (уже согласованы звонком) имеют приоритет на своём шаге.
 */
function buildChain(
  startCity: string,
  startPoint: Point | null,
  pool: BuilderLoad[],
  vehicle: BuilderVehicle,
  fuelPrice: number | null,
  maxLegs: number,
  minProfitPerKm: number,
  detourKm: number,
  keepIds: readonly string[],
): RouteLeg[] {
  const legs: RouteLeg[] = []
  const used = new Set<string>()
  // Города, с которых уже забирали: машина не может трижды ездить «из точки
  // А в точку Б» — это три отдельные поездки, а не один маршрут. Поэтому
  // с одной погрузочной точки берём один груз.
  const usedFromKeys = new Set<string>()
  const startKey = normalizeCityKey(startCity)
  let currentKey = startKey
  let currentPoint: Point | null = startPoint

  for (let step = 0; step < maxLegs; step += 1) {
    // Кандидаты: город совпал ИЛИ груз «по пути» (если есть координаты)
    const candidates = pool.filter((load) => {
      if (used.has(load.id)) return false
      if (!loadFitsVehicle(load, vehicle)) return false
      if (usedFromKeys.has(normalizeCityKey(load.fromCity))) return false
      if (normalizeCityKey(load.fromCity) === currentKey) return true
      if (detourKm > 0 && currentPoint && load.fromPoint) {
        return haversineKm(currentPoint, load.fromPoint) <= detourKm
      }
      return false
    })

    // Сначала согласованные: логист уже договорился — они в приоритете
    const ordered = [...candidates].sort((a, b) => {
      const aKeep = keepIds.includes(a.id) ? 0 : 1
      const bKeep = keepIds.includes(b.id) ? 0 : 1
      if (aKeep !== bKeep) return aKeep - bKeep
      const ra = loadRatePerKm(a) ?? -1
      const rb = loadRatePerKm(b) ?? -1
      return rb - ra
    })

    let best: {
      load: BuilderLoad
      money: ReturnType<typeof legMoney>
      deadheadKm: number
      profitPerKm: number
      byTheWay: boolean
    } | null = null
    for (const load of ordered) {
      const sameCity = normalizeCityKey(load.fromCity) === currentKey
      const deadheadKm =
        sameCity || !currentPoint || !load.fromPoint
          ? 0
          : haversineKm(currentPoint, load.fromPoint)
      const loadedKm = Math.max(0, load.distanceKm ?? 0)
      const totalKm = deadheadKm + loadedKm
      const money = legMoney(load, totalKm, vehicle, fuelPrice)
      if (money.revenue <= 0) continue
      if (money.profitRub !== null && money.profitRub <= 0) continue
      if (totalKm > 0) {
        const perKm = money.profitRub !== null ? money.profitRub / totalKm : money.revenue / totalKm
        if (perKm < minProfitPerKm) continue
      }
      best = {
        load,
        money,
        deadheadKm,
        profitPerKm: totalKm > 0 ? (money.profitRub ?? money.revenue) / totalKm : 0,
        byTheWay: !sameCity,
      }
      break
    }

    if (!best) break

    used.add(best.load.id)
    usedFromKeys.add(normalizeCityKey(best.load.fromCity))
    legs.push({
      load: best.load,
      deadheadKm: best.deadheadKm,
      loadedKm: Math.max(0, best.load.distanceKm ?? 0),
      revenue: best.money.revenue,
      fuelLiters: best.money.fuelLiters === null ? null : Math.round(best.money.fuelLiters),
      fuelCostRub: best.money.fuelCostRub,
      profitRub: best.money.profitRub,
      profitPerKm: Math.round(best.profitPerKm),
      returnsHome: normalizeCityKey(best.load.toCity) === startKey,
      byTheWay: best.byTheWay,
    })
    currentKey = normalizeCityKey(best.load.toCity)
    currentPoint = best.load.toPoint ?? currentPoint
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
 */
export function buildRoute(options: BuildRouteOptions): BuiltRoute | null {
  const now = options.now ?? new Date()
  const maxLegs = Math.max(1, Math.min(options.maxLegs ?? 4, 6))
  const minProfitPerKm = options.minProfitPerKm ?? 25
  const detourKm = options.detourKm ?? 150
  const fuelPrice = options.fuelPriceRubPerL
  const excludeIds = new Set(options.excludeIds ?? [])
  const keepIds = options.keepIds ?? []

  const preExcluded: ExcludedLoad[] = []
  const pool: BuilderLoad[] = []

  for (const load of options.loads) {
    if (load.status !== "new") {
      preExcluded.push({ load, reason: "груз уже не в бирже" })
      continue
    }
    if (excludeIds.has(load.id)) {
      preExcluded.push({ load, reason: "исключён вами" })
      continue
    }
    if (!normalizeCityKey(load.fromCity) || !normalizeCityKey(load.toCity)) {
      preExcluded.push({ load, reason: "маршрут неизвестен" })
      continue
    }
    if (loadPrice(load) <= 0) {
      preExcluded.push({ load, reason: "ставка не озвучена" })
      continue
    }
    if (!isFresh(load, now)) {
      preExcluded.push({ load, reason: "дата загрузки прошла" })
      continue
    }
    pool.push(load)
  }

  if (pool.length === 0) return null

  // Точка старта: база машины, иначе город самого выгодного груза
  const startCity = options.startCity.trim()
  const startFromCity = startCity.length > 0
  const effectiveStart = startFromCity ? startCity : shortCity(pool[0].fromCity)

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
      options.startPoint ?? null,
      fitting,
      vehicle,
      fuelPrice,
      maxLegs,
      minProfitPerKm,
      detourKm,
      keepIds,
    )
    if (legs.length === 0) continue

    const totalRevenue = legs.reduce((sum, leg) => sum + leg.revenue, 0)
    const totalLoaded = legs.reduce((sum, leg) => sum + leg.loadedKm, 0)
    const totalDeadhead = legs.reduce((sum, leg) => sum + leg.deadheadKm, 0)
    const lastLeg = legs[legs.length - 1]
    const lastCity = shortCity(lastLeg.load.toCity)
    const atHome = normalizeCityKey(lastLeg.load.toCity) === normalizeCityKey(effectiveStart)

    const route = finalize({
      legs,
      vehicle,
      effectiveStart,
      startFromCity,
      startPoint: options.startPoint ?? null,
      pool,
      preExcluded,
      excludeIds,
      keepIds,
      fuelPrice,
      totalRevenue,
      totalLoaded,
      totalDeadhead,
      lastCity,
      atHome,
      now,
      minProfitPerKm,
      detourKm,
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
  startPoint: Point | null
  pool: BuilderLoad[]
  /** Грузы, отсеянные ещё до цепочки: не в бирже, исключены вами, без ставки… */
  preExcluded: ExcludedLoad[]
  excludeIds: Set<string>
  keepIds: readonly string[]
  fuelPrice: number | null
  totalRevenue: number
  totalLoaded: number
  totalDeadhead: number
  lastCity: string
  atHome: boolean
  now: Date
  minProfitPerKm: number
  detourKm: number
}

/** Считать итоги маршрута и собрать объяснения — один раз на вариант. */
function finalize(input: FinalizeInput): BuiltRoute | null {
  const {
    legs,
    vehicle,
    effectiveStart,
    startFromCity,
    startPoint,
    pool,
    preExcluded,
    excludeIds,
    keepIds,
    fuelPrice,
    totalRevenue,
    totalLoaded,
    totalDeadhead,
    lastCity,
    atHome,
  } = input

  // Дорога домой: если последнее плечо не привело на базу, считаем порожний
  // возврат — иначе прибыль маршрута была бы завышена на весь обратный путь.
  const lastPoint = legs[legs.length - 1].load.toPoint ?? null
  const returnDeadheadKm = atHome || !startPoint || !lastPoint ? 0 : haversineKm(startPoint, lastPoint)
  const returnFuelLiters =
    returnDeadheadKm > 0 ? estimateFuelL(vehicle, returnDeadheadKm, 0) : null
  const returnFuelCostRub =
    returnFuelLiters !== null && fuelPrice !== null && fuelPrice > 0
      ? Math.round(returnFuelLiters * fuelPrice)
      : null

  const returnsHomeWithLoad = atHome || legs.some((leg) => leg.returnsHome)

  const totalDistanceKm = totalLoaded + totalDeadhead + returnDeadheadKm
  const hasFuel =
    legs.every((leg) => leg.fuelCostRub !== null) &&
    (returnDeadheadKm === 0 || returnFuelCostRub !== null)
  const legsFuel = legs.reduce((sum, leg) => sum + (leg.fuelCostRub ?? 0), 0)
  const totalFuelCostRub = hasFuel ? legsFuel + (returnFuelCostRub ?? 0) : null
  const totalProfitRub = totalFuelCostRub !== null ? totalRevenue - totalFuelCostRub : null
  const profitPerKm =
    totalProfitRub !== null && totalDistanceKm > 0 ? Math.round(totalProfitRub / totalDistanceKm) : null
  const needsFuelSetup = vehicle.fuelConsumptionPer100 == null || vehicle.fuelConsumptionPer100 <= 0

  // Что осталось за бортом — с причинами. Сначала отсеянные до цепочки
  // (их причина известна точно), потом непопавшие грузы из общего пула.
  const usedIds = new Set(legs.map((leg) => leg.load.id))
  const excluded: ExcludedLoad[] = [...preExcluded]
  for (const load of pool) {
    if (usedIds.has(load.id)) continue
    if (excluded.some((item) => item.load.id === load.id)) continue
    let reason = "другое направление"
    if (excludeIds.has(load.id)) reason = "исключён вами"
    else if (loadPrice(load) <= 0) reason = "ставка не озвучена"
    else if (!loadFitsVehicle(load, vehicle)) reason = "не влезает в выбранную машину"
    else if (legs.some((leg) => normalizeCityKey(leg.load.toCity) === normalizeCityKey(load.fromCity))) {
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
    reasons.push(
      `Цепочка из ${legs.length} плеч: ${shortCity(effectiveStart)} → ${lastCity}`,
    )
  }
  const byTheWay = legs.filter((leg) => leg.byTheWay).length
  if (byTheWay > 0) {
    reasons.push(`${byTheWay} груз(а) взяты «по пути» — в пределах ${input.detourKm} км от маршрута`)
  }
  if (totalDeadhead > 0) {
    reasons.push(`Подъезды к погрузке: ${totalDeadhead} км порожними — учтены в прибыли`)
  }
  if (returnsHomeWithLoad) {
    reasons.push("Возврат домой с грузом — машина не поедет пустой")
  } else if (returnDeadheadKm > 0) {
    reasons.push(
      `Обратно в ${shortCity(effectiveStart)}: ${returnDeadheadKm} км порожнем — учтено в прибыли`,
    )
  } else if (!atHome) {
    reasons.push(
      `Обратно в ${shortCity(effectiveStart)} — порожним пробегом; точное расстояние посчитает навигатор`,
    )
  }
  if (needsFuelSetup) {
    reasons.push("У машины не заполнен расход топлива — прибыль не посчитана")
  } else if (vehicle.fuelEstimated) {
    reasons.push("Расход топлива — оценка по типу кузова: уточните его в карточке машины для точной прибыли")
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
    returnDeadheadKm,
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
