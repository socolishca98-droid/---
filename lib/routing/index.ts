// lib/routing/index.ts
//
// Точка входа нового расчётного ядра: «спланируй рейсы этой организации».
//
// Конвейер: Order Filter → Compatibility → Distance (prefetch) → Route Builder
// (модели А и Б) → Optimizer → (валидатор вызывается тестами и API отдельно).
//
// Ядро работает только с переданными данными: ни Prisma, ни fetch к базе, ни
// чтения окружения внутри. Поэтому один и тот же вход гарантирует один и тот же
// результат — воспроизводимость, которой не было у расчёта в браузере.

import { materialize, searchConsolidated, searchSequential, type BuildContext } from "./builder"
import { compatible } from "./compatibility"
import { DistanceEngine } from "./distance"
import { rankVariants, explainRejections } from "./optimizer"
import { validatePlan, type ValidationResult } from "./validator"
import type {
  LoadOrder,
  PlanResult,
  PlanStats,
  RegionParams,
  RoutePlan,
  Settings,
  Vehicle,
} from "./types"

export * from "./types"
export { DistanceEngine, straightKm, regionKey } from "./distance"
export { compatible, acceptedBodies, bodyClass } from "./compatibility"
export { capacityProfile } from "./capacity"
export { computeEconomics, driverPay, workingHours } from "./economics"
export { validatePlan } from "./validator"
export { rankVariants, explainRejections } from "./optimizer"
export {
  materialize,
  searchSequential,
  searchConsolidated,
  handlingHours,
  fuelLiters,
} from "./builder"
export { zoneOffsetMinutes, localClock, formatLocal, atLocalHour } from "./time"

/** Настройки по умолчанию — нейтральные, без единого города и региона. */
export const DEFAULT_SETTINGS: Settings = {
  returnMode: "preferred",
  maxRouteHours: 72,
  maxLegs: 8,
  drivingLimitHours: 9,
  restHours: 11,
  detourBaseKm: 150,
  detourShare: 0.15,
  minContributionPerKm: 0,
  preparationHours: 2,
  startRadiusKm: 300,
  /**
   * Норма погрузки/выгрузки — 9 минут на тонну. Здесь было 0,6 ч/т, а адаптер
   * организации уже считал 0,15: два разных значения одной нормы в одном ядре.
   * Держим одно — то, что прошло проверку календаря (10,8 ч на 18 тонн давали
   * половину суток на одну операцию).
   */
  handlingHoursPerTon: 0.15,
  minHandlingHours: 1.5,
  openingHour: 8,
  consolidationEnabled: true,
  maxConcurrentOrders: 3,
  ranking: "profit",
}

export interface PlanInput {
  orders: LoadOrder[]
  vehicles: Vehicle[]
  settings: Settings
  regions: RegionParams[]
  now: Date
  /** Адрес OSRM; пусто — расстояния оцениваются и это видно в результате */
  osrmUrl?: string | null
  /** Предел заказов, при котором перебор точный */
  exactLimit?: number
  fetchImpl?: typeof fetch
}

export interface FleetPlan {
  organisationId: string
  perVehicle: PlanResult[]
  /** Все валидные варианты одним списком — для карты «кто что везёт» */
  plans: RoutePlan[]
  validations: Array<{ planId: string; result: ValidationResult }>
  stats: PlanStats
}

function emptyStats(exactLimit = 12): PlanStats {
  return {
    consideredStates: 0,
    prunedStates: 0,
    distanceCalls: 0,
    distanceCacheHits: 0,
    elapsedMs: 0,
    exact: true,
    exactSequential: true,
    exactConsolidated: true,
    exactLimit,
  }
}

/** Отбор заказов организации: только свои, только не просроченные по дате. */
export function filterOrders(orders: LoadOrder[], organisationId: string, now: Date): LoadOrder[] {
  return orders.filter((order) => {
    if (order.organisationId !== organisationId) return false
    if (order.window.pickup.to) {
      const to = new Date(order.window.pickup.to)
      if (!Number.isNaN(to.getTime()) && to.getTime() < now.getTime() - 12 * 3600000) return false
    }
    return true
  })
}

/**
 * Расстояния, которые заведомо понадобятся: все пары «база/точка — точка».
 * Предзагрузка идёт до поиска, чтобы внутри поиска не было сети.
 */
