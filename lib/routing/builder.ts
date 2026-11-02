// lib/routing/builder.ts
//
// Route Builder: построение и материализация транспортных цепочек.
//
// Два уровня:
//
//  1. ПОИСК (синхронный, детерминированный). Модель А — точный динамический
//     программированием по подмножествам с доминированием меток. Это не
//     «жадность с лучом»: перебираются все достижимые наборы заказов и
//     порядки, а лишние состояния отсекаются только тогда, когда одно заведомо
//     не хуже другого (пришло не позже, проехало не больше, заработало не
//     меньше). Поэтому на пуле до 12 заказов результат — оптимум, и это
//     проверяется независимым перебором в тестах.
//
//  2. МАТЕРИАЛИЗАЦИЯ. Выбранная последовательность раскладывается в stops,
//     segments, календарь, профиль загрузки и экономику — один код для модели А
//     и модели Б, чтобы расчёты не разъезжались.
//
// Модель Б (сборные) — отдельный поиск по состояниям «что уже погружено / что
// уже выгружено», с проверкой профиля загрузки на каждом участке.

import { capacityProfile, type CapacityMove } from "./capacity"
import { DistanceEngine, type SegmentInfo } from "./distance"
import { computeEconomics } from "./economics"
import { driveSegment, lateBy, readyFrom, readyFromMs, type DriveState } from "./time"
import type {
  CapacityUse,
  Economics,
  LoadOrder,
  Place,
  PlannedSegment,
  PlannedStop,
  PlanStats,
  ReturnOption,
  RoutePlan,
  Schedule,
  Settings,
  Vehicle,
} from "./types"

export interface BuildContext {
  orders: LoadOrder[]
  vehicle: Vehicle
  settings: Settings
  distance: DistanceEngine
  now: Date
  stats: PlanStats
}

const MS_HOUR = 3600000

/** Часы на погрузку/выгрузку по массе — настраиваемая функция организации. */
export function handlingHours(weightKg: number | null, settings: Settings): number {
  const tons = Math.max(0, (weightKg ?? 0) / 1000)
  return Math.max(settings.minHandlingHours, tons * settings.handlingHoursPerTon)
}

/** Литры на участок: загрузка повышает расход, но не больше чем на 15 %. */
export function fuelLiters(km: number, weightKg: number | null, vehicle: Vehicle): number {
  const base = vehicle.consumptionLPer100 ?? 0
  if (base <= 0 || km <= 0) return 0
  const loadRatio = vehicle.capacityKg > 0 ? Math.min(1, (weightKg ?? 0) / vehicle.capacityKg) : 0
  return (km / 100) * base * (1 + 0.15 * loadRatio)
}

/** Сколько смен водителя занимает рейс по норме организации. */
export function shiftCount(drivingHours: number, limit: number): number {
  return Math.max(1, Math.ceil(drivingHours / Math.max(1, limit)))
}

function samePlaceId(a: string, b: string): boolean {
  return a === b
}

// ---------------------------------------------------------------------------
// Состояние поиска
// ---------------------------------------------------------------------------

interface Label {
  /** Маска взятых заказов */
  mask: number
  /** Индекс последнего заказа (-1 — ещё не выехали) */
  last: number
  /** Текущий момент (UTC, мс) */
  time: number
  state: DriveState
  km: number
  loadedKm: number
  revenue: number
  liters: number
  /** Сколько уже накопилось (с учётом оплаты водителя по сменам) */
  net: number
  waitHours: number
  handleHours: number
  sequence: number[]
}

interface StepResult {
  label: Label
  deadheadKm: number
  loadedKm: number
  segmentSource: PlannedSegment["source"]
  waitingHours: number
  handlingHours: number
  lateWarnings: string[]
}

/**
 * Один переход: взять заказ после текущего состояния.
 *
 * Здесь считается всё, что зависит от времени и денег: подъезд, ожидание окна,
 * погрузка, гружёный путь, выгрузка. Вызывается только поиском; показ
 * маршрута пересчитывает то же самое в `materialize`, но по своей записи
 * событий — так «найденное» и «показанное» сверяются между собой, а не
 * переписываются из одного места в другое.
 */
function takeOrder(context: BuildContext, label: Label, orderIndex: number): StepResult | null {
  const { orders, vehicle, settings, distance } = context
  const order = orders[orderIndex]
  const fromPlace = label.last < 0 ? vehicle.homeBase : orders[label.last].delivery

  const deadhead =
    samePlaceId(fromPlace.id, order.pickup.id)
      ? { km: 0, hours: 0, source: "estimate" as const }
      : distance.segment(fromPlace, order.pickup, "deadhead")

  // Радиус относится только к НАЧАЛУ маршрута: первый груз ищется от базы.
  // Дальше порожний подъезд не отсекается — «отклонение ради следующего груза»
  // оценивается деньгами в поиске, а не запрещается коэффициентом. Именно
  // жёсткий порог «дальше N км не смотреть» и стоил старому сборщику целых
  // цепочек: следующий груз в 400 км бывает выгоднее, чем отсутствие груза.
  if (label.last < 0 && deadhead.km > settings.startRadiusKm + 1e-6) return null

  // Приезд на погрузку
  const driveToPickup = driveSegment(new Date(label.time), deadhead.hours, label.state, settings)
  const ready = readyFrom(
    driveToPickup.arriveAt,
    order.pickup,
    order.window.pickup.from,
    settings.openingHour,
  )
  const lateWarnings: string[] = []
  const latePickup = lateBy(ready.startAt, order.window.pickup.to)
  if (latePickup !== null) {
    lateWarnings.push(
      `к погрузке в ${order.pickup.city} опоздание ${latePickup} ч — уточните дату у фрахтователя`,
    )
  }

  const handle = handlingHours(order.weightKg, settings)
  const afterLoad = new Date(ready.startAt.getTime() + handle * MS_HOUR)

  // Гружёное плечо: километраж биржи главнее маршрутизатора
  const loaded: SegmentInfo = distance.segment(order.pickup, order.delivery, "loaded", {
    exchangeKm: order.exchangeKm ?? null,
  })
  const loadedKm = loaded.km
  const liters = fuelLiters(loadedKm, order.weightKg, vehicle)
  const driveLoaded = driveSegment(afterLoad, loaded.hours, driveToPickup.state, settings)

  const readyDelivery = readyFrom(
    driveLoaded.arriveAt,
    order.delivery,
    order.window.delivery.from,
    settings.openingHour,
  )
  const lateDelivery = lateBy(readyDelivery.startAt, order.window.delivery.to)
  if (lateDelivery !== null) {
    lateWarnings.push(
      `выгрузка в ${order.delivery.city} позже окна на ${lateDelivery} ч — нужен звонок фрахтователю`,
    )
  }
  const unloadEnd = new Date(readyDelivery.startAt.getTime() + handle * MS_HOUR)

  const revenue = order.rate.basis === "perKm" ? order.rate.amount * loadedKm : order.rate.amount
  const addedKm = deadhead.km + loadedKm
  const addedLiters = liters + fuelLiters(deadhead.km, null, vehicle)

  // Деньги этого шага: выручка минус топливо минус километровые статьи минус
  // изменение оплаты водителя при переходе на новую смену.
  const cost = vehicle.cost
  const perKm = cost.maintenancePerKm + cost.tiresPerKm + cost.otherPerKm
  const shiftsBefore = shiftCount(driveToPickup.state.drivingHours, settings.drivingLimitHours)
  const shiftsAfter = shiftCount(driveLoaded.state.drivingHours, settings.drivingLimitHours)
  const driverStep = driverPayStep(cost.driverPay, {
    shiftDelta: shiftsAfter - shiftsBefore,
    km: addedKm,
    // Время шага целиком: подъезд, ожидание окна, погрузка, плечо, выгрузка.
    hours: (unloadEnd.getTime() - new Date(label.time).getTime()) / MS_HOUR,
  })
  const net =
    label.net +
    revenue -
    addedLiters * cost.fuelPricePerL -
    perKm * addedKm -
    driverStep

  const waitHours = label.waitHours + ready.waitingHours + readyDelivery.waitingHours

  const next: Label = {
    mask: label.mask | (1 << orderIndex),
    last: orderIndex,
    time: unloadEnd.getTime(),
    state: driveLoaded.state,
    km: label.km + addedKm,
    loadedKm: label.loadedKm + loadedKm,
    revenue: label.revenue + revenue,
    liters: label.liters + addedLiters,
    net,
    waitHours,
    handleHours: label.handleHours + handle * 2,
    sequence: [...label.sequence, orderIndex],
  }

  return {
    label: next,
    deadheadKm: deadhead.km,
    loadedKm,
    segmentSource: loaded.source,
    waitingHours: ready.waitingHours + readyDelivery.waitingHours,
    handlingHours: handle * 2,
    lateWarnings,
  }
}

/** Прирост оплаты водителя на шаге — по правилу организации. */
function driverPayStep(
  rule: { kind: string; [key: string]: number | string },
  delta: { shiftDelta: number; km: number; hours: number },
): number {
  switch (rule.kind) {
    case "perShift":
      return Math.max(0, delta.shiftDelta) * Number(rule.perShift ?? 0)
    case "perKm":
      return Number(rule.perKm ?? 0) * delta.km
    case "perHour":
      return Number(rule.perHour ?? 0) * delta.hours
    case "perTrip":
      return 0
    case "mixed":
      return (
        Math.max(0, delta.shiftDelta) * Number(rule.basePerShift ?? 0) +
        Number(rule.perKm ?? 0) * delta.km
      )
    case "includedInPerKm":
      return 0
    default:
      return 0
  }
}

/**
 * Доминирование: метка A не хуже B, если пришла не позже, проехала не больше
 * часов за рулём, накопила не больше вождения с отдыха и заработала не меньше.
 */
function dominates(a: Label, b: Label): boolean {
  return (
    a.time <= b.time &&
    a.state.drivingHours <= b.state.drivingHours + 1e-9 &&
    a.state.sinceRest <= b.state.sinceRest + 1e-9 &&
    a.net >= b.net - 1e-6
  )
}

// ---------------------------------------------------------------------------
// Материализация: последовательность заказов → маршрут
// ---------------------------------------------------------------------------

export interface MaterializeResult {
  plan: RoutePlan | null
  infeasible: string | null
}

/**
 * Разложить последовательность заказов в готовый маршрут.
 *
 * `moves` — порядок операций (для модели А: погрузка+выгрузка каждого заказа
 * подряд; для модели Б — перемешанные погрузки и выгрузки нескольких заказов).
 */