function likelyPairs(orders: LoadOrder[], vehicles: Vehicle[]) {
  const pairs: Array<{ a: LoadOrder["pickup"]; b: LoadOrder["pickup"]; mode: "loaded" | "deadhead" }> =
    []
  for (const vehicle of vehicles) {
    for (const order of orders) {
      pairs.push({ a: vehicle.homeBase, b: order.pickup, mode: "deadhead" })
      pairs.push({ a: order.pickup, b: order.delivery, mode: "loaded" })
      pairs.push({ a: order.delivery, b: vehicle.homeBase, mode: "deadhead" })
      for (const other of orders) {
        if (other.id === order.id) continue
        pairs.push({ a: order.delivery, b: other.pickup, mode: "deadhead" })
      }
    }
  }
  return pairs
}

/** План для одной машины. */
export async function planVehicle(input: PlanInput, vehicle: Vehicle): Promise<PlanResult> {
  const startedAt = Date.now()
  const exactLimit = input.exactLimit ?? 12
  const stats = emptyStats(exactLimit)
  const orders = filterOrders(input.orders, vehicle.organisationId, input.now)

  // 1–2. Совместимость
  const details = new Map<string, string[]>()
  const compatibleOrders: LoadOrder[] = []
  for (const order of orders) {
    const result = compatible(order, vehicle)
    if (result.fits) compatibleOrders.push(order)
    else details.set(order.id, result.reasons)
  }

  // 3. Расстояния: предзагрузка (OSRM, если настроен)
  const distance = new DistanceEngine({
    osrmUrl: input.osrmUrl ?? null,
    regions: input.regions,
    fetchImpl: input.fetchImpl,
  })
  await distance.prefetch(likelyPairs(compatibleOrders, [vehicle]))

  const context: BuildContext = {
    orders: compatibleOrders,
    vehicle,
    settings: input.settings,
    distance,
    now: input.now,
    stats,
  }

  // 4. Поиск: модель А (точно) и модель Б (сборные)
  const sequential = searchSequential(context, { exactLimit })
  // Сборная модель считает сначала самые перспективные по деньгам заказы, а не
  // первые попавшиеся из пула.
  const byLikelihood = [...compatibleOrders].sort(
    (a, b) => scoreForConsolidation(b) - scoreForConsolidation(a),
  )
  const consolidated = searchConsolidated(context, { ordersByLikelihood: byLikelihood })
  const all = [...sequential, ...consolidated]

  // 5. Сравнение моделей — ДО ранжирования, чтобы рекомендация могла сказать,
  // почему выбрана именно эта модель, а не «так вышло».
  //
  // Логисту нужно не «вот маршрут», а «почему этот»: сборка из четырёх грузов
  // может быть выгоднее четырёх отдельных рейсов, а может — нет, и в обоих
  // случаях он должен видеть разницу словами.
  const comparison = compareModels(sequential, consolidated)
  if (comparison) {
    for (const plan of all) {
      if (plan.model === comparison.winner && plan.economics.netCommittedRub === comparison.winnerNet) {
        plan.reasons.push(comparison.text)
      }
    }
  }

  // 6. Ранжирование
  const { variants, recommended } = rankVariants(all, input.settings)

  const exactSequential =
    compatibleOrders.length <= exactLimit && sequential.every((plan) => plan.exact)
  const exactConsolidated = consolidated.every((plan) => plan.exact)
  stats.exactSequential = exactSequential
  stats.exactConsolidated = exactConsolidated
  stats.exact =
    recommended === null
      ? exactSequential && exactConsolidated
      : recommended.model === "sequential"
        ? exactSequential
        : exactConsolidated
  stats.distanceCalls = distance.calls
  stats.distanceCacheHits = distance.hits
  stats.elapsedMs = Date.now() - startedAt

  return {
    organisationId: vehicle.organisationId,
    vehicleId: vehicle.id,
    variants,
    recommended,
    rejected: explainRejections(
      orders,
      all,
      new Set(compatibleOrders.map((order) => order.id)),
      details,
      // Одиночный рейс по этому грузу — чтобы отказ был с цифрой, а не
      // «не окупает пробег». Материализация одного груза дешёвая, и считается
      // только для грузов, которые в план не попали.
      (orderId) => {
        const order = compatibleOrders.find((item) => item.id === orderId)
        if (!order) return null
        const single = materialize(
          context,
          [
            { kind: "load", order },
            { kind: "unload", order },
          ],
          {
            model: "sequential",
            includeReturn: input.settings.returnMode !== "free",
            exact: true,
          },
        )
        if (!single.plan) return null
        return {
          netRub: single.plan.economics.netCommittedRub,
          totalKm: Math.round(single.plan.economics.totalKm),
          emptyKm: Math.round(single.plan.economics.emptyKm),
        }
      },
    ),
    stats,
  }
}