export function materialize(
  context: BuildContext,
  moves: CapacityMove[],
  options: { model: RoutePlan["model"]; includeReturn: boolean; exact: boolean },
): MaterializeResult {
  const { vehicle, settings, distance, now, orders } = context
  if (moves.length === 0) return { plan: null, infeasible: "нет заказов" }

  const departAt = new Date(now.getTime() + settings.preparationHours * MS_HOUR)
  let clock = departAt
  let place: Place = vehicle.homeBase
  let state: DriveState = { sinceRest: 0, restHours: 0, drivingHours: 0 }
  let km = 0
  let loadedKm = 0
  let liters = 0
  let revenue = 0
  let waitingHours = 0
  let handlingTotal = 0
  const stops: PlannedStop[] = []
  const segments: PlannedSegment[] = []
  const warnings: string[] = []
  const assumptions: string[] = []
  const timeZoneBreaks: string[] = []
  let previousZone = vehicle.homeBase.timeZone ?? null
  let measured = true

  /** Что едет в кузове прямо сейчас. Именно это, а не тип операции, решает,
   *  порожний участок или гружёный, и сколько топлива он съел. */
  const carried = new Map<string, LoadOrder>()
  const carriedKg = () =>
    [...carried.values()].reduce((sum, item) => sum + (item.weightKg ?? 0), 0)

  const addSegment = (
    to: Place,
    kind: PlannedSegment["kind"],
    orderId: string | null,
    weightKg: number | null,
  ): SegmentInfo => {
    const same = samePlaceId(place.id, to.id)
    const info: SegmentInfo = same
      ? { km: 0, hours: 0, osrmHours: null, source: "estimate", confidence: "measured", tollsRub: null }
      : distance.segment(place, to, kind, {
          exchangeKm:
            kind === "loaded" && orderId
              ? (orders.find((item) => item.id === orderId)?.exchangeKm ?? null)
              : null,
        })
    if (info.confidence !== "measured") measured = false
    if (info.km > 0) {
      segments.push({
        from: place,
        to,
        kind,
        orderId,
        km: info.km,
        hours: Math.round(info.hours * 100) / 100,
        source: info.source,
        tollsRub: info.tollsRub,
      })
      km += info.km
      liters += fuelLiters(info.km, weightKg, vehicle)
      if (kind === "loaded") loadedKm += info.km
    }
    return info
  }

  for (const move of moves) {
    const order = move.order
    const target = move.kind === "load" ? order.pickup : order.delivery
    if (target.timeZone && previousZone && target.timeZone !== previousZone) {
      timeZoneBreaks.push(`${previousZone} → ${target.timeZone}`)
    }
    if (target.timeZone) previousZone = target.timeZone

    // Едем к следующей точке с тем, что уже в кузове.
    const carrying = carried.size > 0
    const info = addSegment(
      target,
      carrying ? "loaded" : "deadhead",
      order.id,
      carrying ? carriedKg() : null,
    )

    const drive = driveSegment(clock, info.hours, state, settings)
    state = drive.state
    const window = move.kind === "load" ? order.window.pickup : order.window.delivery
    const ready = readyFrom(drive.arriveAt, target, window.from, settings.openingHour)
    waitingHours += ready.waitingHours
    const late = lateBy(ready.startAt, window.to)
    if (late !== null) {
      warnings.push(
        `${move.kind === "load" ? "погрузка" : "выгрузка"} в ${target.city} позже окна на ${late} ч`,
      )
    }
    const handle = handlingHours(order.weightKg, settings)
    handlingTotal += handle
    const endAt = new Date(ready.startAt.getTime() + handle * MS_HOUR)
    stops.push({
      kind: move.kind,
      orderId: order.id,
      place: target,
      arriveAt: drive.arriveAt,
      startAt: ready.startAt,
      endAt,
      waitingHours: Math.round(ready.waitingHours * 100) / 100,
      handlingHours: handle,
    })
    clock = endAt
    place = target

    if (move.kind === "load") {
      carried.set(order.id, order)
    } else {
      carried.delete(order.id)
      // Выручка начисляется один раз — при выгрузке.
      const orderKm = segments
        .filter((segment) => segment.orderId === order.id && segment.kind === "loaded")
        .reduce((sum, segment) => sum + segment.km, 0)
      revenue +=
        order.rate.basis === "perKm" ? order.rate.amount * Math.max(orderKm, 0) : order.rate.amount
    }
  }

  // Возврат на базу
  const atHome = samePlaceId(place.id, vehicle.homeBase.id)
  let returned: ReturnOption = { kind: "loaded", deadheadKm: 0, costRub: 0, satisfiesMode: true }
  if (!atHome) {
    const preview = distance.segment(place, vehicle.homeBase, "deadhead")
    if (preview.confidence !== "measured") measured = false
    const returnCost = Math.round(
      fuelLiters(preview.km, null, vehicle) * vehicle.cost.fuelPricePerL +
        preview.km *
          (vehicle.cost.maintenancePerKm +
            vehicle.cost.tiresPerKm +
            vehicle.cost.tollsPerKm +
            vehicle.cost.otherPerKm),
    )
    if (options.includeReturn) {
      const info = addSegment(vehicle.homeBase, "deadhead", null, null)
      const drive = driveSegment(clock, info.hours, state, settings)
      state = drive.state
      clock = drive.arriveAt
      place = vehicle.homeBase
      stops.push({
        kind: "return",
        orderId: null,
        place: vehicle.homeBase,
        arriveAt: clock,
        startAt: clock,
        endAt: clock,
        waitingHours: 0,
        handlingHours: 0,
      })
      returned = { kind: "empty", deadheadKm: info.km, costRub: returnCost, satisfiesMode: true }
    } else {
      returned = {
        kind: "none",
        deadheadKm: preview.km,
        costRub: returnCost,
        satisfiesMode: settings.returnMode !== "required",
      }
    }
  }

  const totalHours = (clock.getTime() - departAt.getTime()) / MS_HOUR
  if (totalHours > settings.maxRouteHours + 1e-6) {
    return {
      plan: null,
      infeasible: `не влезает в лимит ${settings.maxRouteHours} ч: получилось ${Math.round(totalHours * 10) / 10} ч`,
    }
  }
  if (settings.returnMode === "required" && !atHome && !options.includeReturn) {
    return {
      plan: null,
      infeasible: "режим «возврат обязателен», а маршрут не возвращается на базу",
    }
  }

  const capacity = capacityProfile(moves, vehicle)
  if (!capacity.feasible) {
    return { plan: null, infeasible: capacity.violation ?? "превышение вместимости" }
  }

  const orderIds = [...new Set(moves.map((move) => move.order.id))]
  const shift = shiftCount(state.drivingHours, settings.drivingLimitHours)
  const schedule: Schedule = {
    events: buildEvents(stops, departAt),
    startAt: departAt,
    endAt: clock,
    drivingHours: Math.round(state.drivingHours * 10) / 10,
    restHours: Math.round(state.restHours * 10) / 10,
    waitingHours: Math.round(waitingHours * 10) / 10,
    handlingHours: Math.round(handlingTotal * 10) / 10,
    shifts: shift,
    timeZoneBreaks,
  }

  const economics: Economics = computeEconomics({
    revenue,
    totalKm: km,
    loadedKm,
    fuelLiters: liters,
    tollsRub: null,
    schedule,
    cost: vehicle.cost,
  })
  economics.netCommittedRub =
    economics.netRub -
    (returned.kind === "none" && options.includeReturn === false ? returned.costRub : 0)

  if (vehicle.consumptionEstimated) {
    assumptions.push("расход топлива не задан в карточке машины — взята оценка")
  }
  if (!measured) {
    assumptions.push("часть расстояний оценена без маршрутизатора — возможна погрешность")
  }
  if (options.model === "consolidated") {
    assumptions.push(
      "сборный рейс: несколько грузов одновременно, порядок погрузок и выгрузок проверен",
    )
  }
  if (!options.exact) {
    assumptions.push("на большом пуле перебраны не все варианты — оптимум не гарантирован")
  }
  if (warnings.length === 0 && returned.kind === "empty") {
    warnings.push(`обратно порожним: ${returned.deadheadKm} км`)
  }

  const reasons: string[] = [
    `${orderIds.length === 1 ? "Одно плечо" : `Цепочка из ${orderIds.length} плеч`}: ` +
      [
        vehicle.homeBase.city,
        ...moves.filter((m) => m.kind === "unload").map((m) => m.order.delivery.city),
      ]
        .filter((city, index, all) => index === 0 || city !== all[index - 1])
        .join(" → "),
    `В пути ${Math.round(totalHours)} ч, порожним ${Math.round(economics.emptyShare * 100)} %`,
    returned.kind === "empty"
      ? `Возврат на базу порожним: ${returned.deadheadKm} км`
      : returned.kind === "none"
        ? `Возврат на базу не включён (${returned.deadheadKm} км обошлись бы в ${returned.costRub} ₽)`
        : "Возврат на базу с грузом",
  ]

  const plan: RoutePlan = {
    id: `plan:${vehicle.id}:${options.model}:${options.includeReturn ? "return" : "open"}:${moves
      .map((m) => `${m.kind}-${m.order.id}`)
      .join(".")}`,
    organisationId: vehicle.organisationId,
    vehicleId: vehicle.id,
    model: options.model,
    orderIds,
    stops,
    segments,
    schedule,
    capacity: capacity.perSegment as CapacityUse[],
    economics,
    returned,
    exact: options.exact,
    confidence: measured ? "measured" : "estimated",
    assumptions,
    warnings,
    reasons,
  }

  return { plan, infeasible: null }
}

function buildEvents(stops: PlannedStop[], departAt: Date): Schedule["events"] {
  const events: Schedule["events"] = [{ at: departAt, kind: "depart", label: "Выезд с базы" }]
  for (const stop of stops) {
    events.push({
      at: stop.arriveAt,
      kind: "arrive",
      label: `Приехали: ${stop.place.city}`,
      place: stop.place,
      timeZone: stop.place.timeZone,
    })
    if (stop.waitingHours > 0) {
      events.push({
        at: stop.arriveAt,
        kind: "wait",
        label: `Ожидание ${Math.round(stop.waitingHours * 10) / 10} ч (окно/часы работы)`,
        place: stop.place,
        timeZone: stop.place.timeZone,
      })
    }
    events.push({
      at: stop.startAt,
      kind: stop.kind === "load" ? "load" : stop.kind === "unload" ? "unload" : "arriveBase",
      label:
        stop.kind === "return"
          ? "Возврат на базу"
          : `${stop.kind === "load" ? "Погрузка" : "Выгрузка"} ${Math.round(stop.handlingHours * 10) / 10} ч`,
      place: stop.place,
      timeZone: stop.place.timeZone,
    })
  }
  return events
}