/**
 * Сравнение моделей А и Б по деньгам с обязательным возвратом.
 *
 * Возвращает победителя и формулировку для объяснения. Если выгода меньше
 * 1 % — это не выгода, а округление, и сравнение не навязывается.
 */
function compareModels(
  sequential: RoutePlan[],
  consolidated: RoutePlan[],
): { winner: "sequential" | "consolidated"; winnerNet: number; text: string } | null {
  if (sequential.length === 0 || consolidated.length === 0) return null
  const bestSequential = sequential.reduce((best, plan) =>
    plan.economics.netCommittedRub > best.economics.netCommittedRub ? plan : best,
  )
  const bestConsolidated = consolidated.reduce((best, plan) =>
    plan.economics.netCommittedRub > best.economics.netCommittedRub ? plan : best,
  )
  const difference = bestConsolidated.economics.netCommittedRub - bestSequential.economics.netCommittedRub
  const scale = Math.max(1, Math.abs(bestSequential.economics.netCommittedRub))
  if (Math.abs(difference) / scale < 0.01) {
    return {
      winner: bestConsolidated.economics.netCommittedRub >= bestSequential.economics.netCommittedRub
        ? "consolidated"
        : "sequential",
      winnerNet: Math.max(
        bestConsolidated.economics.netCommittedRub,
        bestSequential.economics.netCommittedRub,
      ),
      text: "Сборная и последовательная схемы дают практически одинаковый результат — выбирайте по удобству для клиента",
    }
  }
  if (difference > 0) {
    return {
      winner: "consolidated",
      winnerNet: bestConsolidated.economics.netCommittedRub,
      text:
        `Сборка выгоднее последовательных рейсов на ${Math.round(difference)} ₽ ` +
        `(${bestConsolidated.orderIds.length} груза в одном кузове против ${bestSequential.orderIds.length} по очереди)`,
    }
  }
  return {
    winner: "sequential",
    winnerNet: bestSequential.economics.netCommittedRub,
    text:
      `Последовательная схема выгоднее сборки на ${Math.round(-difference)} ₽: ` +
      "грузы слишком далеко друг от друга, чтобы делить кузов",
  }
}

/** Порядок рассмотрения для сборной модели: деньги за километр прямого плеча. */
function scoreForConsolidation(order: LoadOrder): number {
  const km = order.exchangeKm && order.exchangeKm > 0 ? order.exchangeKm : 1
  return order.rate.amount / km
}

/** План на весь автопарк организации. */
export async function planFleet(input: PlanInput): Promise<FleetPlan> {
  const startedAt = Date.now()
  const organisationId = input.vehicles[0]?.organisationId ?? ""
  // Только свои машины и только те, что не в ремонте. Чужая машина в расчёт
  // попасть не может: организация — не параметр запроса, а свойство машины.
  const vehicles = input.vehicles.filter(
    (vehicle) => vehicle.organisationId === organisationId && vehicle.status !== "maintenance",
  )

  const perVehicle: PlanResult[] = []
  for (const vehicle of vehicles) {
    perVehicle.push(await planVehicle(input, vehicle))
  }

  const plans = perVehicle.flatMap((result) => result.variants)
  const validations = plans.map((plan) => ({
    planId: plan.id,
    result: validatePlan(plan, input.orders, vehicleById(vehicles, plan.vehicleId), input.settings),
  }))

  const stats = emptyStats(input.exactLimit ?? 12)
  stats.consideredStates = perVehicle.reduce((sum, item) => sum + item.stats.consideredStates, 0)
  stats.prunedStates = perVehicle.reduce((sum, item) => sum + item.stats.prunedStates, 0)
  stats.distanceCalls = perVehicle.reduce((sum, item) => sum + item.stats.distanceCalls, 0)
  stats.distanceCacheHits = perVehicle.reduce(
    (sum, item) => sum + item.stats.distanceCacheHits,
    0,
  )
  stats.exact = perVehicle.every((item) => item.stats.exact)
  stats.exactSequential = perVehicle.every((item) => item.stats.exactSequential)
  stats.exactConsolidated = perVehicle.every((item) => item.stats.exactConsolidated)
  stats.elapsedMs = Date.now() - startedAt

  return { organisationId, perVehicle, plans, validations, stats }
}

function vehicleById(vehicles: Vehicle[], id: string): Vehicle {
  return vehicles.find((vehicle) => vehicle.id === id) ?? vehicles[0]
}