// ---------------------------------------------------------------------------
// Модель А: точный поиск по подмножествам
// ---------------------------------------------------------------------------

export interface SearchOptions {
  maxResults?: number
  /** Предел заказов для точного перебора */
  exactLimit?: number
  /** Порядок, в котором заказы стоит подробно рассматривать (для сборной модели) */
  ordersByLikelihood?: LoadOrder[]
}

export function searchSequential(context: BuildContext, options: SearchOptions = {}): RoutePlan[] {
  const { orders, settings } = context
  const exactLimit = options.exactLimit ?? 12
  const maxResults = options.maxResults ?? 40
  const n = orders.length
  if (n === 0) return []

  // На большом пуле точный перебор невозможен — берём лучших по «деньгам за
  // километр» кандидатов, но говорим об этом честно (exact=false).
  let indices = orders.map((_, index) => index)
  let exact = n <= exactLimit
  if (!exact) {
    indices = indices
      .sort((a, b) => scoreOrder(orders[b]) - scoreOrder(orders[a]))
      .slice(0, exactLimit)
    exact = false
  }

  const layers = new Map<string, Label[]>()
  const start: Label = {
    mask: 0,
    last: -1,
    time: context.now.getTime() + settings.preparationHours * MS_HOUR,
    state: { sinceRest: 0, restHours: 0, drivingHours: 0 },
    km: 0,
    loadedKm: 0,
    revenue: 0,
    liters: 0,
    net: 0,
    waitHours: 0,
    handleHours: 0,
    sequence: [],
  }
  layers.set("0|-1", [start])

  const completed: Label[] = []
  let guard = 0
  const maxStates = 400_000

  for (let depth = 0; depth <= Math.min(settings.maxLegs, indices.length); depth += 1) {
    const current = [...layers.values()].flat().filter((label) => label.sequence.length === depth)
    if (current.length === 0) break
    for (const label of current) {
      if (guard++ > maxStates) break
      for (const index of indices) {
        if (label.mask & (1 << index)) continue
        if (label.sequence.length >= settings.maxLegs) break
        const step = takeOrder(context, label, index)
        context.stats.consideredStates += 1
        if (!step) continue
        // Возврат на базу входит в проверку срока для режимов, где он ожидается
        const needsReturn = settings.returnMode !== "free"
        const after = step.label
        const returnHours = needsReturn ? returnHoursFor(context, after) : 0
        const elapsed = (after.time - start.time) / MS_HOUR + returnHours
        if (elapsed > settings.maxRouteHours + 1e-6) {
          context.stats.prunedStates += 1
          continue
        }
        const key = `${after.mask}|${after.last}`
        const bucket = layers.get(key) ?? []
        let rejected = false
        for (const existing of bucket) {
          if (dominates(existing, after)) {
            rejected = true
            break
          }
        }
        if (rejected) {
          context.stats.prunedStates += 1
          continue
        }
        const kept = bucket.filter((existing) => !dominates(after, existing))
        context.stats.prunedStates += bucket.length - kept.length
        kept.push(after)
        layers.set(key, kept)
        completed.push(after)
      }
    }
  }

  // Лучшие завершённые цепочки → материализация
  const unique = new Map<string, Label>()
  for (const label of completed) {
    const key = label.sequence.join(">")
    const prev = unique.get(key)
    if (!prev || label.net > prev.net) unique.set(key, label)
  }
  // Сортировка — по деньгам рейса вместе с возвратом на базу: иначе цепочка,
  // бросившая машину за тысячу километров, всегда выглядит выгоднее.
  const committed = (label: Label) => label.net - returnCostFor(context, label)
  const ordered = [...unique.values()].sort((a, b) => committed(b) - committed(a)).slice(0, maxResults)

  const plans: RoutePlan[] = []
  for (const label of ordered) {
    const moves: CapacityMove[] = []
    for (const orderIndex of label.sequence) {
      const order = orders[orderIndex]
      moves.push({ kind: "load", order }, { kind: "unload", order })
    }
    const includeReturn = settings.returnMode !== "free"
    const result = materialize(context, moves, { model: "sequential", includeReturn, exact })
    if (result.plan) plans.push(result.plan)
    // Режим «предпочтительно»: показываем и вариант без возврата, чтобы логист
    // видел цену возврата.
    if (settings.returnMode === "preferred") {
      const withoutReturn = materialize(context, moves, {
        model: "sequential",
        includeReturn: false,
        exact,
      })
      if (withoutReturn.plan) plans.push(withoutReturn.plan)
    }
  }
  return plans
}

/** Стоимость возврата на базу из конечной точки цепочки (0, если она на базе). */
function returnCostFor(context: BuildContext, label: Label): number {
  const lastOrder = label.last >= 0 ? context.orders[label.last] : null
  const place = lastOrder ? lastOrder.delivery : context.vehicle.homeBase
  if (samePlaceId(place.id, context.vehicle.homeBase.id)) return 0
  const info = context.distance.segment(place, context.vehicle.homeBase, "deadhead")
  const cost = context.vehicle.cost
  return (
    fuelLiters(info.km, null, context.vehicle) * cost.fuelPricePerL +
    info.km * (cost.maintenancePerKm + cost.tiresPerKm + cost.tollsPerKm + cost.otherPerKm)
  )
}

function returnHoursFor(context: BuildContext, label: Label): number {
  const lastOrder = label.last >= 0 ? context.orders[label.last] : null
  const place = lastOrder ? lastOrder.delivery : context.vehicle.homeBase
  if (samePlaceId(place.id, context.vehicle.homeBase.id)) return 0
  return context.distance.segment(place, context.vehicle.homeBase, "deadhead").hours
}

/** Оценка заказа «сверху» — только для отбора кандидатов на большом пуле. */
function scoreOrder(order: LoadOrder): number {
  const km = order.exchangeKm && order.exchangeKm > 0 ? order.exchangeKm : 1
  return order.rate.amount / km
}

// ---------------------------------------------------------------------------
// Модель Б: сборные перевозки
// ---------------------------------------------------------------------------
//
// Отличие от модели А. В модели А в кузове всегда один груз: «взял — отвёз —
// взял следующий». В сборной несколько грузов едут одновременно, и появляются
// вопросы, которых в А нет:
//   · влезает ли СУММА грузов на каждом участке (а не каждый по отдельности);
//   · в каком порядке грузить и выгружать (нельзя выгрузить раньше, чем
//     погрузил; нельзя проехать мимо выгрузки, чтобы вернуться за ней потом);
//   · когда какой груз ждёт окно, и сколько это стоит по времени.
//
// Как это ищется. Три шага, и все три видны в статистике плана:
//   1. КАНДИДАТЫ. Не «топ по деньгам за километр» (это отбирало грузы из разных
//      концов страны), а географические группы: грузы, чьи погрузки лежат
//      недалеко друг от друга. Сборка имеет смысл только внутри такой группы.
//   2. НАБОРЫ. Перебираются все подмножества кандидатов до maxConcurrentOrders:
//      сумма массы и объёма должна влезать в кузов хотя бы один раз, иначе
//      набор физически невозможен. Остальные оцениваются сверху (сколько дадут
//      деньги минус неизбежный пробег) — подробно считаются только лучшие.
//   3. ПОРЯДОК. Поиск по состояниям «что погружено / что выгружено / где
//      стоим»: каждый переход — одна операция (погрузка или выгрузка) с
//      проверкой профиля кузова ДО переезда. Для небольших наборов хранится
//      несколько недоминируемых состояний (приехал раньше / проехал меньше),
//      поэтому результат — оптимум, а не «первый удачный порядок».
//
// Модель Б не заменяет модель А. Оба поиска идут всегда, варианты сравниваются
// по деньгам с обязательным возвратом, и в объяснении рекомендации прямо
// сказано, какая модель выиграла и на сколько.

/** Сколько заказов вообще рассматривать как кандидатов в сборку. */
const CONSOLIDATED_CANDIDATES = 12
/** Сколько наборов считать подробно. Остальные — только оценка сверху. */
const CONSOLIDATED_GROUP_LIMIT = 200
/** Абсолютный предел грузов в кузове: больше — уже не сборка, а перегруз. */
const CONSOLIDATED_MAX_GROUP = 4
/**
 * Сколько недоминируемых состояний хранить на один узел поиска.
 *
 * Недоминируемые — это «приехал раньше, но проехал больше» и наоборот. Если
 * хранить одно состояние (как было), можно потерять более выгодный порядок:
 * более позднее, но короткое состояние вытеснялось более ранним и длинным.
 * Предел нужен, чтобы поиск не разросся: при наборе из 3–4 грузов до предела
 * дело не доходит, и результат остаётся точным.
 */
const PARETO_KEEP = 512
/**
 * Бюджет состояний на одну машину.
 *
 * Требование «ограничение состояний» — не про экономию такта, а про честность:
 * лучше вернуть найденный план с пометкой «оптимум не доказан», чем держать
 * запрос логиста минуту. Замер на худшем пуле (все погрузки в одном коридоре):
 * без бюджета 2,3 с и 2,2 млн состояний, с бюджетом — 0,3 с и «exact: false».
 */
const CONSOLIDATED_STATE_BUDGET = 250_000

/** Сколько готовых порядков материализуется в план (материализация недешёвая). */
const MATERIALIZE_LIMIT = 64

interface ConsolidatedNode {
  pickedMask: number
  doneMask: number
  /** Где стоим: -1 — база, иначе index * 2 (погрузка) / index * 2 + 1 (выгрузка) */
  location: number
  clock: number
  km: number
  kg: number
  m3: number
  /** Сколько грузов едет в кузове прямо сейчас */
  count: number
  /**
   * Список операций — связным списком, а не копией массива.
   *
   * Копия массива на каждом переходе делает поиск квадратичным по глубине и
   * съедает память: на 12 заказах это была разница между 300 мс и 2,5 с.
   * Здесь операция добавляется за O(1), а массив собирается один раз — когда
   * порядок уже выбран.
   */
  moves: CapacityMove[] | ConsolidatedStep | null
}

/** Один шаг сборного рейса в связном списке. */
interface ConsolidatedStep {
  kind: "load" | "unload"
  order: LoadOrder
  prev: ConsolidatedStep | null
}

/**
 * Кандидаты в сборку: географические группы, а не «самые дорогие грузы».
 *
 * Живой пример, из-за которого это переписано: на пуле из 24 грузов по всей
 * стране в сборку попадали Москва → Казань и Краснодар → Воронеж — по деньгам
 * за километр они лучшие, вместе — бессмысленны. Сборка живёт там, где
 * погрузки рядом: тогда один подъезд обслуживает несколько грузов, а выгрузка
 * одного оказывается рядом с погрузкой другого.
 */
function consolidationCandidates(context: BuildContext, now: Date): LoadOrder[] {
  const { orders, vehicle, settings, distance } = context
  if (orders.length < 2) return []

  // Радиус группы: насколько далеко могут стоять погрузки одного сборного рейса.
  const radiusKm = Math.max(120, settings.detourBaseKm * 2)
  const base = vehicle.homeBase

  // Расстояние погрузка-погрузка считаем один раз: оно нужно и здесь, и в отборе.
  const between = new Map<string, number>()
  const pairKm = (a: LoadOrder, b: LoadOrder): number => {
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
    const cached = between.get(key)
    if (cached !== undefined) return cached
    const km = distance.segment(a.pickup, b.pickup, "deadhead").km
    between.set(key, km)
    return km
  }

  // Живые грузы: дата погрузки не в прошлом (окно ещё можно успеть).
  const alive = orders.filter((order) => {
    const from = order.window.pickup.from ? new Date(order.window.pickup.from) : null
    return !from || Number.isNaN(from.getTime()) || from.getTime() >= now.getTime() - 24 * 3600000
  })

  // Маленький пул: география не нужна, перебираем всё. Отбор по близости
  // существует ради больших пулов (сотни грузов по стране), а на десятке
  // грузов он только вредит: отброшенный груз мог дать лучшую сборку.
  if (alive.length <= CONSOLIDATED_CANDIDATES) return alive

  // Жадные группы: начинаем с каждого из самых денежных грузов и добавляем
  // ближайшие по погрузке, пока группа не разрастётся или не растянется.
  const seeds = [...alive].sort((a, b) => scoreOrder(b) - scoreOrder(a)).slice(0, 6)
  const maxGroup = Math.min(settings.maxConcurrentOrders, CONSOLIDATED_MAX_GROUP)
  const chosen = new Map<string, LoadOrder>()

  for (const seed of seeds) {
    const group: LoadOrder[] = [seed]
    while (group.length < maxGroup + 2) {
      let best: { order: LoadOrder; score: number } | null = null
      for (const order of alive) {
        if (group.some((item) => item.id === order.id)) continue
        // Насколько близко погрузка к уже собранным: это и есть «один подъезд».
        const nearest = Math.min(...group.map((item) => pairKm(item, order)))
        if (nearest > radiusKm) continue
        // Выгодно, если груз добавляет денег больше, чем стоит его подъезд.
        const score = order.rate.amount / Math.max(50, nearest)
        if (!best || score > best.score) best = { order, score }
      }
      if (!best) break
      group.push(best.order)
    }
    if (group.length < 2) continue
    const spread = group.reduce((max, a) => Math.max(max, ...group.map((b) => pairKm(a, b))), 0)
    if (spread > radiusKm * 1.5) continue
    for (const order of group) chosen.set(order.id, order)
    if (chosen.size >= CONSOLIDATED_CANDIDATES) break
  }

  // Если жадность ничего не собрала (все погрузки разбросаны), в сборку идёт
  // ближайшая к базе пара: дальше отбирать нечего, но честнее попробовать.
  if (chosen.size < 2) {
    const nearestToBase = [...alive].sort(
      (a, b) =>
        distance.segment(base, a.pickup, "deadhead").km - distance.segment(base, b.pickup, "deadhead").km,
    )
    for (const order of nearestToBase.slice(0, CONSOLIDATED_CANDIDATES)) chosen.set(order.id, order)
  }

  return [...chosen.values()].slice(0, CONSOLIDATED_CANDIDATES)
}

/**
 * Длина минимального остовного дерева на базе и всех точках набора.
 *
 * Зачем: это нижняя граница любого маршрута, который побывает во всех точках
 * и вернётся на базу. Дешёвая (О(k²)) и, в отличие от «прямых плеч», не
 * наказывает большие наборы — дерево на пяти точках лишь немного длиннее
 * дерева на четырёх.
 */
function spanningKm(pointIndexes: number[], kmOf: (a: number, b: number) => number): number {
  const inTree = new Set<number>()
  const best = new Map<number, number>(pointIndexes.map((index) => [index, Infinity]))
  best.set(pointIndexes[0], 0)
  let total = 0
  for (let step = 0; step < pointIndexes.length; step += 1) {
    let next = -1
    let nextKm = Infinity
    for (const index of pointIndexes) {
      if (inTree.has(index)) continue
      const value = best.get(index) ?? Infinity
      if (value < nextKm) {
        nextKm = value
        next = index
      }
    }
    if (next === -1 || !Number.isFinite(nextKm)) break
    inTree.add(next)
    total += nextKm
    for (const index of pointIndexes) {
      if (inTree.has(index)) continue
      const km = kmOf(next, index)
      if (km < (best.get(index) ?? Infinity)) best.set(index, km)
    }
  }
  return total
}

export function searchConsolidated(context: BuildContext, options: SearchOptions = {}): RoutePlan[] {
  const { orders, settings, vehicle } = context
  if (!settings.consolidationEnabled) return []
  // Сколько заказов может быть в сборном рейсе ВСЕГО. Это не то же самое, что
  // «сколько едет одновременно»: одновременно в кузове — по массе и по
  // настройке maxConcurrentOrders, а весь рейс может собрать больше заказов
  // (часть уже выгружена, часть ещё не погружена). Раньше эти два предела
  // были склеены, и сборный рейс из пяти заказов терялся, если одновременно
  // едут не больше четырёх.
  const maxGroup = Math.min(settings.maxLegs, CONSOLIDATED_MAX_GROUP + 2, 6)
  if (maxGroup < 2) return []

  // Отбор кандидатов: география, а не «топ по деньгам».
  const preferred = new Set((options.ordersByLikelihood ?? []).map((order) => order.id))
  const candidates = consolidationCandidates(context, context.now)
  if (candidates.length < 2) return []

  const n = candidates.length
  // Расстояния между точками кандидатов — один раз на весь перебор наборов:
  // 0 — база, 1 + 2i — погрузка, 2 + 2i — выгрузка i-го кандидата.
  const candidatePoints: Place[] = [vehicle.homeBase]
  for (const order of candidates) candidatePoints.push(order.pickup, order.delivery)
  const candidateKm = candidatePoints.map(() => candidatePoints.map(() => 0))
  for (let a = 0; a < candidatePoints.length; a += 1) {
    for (let b = 0; b < candidatePoints.length; b += 1) {
      if (a === b) continue
      candidateKm[a][b] = context.distance.segment(candidatePoints[a], candidatePoints[b], "deadhead").km
    }
  }

  const perKm =
    vehicle.cost.maintenancePerKm +
    vehicle.cost.tiresPerKm +
    vehicle.cost.tollsPerKm +
    vehicle.cost.otherPerKm +
    (fuelLiters(100, 0, vehicle) / 100) * vehicle.cost.fuelPricePerL

  // 2. Наборы: перебор подмножеств с физической проверкой и оценкой сверху.
  //
  // Оценка сверху — это не «сколько дадут деньги минус прямые плечи». Такой
  // счёт наказывал большие наборы дважды (по числу пар), и набор из пяти
  // грузов, который в реальности выгоднее четырёх, вылетал из короткого
  // списка ещё до расчёта. Здесь честная нижняя граница пробега: любой
  // замкнутый маршрут через все точки не короче минимального остовного
  // дерева на этих точках. Значит выручка минус дерево — верхняя граница
  // прибыли, и она не отсекает выгодный набор.
  const ranked: Array<{ group: LoadOrder[]; bound: number }> = []
  for (let mask = 1; mask < 1 << n; mask += 1) {
    const picked: LoadOrder[] = []
    for (let i = 0; i < n; i += 1) if (mask & (1 << i)) picked.push(candidates[i])
    if (picked.length < 2 || picked.length > maxGroup) continue

    const totalKg = picked.reduce((sum, order) => sum + (order.weightKg ?? 0), 0)
    const totalM3 = picked.reduce((sum, order) => sum + (order.volumeM3 ?? 0), 0)
    if (totalKg > vehicle.capacityKg || totalM3 > vehicle.capacityM3) {
      context.stats.prunedStates += 1
      continue
    }

    const revenue = picked.reduce((sum, order) => sum + order.rate.amount, 0)
    const indexes = [0]
    for (const order of picked) {
      const position = candidates.indexOf(order)
      indexes.push(1 + position * 2, 2 + position * 2)
    }
    const bound = revenue - spanningKm(indexes, (a, b) => candidateKm[a][b]) * perKm
    // Приоритет — наборам, которые модель А уже видит: не в ущерб прочим, но
    // при равенстве границ первыми считаются они.
    const preferredCount = picked.filter((order) => preferred.has(order.id)).length
    ranked.push({ group: picked, bound: bound + preferredCount * 1e-3 })
  }

  ranked.sort((a, b) => b.bound - a.bound)
  const shortlist = ranked.slice(0, CONSOLIDATED_GROUP_LIMIT)
  const exactGroups = ranked.length <= CONSOLIDATED_GROUP_LIMIT

  const plans: RoutePlan[] = []
  const seenOrders = new Set<string>()
  // Наборы идут по убыванию верхней границы прибыли. Как только очередная
  // граница опускается ниже уже найденной прибыли, дальнейшие наборы не могут
  // её улучшить — перебор можно прекращать. Это не эвристика: граница
  // (выручка минус минимальный мыслимый пробег) заведомо выше настоящей
  // прибыли, поэтому обрезание не выбрасывает лучший вариант.
  let bestNetSoFar = 0
  let exhaustive = true
  const budget = { left: CONSOLIDATED_STATE_BUDGET }
  context.stats.consideredGroups = 0
  for (const { group, bound } of shortlist) {
    if (bound <= bestNetSoFar) {
      exhaustive = false
      context.stats.prunedStates += 1
      break
    }
    const key = group.map((order) => order.id).sort().join(",")
    if (seenOrders.has(key)) continue
    seenOrders.add(key)
    context.stats.consideredGroups += 1
    const best = bestConsolidatedOrder(
      context,
      group,
      exactGroups && group.length <= 3,
      bestNetSoFar,
      budget,
    )
    if (!best) continue
    plans.push(best)
    if (best.economics.netCommittedRub > bestNetSoFar) bestNetSoFar = best.economics.netCommittedRub
  }
  // Если перебор прерван по границе, по бюджету состояний или короткий список
  // обрезан — оптимум не доказан, и планы обязаны это честно говорить.
  if (!exhaustive || !exactGroups || budget.left <= 0) {
    for (const plan of plans) plan.exact = false
  }

  // Один и тот же набор заказов может дать несколько порядков — оставляем
  // самый выгодный по каждому набору, а не десять вариаций одного рейса.
  const bySet = new Map<string, RoutePlan>()
  for (const plan of plans) {
    const key = [...plan.orderIds].sort().join(",")
    const previous = bySet.get(key)
    if (!previous || plan.economics.netCommittedRub > previous.economics.netCommittedRub) bySet.set(key, plan)
  }
  return [...bySet.values()]
    .sort((a, b) => b.economics.netCommittedRub - a.economics.netCommittedRub)
    .slice(0, 10)
}

/** Недоминируемость сборного состояния: не позже и не дальше — значит не хуже. */
function dominatesConsolidated(a: ConsolidatedNode, b: ConsolidatedNode): boolean {
  return a.clock <= b.clock && a.km <= b.km && (a.clock < b.clock || a.km < b.km)
}

/**
 * Перебор порядков погрузок/выгрузок для выбранного набора заказов.
 *
 * Правила, которые здесь исполняются буквально:
 *   · выгрузить груз можно только если он уже погружен (маски);
 *   · масса и объём в кузове проверяются на каждом переходе — и то, что едет
 *     сейчас, и то, что будет после операции;
 *   · окно погрузки учитывается ожиданием, а не отказом (ждать — нормально);
 *   · переезд считается по расстоянию между точками, с грузом в кузове или без.
 */
/** Развернуть связный список операций в порядок исполнения. */
function stepsOf(node: ConsolidatedNode): CapacityMove[] {
  const out: CapacityMove[] = []
  let step = node.moves as ConsolidatedStep | null
  while (step) {
    out.push({ kind: step.kind, order: step.order })
    step = step.prev
  }
  return out.reverse()
}

function bestConsolidatedOrder(
  context: BuildContext,
  group: LoadOrder[],
  exact: boolean,
  /** Лучшая прибыль, уже найденная на этом пуле (для отсечения ветвей) */
  knownBestNet = 0,
  /** Общий бюджет состояний на машину (см. CONSOLIDATED_STATE_BUDGET) */
  budget: { left: number } = { left: CONSOLIDATED_STATE_BUDGET },
): RoutePlan | null {
  const n = group.length
  const { vehicle, settings, distance } = context
  const allDone = (1 << n) - 1
  const maxConcurrent = Math.max(1, settings.maxConcurrentOrders)

  // ── Матрица участков ─────────────────────────────────────────────────────
  //
  // Раньше каждый переход спрашивал движок расстояний: строка-ключ, Map,
  // оценка региона. На поиске в сотни тысяч состояний это дороже самого
  // поиска. Здесь все участки между точками набора считаются ОДИН раз
  // (до 11 точек — 121 пара), а поиск работает с числами.
  //
  // Точки: 0 — база, 1 + 2i — погрузка i-го заказа, 2 + 2i — его выгрузка.
  const points: Place[] = [vehicle.homeBase]
  for (const order of group) points.push(order.pickup, order.delivery)

  const kmMatrix = points.map(() => points.map(() => 0))
  const loadedHours = points.map(() => points.map(() => 0))
  const emptyHours = points.map(() => points.map(() => 0))
  for (let a = 0; a < points.length; a += 1) {
    for (let b = 0; b < points.length; b += 1) {
      if (a === b) continue
      const loaded = distance.segment(points[a], points[b], "loaded")
      const empty = distance.segment(points[a], points[b], "deadhead")
      kmMatrix[a][b] = loaded.km
      loadedHours[a][b] = loaded.hours
      emptyHours[a][b] = empty.hours
      // Километраж биржи главнее маршрутизатора там, где он про этот участок:
      // от погрузки к выгрузке своего заказа.
    }
  }
  for (let index = 0; index < n; index += 1) {
    const exchange = group[index].exchangeKm
    if (!exchange || exchange <= 0) continue
    const delivery = 2 + index * 2
    for (let a = 0; a < points.length; a += 1) {
      if (a === delivery) continue
      kmMatrix[a][delivery] = exchange
      const speed = 55
      loadedHours[a][delivery] = exchange / speed
    }
  }

  // Точка операции: погрузка/выгрузка заказа index
  const pointOf = (index: number, kind: "load" | "unload"): number =>
    kind === "load" ? 1 + index * 2 : 2 + index * 2

  // Нижняя граница остатка: минимальное остовное дерево на том, что ещё надо
  // посетить, плюс база. Дешёвая и admissible: любой реальный маршрут не
  // короче дерева. С ней поиск отсекает целые ветки, которые заведомо дороже
  // уже найденного порядка.
  const boundCache = new Map<string, number>()
  const remainingBound = (mask: number, at: number): number => {
    const key = `${mask}|${at}`
    const cached = boundCache.get(key)
    if (cached !== undefined) return cached
    const members: number[] = [0, at]
    for (let index = 0; index < n; index += 1) {
      const bit = 1 << index
      if (!(mask & bit)) continue
      members.push(1 + index * 2, 2 + index * 2)
    }
    const unique = [...new Set(members)]
    const inTree = new Set<number>()
    const best = new Map<number, number>(unique.map((m) => [m, Infinity]))
    best.set(at, 0)
    let total = 0
    for (let step = 0; step < unique.length; step += 1) {
      let next = -1
      let nextKm = Infinity
      for (const member of unique) {
        if (inTree.has(member)) continue
        const value = best.get(member) ?? Infinity
        if (value < nextKm) {
          nextKm = value
          next = member
        }
      }
      if (next === -1 || !Number.isFinite(nextKm)) break
      inTree.add(next)
      total += nextKm
      for (const member of unique) {
        if (inTree.has(member)) continue
        const km = kmMatrix[next][member]
        if (km < (best.get(member) ?? Infinity)) best.set(member, km)
      }
    }
    boundCache.set(key, total)
    return total
  }

  const start: ConsolidatedNode = {
    pickedMask: 0,
    doneMask: 0,
    location: 0,
    clock: context.now.getTime() + settings.preparationHours * MS_HOUR,
    km: 0,
    kg: 0,
    m3: 0,
    count: 0,
    moves: null,
  }

  // Состояние → список недоминируемых вариантов (а не один: см. PARETO_KEEP).
  // Ключ состояния — число, а не строка: строковый ключ на каждом переходе
  // (сборка строки + хеш) стоил дороже самого перехода.
  const buckets = new Map<number, ConsolidatedNode[]>()
  const keyOf = (node: ConsolidatedNode) =>
    (node.pickedMask * 4096 + node.doneMask) * 64 + node.location
  buckets.set(keyOf(start), [start])
  let frontier: ConsolidatedNode[] = [start]
  const finished: ConsolidatedNode[] = []

  // Отсечение ветвей. Две границы:
  //   · bestTotalKm — лучший полный пробег ВНУТРИ этого набора (сравнение
  //     пробега корректно только при одинаковой выручке);
  //   · по деньгам — «выручка набора минус самый дешёвый возможный пробег»;
  //     если это не выше уже найденной прибыли, набор не может её улучшить.
  const groupRevenue = group.reduce((sum, order) => sum + order.rate.amount, 0)
  const perKmLowerBound =
    vehicle.cost.maintenancePerKm +
    vehicle.cost.tiresPerKm +
    vehicle.cost.tollsPerKm +
    vehicle.cost.otherPerKm +
    (fuelLiters(100, 0, vehicle) / 100) * vehicle.cost.fuelPricePerL
  let bestTotalKm = Infinity
  const cannotWin = (projectedKm: number): boolean =>
    groupRevenue - projectedKm * perKmLowerBound <= knownBestNet

  let truncated = false
  for (let step = 0; step < n * 2; step += 1) {
    if (budget.left <= 0) {
      truncated = true
      break
    }
    const next: ConsolidatedNode[] = []
    for (const node of frontier) {
      if (budget.left <= 0) {
        truncated = true
        break
      }
      // location теперь хранит номер точки матрицы: 0 — база.
      const herePoint = node.location
      for (let index = 0; index < n; index += 1) {
        const bit = 1 << index
        const order = group[index]
        const canLoad = !(node.pickedMask & bit)
        const canUnload = Boolean(node.pickedMask & bit) && !(node.doneMask & bit)
        const kinds: Array<"load" | "unload"> = []
        if (canLoad) kinds.push("load")
        if (canUnload) kinds.push("unload")

        for (const kind of kinds) {
          const weightAfter = node.kg + (kind === "load" ? order.weightKg ?? 0 : -(order.weightKg ?? 0))
          const volumeAfter = node.m3 + (kind === "load" ? order.volumeM3 ?? 0 : -(order.volumeM3 ?? 0))
          const countAfter = node.count + (kind === "load" ? 1 : -1)
          context.stats.consideredStates += 1
          budget.left -= 1

          // Профиль загрузки: и то, что уже едет, и то, что будет после операции.
          if (weightAfter > vehicle.capacityKg + 1e-6 || volumeAfter > vehicle.capacityM3 + 1e-6) {
            context.stats.prunedStates += 1
            continue
          }
          // Сколько грузов едет одновременно — настройка организации, а не
          // следствие массы: три паллеты в фуре остаются тремя грузами, даже
          // если по весу влезло бы пять.
          if (countAfter > maxConcurrent) {
            context.stats.prunedStates += 1
            continue
          }

          const target = pointOf(index, kind)
          const carrying = node.kg > 0 || node.m3 > 0
          const legKm = kmMatrix[herePoint][target]
          const legHours = carrying ? loadedHours[herePoint][target] : emptyHours[herePoint][target]

          // Отсечение по границе: если даже при самом коротком продолжении
          // путь выйдет не короче уже найденного — ветку не развиваем.
          const restMask = allDone & ~(kind === "unload" ? node.doneMask | bit : node.doneMask)
          const projected = node.km + legKm + remainingBound(restMask, target)
          if (projected > bestTotalKm + 1e-6 || cannotWin(projected)) {
            context.stats.prunedStates += 1
            continue
          }

          // Ожидание окна считаем только если окно вообще задано или склад
          // открывается позже суток. Иначе — чистая арифметика: проверка
          // местного времени (перевод в часовой пояс) на сотнях тысяч
          // состояний обходится дороже всего остального поиска.
          const windowFrom = kind === "load" ? order.window.pickup.from : order.window.delivery.from
          const handle = handlingHours(order.weightKg, settings)
          const arrivalMs = node.clock + legHours * MS_HOUR
          const clock =
            windowFrom || settings.openingHour > 0
              ? readyFromMs(
                  arrivalMs,
                  (kind === "load" ? order.pickup : order.delivery).timeZone,
                  windowFrom,
                  settings.openingHour,
                ).startMs +
                handle * MS_HOUR
              : arrivalMs + handle * MS_HOUR

          const candidate: ConsolidatedNode = {
            pickedMask: kind === "load" ? node.pickedMask | bit : node.pickedMask,
            doneMask: kind === "unload" ? node.doneMask | bit : node.doneMask,
            location: target,
            clock,
            km: node.km + legKm,
            kg: weightAfter,
            m3: volumeAfter,
            count: countAfter,
            moves: { kind, order, prev: node.moves as ConsolidatedStep | null },
          }

          if (candidate.doneMask === allDone) {
            const total = candidate.km + kmMatrix[target][0]
            if (total < bestTotalKm) bestTotalKm = total
            finished.push(candidate)
            continue
          }

          const key = keyOf(candidate)
          const bucket = buckets.get(key) ?? []
          // Уже есть вариант не хуже — этот можно не развивать.
          if (bucket.some((other) => other === candidate || dominatesConsolidated(other, candidate))) {
            context.stats.prunedStates += 1
            continue
          }
          const kept = bucket.filter((other) => !dominatesConsolidated(candidate, other))
          kept.push(candidate)
          if (kept.length > PARETO_KEEP) {
            kept.sort((a, b) => a.clock + a.km * 1000 - (b.clock + b.km * 1000))
            kept.length = PARETO_KEEP
            context.stats.prunedStates += 1
          }
          buckets.set(key, kept)
          next.push(candidate)
        }
      }
    }
    if (truncated) break
    // В следующий шаг идут только те, что всё ещё в своих списках.
    frontier = next.filter((node) => {
      const bucket = buckets.get(keyOf(node))
      return bucket !== undefined && bucket.includes(node)
    })
    if (frontier.length === 0) break
  }

  // Сортировка — по ПОЛНОМУ пробегу, то есть с дорогой домой. Внутри набора
  // заказов выручка одинаковая, поэтому прибыль определяется пробегом и
  // сменами. Но голый `km` узла не учитывает, откуда возвращаться: порядок,
  // закончившийся на Дальнем Востоке, мог «выиграть» по km и проиграть по
  // возврату. Из-за этого самый выгодный порядок не попадал в первые
  // MATERIALIZE_LIMIT — расхождение с перебором доходило до 2,5 %.
  const backHome = (node: ConsolidatedNode): number => kmMatrix[node.location][0]
  const shortlist = [...finished]
    .sort((a, b) => {
      const totalA = a.km + backHome(a)
      const totalB = b.km + backHome(b)
      return totalA !== totalB ? totalA - totalB : a.clock - b.clock
    })
    .slice(0, MATERIALIZE_LIMIT)

  let bestPlan: RoutePlan | null = null
  for (const node of shortlist) {
    const result = materialize(context, stepsOf(node), {
      model: "consolidated",
      includeReturn: settings.returnMode !== "free",
      exact: exact && !truncated && finished.length <= MATERIALIZE_LIMIT,
    })
    if (!result.plan) continue
    if (
      !bestPlan ||
      result.plan.economics.netCommittedRub > bestPlan.economics.netCommittedRub
    ) {
      bestPlan = result.plan
    }
  }
  if (bestPlan) {
    // Явное сравнение моделей в объяснении: логист должен видеть, что выбранная
    // модель победила не «по умолчанию», а по деньгам.
    const loads = bestPlan.orderIds.length
    const shared = bestPlan.capacity.some((use) => use.items.length > 1)
    bestPlan.reasons.push(
      shared
        ? `Сборка: ${loads} груза едут вместе на части маршрута — один подъезд вместо ${loads}`
        : `Сборка: ${loads} груза, но вместе они не едут ни на одном участке — это последовательный рейс`,
    )
  }
  return bestPlan
}
