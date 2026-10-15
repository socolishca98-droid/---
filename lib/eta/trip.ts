// lib/eta/trip.ts
//
// ЕДИНЫЙ расчёт ETA рейса: временная шкала этапов вместо независимых оценок.
//
// Зачем этот модуль. До него в проекте было несколько независимых формул:
//   * calculateETA (lib/eta/service.ts) — одно число на весь маршрут;
//   * buildRouteEtaPreview в компоненте карточки рейса — расстояние/60 ×
//     коэффициенты, считалось В БРАУЗЕРЕ;
//   * превью в заказах — свои коэффициенты;
//   * мобильный ETA — свои.
// Все они давали разные числа для одного рейса, и ни один не учитывал
// последовательность операций.
//
// Здесь рейс описывается как ПОСЛЕДОВАТЕЛЬНОСТЬ ЭТАПОВ:
//
//   база → погрузка №1 → плечо → выгрузка №1 → погрузка №2 → плечо →
//   выгрузка №2 → ... → возврат на базу
//
// Каждый этап знает: начальную и конечную точку, тип операции, порядок,
// плановое и фактическое время, статус, длительность, связанный заказ.
// Прогноз складывается из последовательных событий шкалы, а не из суммы
// независимых оценок: движение считает ДВИЖАТЕЛЬ (lib/eta/forecast.ts),
// операции — он же как остановки, перерыв водителя вставляется в часы.
//
// Модуль ЧИСТЫЙ: координаты, машина и факты приходят параметрами.
// Загрузка из базы — в app/api/*, сети здесь нет.

import {
  forecastSegments,
  type Correction,
  type ForecastResult,
  type Scenario,
  type SegmentForecast,
} from "./forecast"
import { buildSegmentsFromSteps, type RouteSegment } from "./segments"
import { decodePolyline } from "./segments"
import { haversineDistance } from "./osrm-client"
import { resolveStop, totalStopMinutes, type ResolvedStop, type StopRequest } from "./stops"
import type { Coordinates } from "./types"
import type { VehicleInput } from "./vehicle-profile"
import type { RoadEvent } from "./events"
import type { RestRules } from "./driver-rest"
import type { HourlyWeather } from "./weather/model"

/** Тип этапа рейса. */
export type TripStageKind =
  | "driving"
  | "loading"
  | "unloading"
  | "documents"
  | "waiting"
  | "rest"
  | "return_to_base"

export const TRIP_STAGE_LABELS: Record<TripStageKind, string> = {
  driving: "Движение",
  loading: "Погрузка",
  unloading: "Выгрузка",
  documents: "Оформление документов",
  waiting: "Ожидание",
  rest: "Перерыв водителя",
  return_to_base: "Возвращение на базу",
}

/** Статус этапа: согласуется с RouteStage.status (planned | active | completed | cancelled). */
export type TripStageStatus = "planned" | "active" | "completed" | "cancelled"

/** Один этап рейса. */
export interface TripStageInput {
  kind: TripStageKind
  /** Порядок в маршруте */
  sequence: number
  /** Связанный заказ, если этап принадлежит заказу */
  orderId?: string | null
  /** Адрес/название точки — что видит человек */
  address?: string
  /** Откуда едем (для driving и return_to_base) */
  from?: Coordinates
  /**
   * Какое это плечо заказа: до точки погрузки или до точки выгрузки.
   * Нужно, чтобы расстояние заказа (оно считается от погрузки до выгрузки)
   * не проставилось плечу ДО погрузки — иначе расстояние рейса удвоится.
   */
  leg?: "to_pickup" | "to_dropoff"
  /** Куда едем (для driving и return_to_base) */
  to?: Coordinates
  /** Где выполняется операция (для loading/unloading/...) */
  point?: Coordinates
  /** Остановка: вид работ и её длительность */
  stop?: StopRequest
  /** Фактическое время начала/окончания — этап не пересчитывается как будущий */
  actualStartAt?: Date | null
  actualEndAt?: Date | null
  /**
   * Расстояние плеча, м. Если не задано — будет оценено по прямой линии
   * × дорожной коэффициент, и в dataQuality попадёт предупреждение: такая
   * оценка грубее построенного маршрута, но честнее нуля.
   */
  distanceM?: number | null
}

export interface TripEtaOptions {
  /** Откуда считаем: обычно «сейчас» или момент последнего подтверждённого события */
  now: Date
  timeZone?: string
  vehicle?: VehicleInput
  restrictions?: Parameters<typeof forecastSegments>[1] extends never ? never : import("./vehicle-profile").RouteRestriction[]
  events?: RoadEvent[]
  restRules?: Partial<RestRules>
  priorDrivingMinutes?: number
  /** Погода по плечам: null = данных нет */
  weatherBySegment?: Array<HourlyWeather | null>
  historicalBySegment?: Array<{ trafficFactor: number; source: string } | null>
  useSeasonalFallback?: boolean
  /** Возврат на базу в конце рейса */
  returnToBase?: { point: Coordinates; address?: string } | null
  /** Начальная точка рейса (база), если она не совпадает с первой погрузкой */
  origin?: { point: Coordinates; address?: string } | null
}

/** Этап с прогнозом. */
export interface TripStageForecast {
  index: number
  kind: TripStageKind
  label: string
  status: TripStageStatus
  sequence: number
  orderId?: string | null
  address?: string
  /** Откуда → куда (для движения) */
  from?: Coordinates
  to?: Coordinates
  /** Расстояние плеча, м */
  distanceM?: number
  /** Плановое начало и конец этапа */
  plannedStartAt?: Date
  plannedEndAt?: Date
  /** Фактическое начало и конец (заполнено по событиям) */
  actualStartAt?: Date | null
  actualEndAt?: Date | null
  /** Длительность этапа, сек (фактическая, если есть) */
  durationSec?: number
  /** Остановка (для операций) — разложенная: минуты и источник */
  stop?: ResolvedStop
  /** Исходный запрос остановки: его переиспользует движок, чтобы не потерять
   *  фактические минуты. resolveStop читает actualMinutes/medianMinutes, но не
   *  готовые minutes — иначе повторное разрешение вернуло бы оценку по умолчанию. */
  stopRequest?: StopRequest
  /** Сегмент движка, соответствующий плечу */
  segment?: SegmentForecast
  /** Был ли этап уже завершен к моменту расчёта */
  completed: boolean
  /** Является ли этап текущим (начат, но не завершён) */
  current: boolean
}

export interface TripEtaResult {
  modelVersion: string
  calculatedAt: Date
  now: Date
  stages: TripStageForecast[]
  /** Индекс текущего этапа или null */
  currentStageIndex: number | null
  /** Индекс следующей точки, на которую надо приехать */
  nextStageIndex: number | null
  /** Следующая точка: адрес, операция, расстояние, ETA */
  nextPoint: {
    address?: string
    operation: TripStageKind
    orderId?: string | null
    distanceM?: number
    /** Время движения до точки, сек */
    drivingSec: number
    /** Ожидаемое время прибытия */
    arrivalAt: Date
  } | null
  /** Оставшаяся часть рейса */
  remaining: {
    drivingSec: number
    stopsSec: number
    restSec: number
    totalSec: number
    arrivalAt: Date
  }
  /** Возвращение на базу */
  returnToBase: {
    address?: string
    distanceM?: number
    drivingSec: number
    arrivalAt: Date
  } | null
  /** Полное оставшееся время рейса включая возврат на базу */
  totalRemainingSec: number
  /** Ожидаемое время завершения рейса (с возвратом на базу) */
  completionAt: Date
  scenarios: Record<Scenario, { drivingSec: number; stopsSec: number; restSec: number; totalSec: number; arrivalAt: Date }>
  confidence: ForecastResult["confidence"]
  /** Факторы, повлиявшие на прогноз */
  factors: Array<{ kind: string; label: string; factor: number; detail: string }>
  corrections: Correction[]
  /** Качество исходных данных — что именно неизвестно */
  dataQuality: {
    /** Есть ли расстояние у всех плеч */
    allLegsGeocoded: boolean
    /** Сколько плеч с расстоянием, оценённым по прямой */
    estimatedLegs: number
    /** Есть ли карточка ТС */
    vehicleKnown: boolean
    /** Есть ли фактическое время хоть у одного этапа */
    hasActuals: boolean
    /** Погода доступна */
    weatherAvailable: boolean
    /** Предупреждения для человека */
    warnings: string[]
  }
  /** Откуда данные */
  sources: {
    routing: "osrm" | "fallback"
    weather: "open-meteo" | "disabled" | "unavailable"
    weatherEnabled: boolean
  }
  reliable: boolean
  reliabilityNote?: string
}

/**
 * Дорожный коэффициент «по прямой → по дорогам».
 *
 * Применяется ТОЛЬКО когда маршрутизатор недоступен и расстояние плеча
 * неизвестно. В результате такое плечо помечается distanceEstimated, его
 * класс дороги получает уверенность 0.15, а в dataQuality появляется
 * предупреждение. Это резерв, а не нормальный путь.
 */
const ROAD_DETOUR_FACTOR = 1.3

/** Переводит вид остановки в тип этапа. */
function stageKindOfStop(kind: StopRequest["kind"]): TripStageKind {
  switch (kind) {
    case "loading":
      return "loading"
    case "unloading":
      return "unloading"
    case "documents":
      return "documents"
    case "waiting":
      return "waiting"
    default:
      return "waiting"
  }
}

/**
 * Собирает этапы рейса из заказов.
 *
 * Один заказ = погрузка в точке отправления + плечо + выгрузка в точке
 * назначения. Между заказами — плечо от точки выгрузки предыдущего до точки
 * погрузки следующего. Возврат на базу — отдельный этап, если он нужен.
 *
 * Порядок задаёт sequence заказа (routeSequence); заказы без sequence идут
 * в конце в порядке создания.
 */
export function buildRouteStages(
  orders: ReadonlyArray<{
    id: string
    routeFrom: string
    routeTo: string
    from?: Coordinates
    to?: Coordinates
    routeSequence?: number | null
  }>,
  options: {
    origin?: { point: Coordinates; address?: string } | null
    returnToBase?: { point: Coordinates; address?: string } | null
    /** Фактические времена по этапам: ключ — orderId + вид операции */
    actuals?: Map<string, { startAt?: Date | null; endAt?: Date | null }>
    /** Длительность операций: если у склада есть своя норма (дополняет вид операции) */
    stopDurations?: Map<string, Omit<Partial<StopRequest>, "kind">>
  } = {},
): TripStageInput[] {
  const ordered = [...orders].sort((a, b) => {
    const sa = a.routeSequence
    const sb = b.routeSequence
    if (sa != null && sb != null) return sa - sb
    if (sa != null) return -1
    if (sb != null) return 1
    return 0
  })

  const stages: TripStageInput[] = []
  let sequence = 0
  let cursor: Coordinates | undefined = options.origin?.point
  let cursorAddress: string | undefined = options.origin?.address

  const push = (stage: Omit<TripStageInput, "sequence">) => {
    stages.push({ ...stage, sequence: sequence++ })
  }

  for (const order of ordered) {
    // Плечо до точки погрузки — ПЕРВЫМ. Иначе этап «погрузка» стоял бы в
    // шкале раньше приезда на склад, и водителю предлагалось бы грузить
    // до того, как он туда доехал.
    if (order.from && cursor && !samePoint(cursor, order.from)) {
      const legSequence = sequence
      push({
        kind: "driving",
        orderId: order.id,
        address: `${cursorAddress ?? "текущая точка"} → ${order.routeFrom}`,
        from: cursor,
        to: order.from,
        leg: "to_pickup",
        // Фактические отметки движения — из RouteStage. Ключ включает номер
        // этапа: у заказа может быть несколько плеч, и путать их нельзя.
        actualStartAt:
          options.actuals?.get(`${order.id}:driving:${legSequence}`)?.startAt ?? null,
        actualEndAt:
          options.actuals?.get(`${order.id}:driving:${legSequence}`)?.endAt ?? null,
      })
      cursor = order.from
      cursorAddress = order.routeFrom
    }

    // Погрузка в точке отправления заказа
    if (order.from) {
      push({
        kind: "loading",
        orderId: order.id,
        address: order.routeFrom,
        point: order.from,
        stop: { kind: "loading", ...(options.stopDurations?.get(order.id) ?? {}) },
        actualStartAt: options.actuals?.get(`${order.id}:loading`)?.startAt ?? null,
        actualEndAt: options.actuals?.get(`${order.id}:loading`)?.endAt ?? null,
      })
    }

    // Плечо до точки назначения
    if (order.from && order.to && !samePoint(order.from, order.to)) {
      const legSequence = sequence
      push({
        kind: "driving",
        orderId: order.id,
        address: `${order.routeFrom} → ${order.routeTo}`,
        from: order.from,
        to: order.to,
        leg: "to_dropoff",
        actualStartAt:
          options.actuals?.get(`${order.id}:driving:${legSequence}`)?.startAt ?? null,
        actualEndAt:
          options.actuals?.get(`${order.id}:driving:${legSequence}`)?.endAt ?? null,
      })
    }

    // Выгрузка в точке назначения
    if (order.to) {
      push({
        kind: "unloading",
        orderId: order.id,
        address: order.routeTo,
        point: order.to,
        stop: { kind: "unloading", ...(options.stopDurations?.get(order.id) ?? {}) },
        actualStartAt: options.actuals?.get(`${order.id}:unloading`)?.startAt ?? null,
        actualEndAt: options.actuals?.get(`${order.id}:unloading`)?.endAt ?? null,
      })
    }

    cursor = order.to ?? cursor
    cursorAddress = order.routeTo
  }

  // Возврат на базу
  if (options.returnToBase?.point && cursor && !samePoint(cursor, options.returnToBase.point)) {
    const legSequence = sequence
    push({
      kind: "return_to_base",
      address: `${cursorAddress ?? "текущая точка"} → ${options.returnToBase.address ?? "база"}`,
      from: cursor,
      to: options.returnToBase.point,
      actualStartAt:
        options.actuals?.get(`route:driving:${legSequence}`)?.startAt ?? null,
      actualEndAt:
        options.actuals?.get(`route:driving:${legSequence}`)?.endAt ?? null,
    })
  }

  return stages
}

function samePoint(a: Coordinates, b: Coordinates): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6
}

/**
 * Считает прогноз по этапам рейса.
 *
 * Правила, которые здесь соблюдаются:
 *   1. Завершённые этапы (есть actualEndAt) НЕ пересчитываются как будущие:
 *      их длительность берётся фактическая, и часы сдвигаются на неё.
 *   2. Текущий этап (начат, не завершён) занимает время до своего планового
 *      окончания, но не меньше уже проведённого.
 *   3. Движение считает движок forecastSegments — та же формула, что и везде.
 *      Своей формулы ETA в этом модуле нет.
 *   4. Операции передаются движку как остановки, поэтому не смешиваются
 *      со временем движения и не дублируются при пересчёте.
 */
export function calculateTripEta(
  stages: readonly TripStageInput[],
  options: TripEtaOptions,
): TripEtaResult {
  const timeZone = options.timeZone || "Europe/Moscow"
  const now = options.now

  // ── 1. Раскладываем этапы: что сделано, что текущее, что впереди ──────────
  const prepared: TripStageForecast[] = stages.map((stage, index) => {
    const completed = Boolean(stage.actualEndAt)
    const current = !completed && Boolean(stage.actualStartAt)
    const durationSec =
      stage.actualStartAt && stage.actualEndAt
        ? Math.max(0, (stage.actualEndAt.getTime() - stage.actualStartAt.getTime()) / 1000)
        : undefined

    return {
      index,
      kind: stage.kind,
      label: TRIP_STAGE_LABELS[stage.kind],
      status: (stage.actualEndAt
        ? "completed"
        : stage.actualStartAt
          ? "active"
          : "planned") as TripStageStatus,
      sequence: stage.sequence,
      orderId: stage.orderId ?? null,
      address: stage.address,
      from: stage.from,
      to: stage.to,
      distanceM: stage.distanceM ?? undefined,
      actualStartAt: stage.actualStartAt ?? null,
      actualEndAt: stage.actualEndAt ?? null,
      durationSec,
      stop: stage.stop ? resolveStop(stage.stop) : undefined,
      stopRequest: stage.stop ?? undefined,
      completed,
      current,
    }
  })

  const currentStageIndex = prepared.findIndex((stage) => stage.current)
  const firstPendingIndex = prepared.findIndex((stage) => !stage.completed)
  const nextStageIndex = firstPendingIndex === -1 ? null : firstPendingIndex

  // ── 2. Считаем, сколько времени уже «съели» завершённые и текущий этапы ──
  let elapsedSec = 0
  for (const stage of prepared) {
    if (stage.completed && stage.durationSec != null) elapsedSec += stage.durationSec
  }
  if (currentStageIndex !== -1) {
    const stage = prepared[currentStageIndex]
    const startedAt = stage.actualStartAt ?? now
    elapsedSec += Math.max(0, (now.getTime() - startedAt.getTime()) / 1000)
  }

  // ── 3. Оставшиеся плечи → сегменты движка; оставшиеся операции → остановки ─
  const legs: Array<{
    stageIndex: number
    from: Coordinates
    to: Coordinates
    distanceM?: number | null
    /** Расстояние оценено по прямой, а не построено маршрутизатором */
    distanceEstimated: boolean
  }> = []
  const stopsForEngine: Array<StopRequest & { afterSegmentIndex?: number }> = []

  const pendingStart = firstPendingIndex === -1 ? prepared.length : firstPendingIndex
  let legCounter = 0
  for (let index = pendingStart; index < prepared.length; index += 1) {
    const stage = prepared[index]
    const source = stages[index]

    if (stage.kind === "driving" || stage.kind === "return_to_base") {
      if (stage.from && stage.to) {
        const known = stage.distanceM != null && stage.distanceM > 0
        const estimatedDistanceM = known
          ? (stage.distanceM as number)
          : Math.round(haversineDistance(stage.from, stage.to) * 1000 * ROAD_DETOUR_FACTOR)
        legs.push({
          stageIndex: index,
          from: stage.from,
          to: stage.to,
          distanceM: estimatedDistanceM,
          distanceEstimated: !known,
        })
        legCounter += 1
      }
      continue
    }

    if (stage.stopRequest) {
      // Текущий этап уже частино отработан: движку отдаём ОСТАВОК, иначе
      // время, проведённое на складе, посчитается дважды.
      const alreadySpentMin =
        source.actualStartAt && !source.actualEndAt
          ? Math.max(0, (now.getTime() - source.actualStartAt.getTime()) / 60_000)
          : 0
      const stopRequest = stage.stopRequest
      const request: StopRequest =
        alreadySpentMin > 0
          ? {
              ...stopRequest,
              actualMinutes: Math.max(0, (stage.stop?.minutes ?? 0) - alreadySpentMin),
            }
          : stopRequest

      stopsForEngine.push({ ...request, afterSegmentIndex: Math.max(0, legCounter - 1) })
    }
  }

  // ── 4. Сегменты: реальная геометрия, если даны шаги маршрутизатора ────────
  const segments: RouteSegment[] = legs.map((leg, index) => {
    const distanceM = leg.distanceM ?? 0
    const speedKmh = 60
    return {
      index,
      from: leg.from,
      to: leg.to,
      distanceM,
      baseDurationSec: distanceM > 0 ? (distanceM / 1000 / speedKmh) * 3600 : 0,
      roadClass: {
        class: "unknown" as const,
        label: "класс не определён",
        // Оценённое по прямой плечо заслуживает ещё меньшего доверия, чем
        // плечо с известным расстоянием: класс дорог и рельеф неизвестны.
        confidence: leg.distanceEstimated ? 0.15 : 0.3,
        reason: leg.distanceEstimated
          ? "расстояние оценено по прямой ×1.3, геометрии маршрутизатора нет"
          : "геометрии маршрутизатора нет, расстояние известно",
      },
      baseSpeedKmh: speedKmh,
      speedSource: "table" as const,
      osrmSpeedKmh: speedKmh,
      freeFlowSec: distanceM > 0 ? (distanceM / 1000 / speedKmh) * 3600 : 0,
      roadName: undefined,
    }
  })

  // ── 5. Прогноз оставшейся части ───────────────────────────────────────────
  const engineOptions = {
    departure: now,
    timeZone,
    vehicle: options.vehicle,
    restrictions: options.restrictions ?? [],
    stops: stopsForEngine,
    restRules: options.restRules,
    priorDrivingMinutes: options.priorDrivingMinutes,
    events: options.events,
    historicalBySegment: options.historicalBySegment,
    useSeasonalFallback: options.useSeasonalFallback,
    weatherBySegment: options.weatherBySegment,
  }

  const forecast: ForecastResult | null =
    segments.length > 0 ? forecastSegments(segments, engineOptions) : null

  // Плановые времена по этапам берём У ДВИЖКА, а не считаем сами.
  //
  // Зачем: движок уже вставляет остановки и перерывы водителя в часы рейса
  // (lib/eta/forecast.ts), поэтому arrivalAt/departureAt его сегментов — это
  // и есть согласованная временная шкала. Если считать цепочку самостоятельно
  // сложением drivingSec, перерывы в неё не попадут и шкала разойдётся с итогом.
  let legIndex = 0
  for (let index = pendingStart; index < prepared.length; index += 1) {
    const stage = prepared[index]

    if (stage.kind === "driving" || stage.kind === "return_to_base") {
      const segment = forecast?.segments.find((item) => item.index === legIndex)
      stage.segment = segment
      stage.distanceM = legs[legIndex]?.distanceM ?? stage.distanceM
      // Плановое время плеча — момент прохода у движка
      stage.plannedStartAt = segment?.arrivalAt ?? new Date(now.getTime())
      stage.plannedEndAt = segment?.departureAt ?? stage.plannedStartAt
      legIndex += 1
      continue
    }

    // Операция: начинается там, где закончилось предыдущее плечо (или «сейчас»),
    // и заканчивается там, где начнётся следующее — движок уже учёл её длительность.
    const previous = prepared
      .slice(pendingStart, index)
      .reverse()
      .find((item) => item.plannedEndAt)
    const nextSegment = forecast?.segments.find((item) => item.index === legIndex)

    stage.plannedStartAt = previous?.plannedEndAt ?? new Date(now.getTime())
    // Окончание операции — начало следующего плеча (движок уже учёл её
    // длительность в часах). Если плечо последнее, следующего нет, поэтому
    // добавляем длительность операции сами: иначе финальная выгрузка
    // занимала бы ноль минут и шкала расходилась с итогом.
    const stopMinutes = stage.stop?.minutes ?? 0
    stage.plannedEndAt = nextSegment
      ? nextSegment.arrivalAt
      : new Date(stage.plannedStartAt.getTime() + stopMinutes * 60_000)
  }

  const remainingDrivingSec = forecast?.scenarios.base.drivingSec ?? 0
  const remainingStopsSec = forecast?.scenarios.base.stopsSec ?? 0
  const remainingRestSec = forecast?.scenarios.base.restSec ?? 0
  const remainingTotalSec = forecast?.scenarios.base.totalSec ?? 0

  // Движок считает от «сейчас», поэтому его arrivalAt и есть ответ.
  // elapsedSec здесь не добавляем: он уже учтён в остатках остановок.
  const remainingArrivalAt = forecast
    ? forecast.scenarios.base.arrivalAt
    : new Date(now.getTime())

  // Следующая точка: первый незавершённый этап
  const nextStage = nextStageIndex === null ? null : prepared[nextStageIndex]
  let nextPoint: TripEtaResult["nextPoint"] = null
  if (nextStage) {
    const segment = nextStage.segment
    const drivingSec = segment?.drivingSec ?? 0
    nextPoint = {
      address: nextStage.address,
      operation: nextStage.kind,
      orderId: nextStage.orderId,
      distanceM: nextStage.distanceM,
      drivingSec,
      arrivalAt: nextStage.plannedStartAt ?? new Date(now.getTime() + drivingSec * 1000),
    }
  }

  // Возврат на базу: последний этап такого типа
  const returnStage = [...prepared].reverse().find((stage) => stage.kind === "return_to_base")
  const returnToBase = returnStage
    ? {
        address: returnStage.address,
        distanceM: returnStage.distanceM,
        drivingSec: returnStage.segment?.drivingSec ?? 0,
        arrivalAt: returnStage.plannedEndAt ?? remainingArrivalAt,
      }
    : null

  const completionAt = returnStage?.plannedEndAt ?? remainingArrivalAt
  const totalRemainingSec = Math.max(0, (completionAt.getTime() - now.getTime()) / 1000)

  // ── 6. Качество данных — что именно неизвестно ────────────────────────────
  const estimatedLegs = legs.filter((leg) => leg.distanceEstimated).length
  const allLegsGeocoded = legs.length > 0 && legs.every((leg) => leg.distanceM != null && leg.distanceM > 0)
  const vehicleKnown = Boolean(options.vehicle && (options.vehicle.type || options.vehicle.capacity))
  const hasActuals = prepared.some((stage) => stage.actualStartAt || stage.actualEndAt)
  const weatherAvailable = (options.weatherBySegment || []).some((sample) => sample !== null)

  const warnings: string[] = []
  if (estimatedLegs > 0) {
    warnings.push(
      `у ${estimatedLegs} плеч(а) расстояние оценено по прямой ×1.3: маршрутизатор не построил геометрию, прогноз грубее`,
    )
  }
  if (legs.length > 0 && !allLegsGeocoded) {
    warnings.push("не у всех плеч есть расстояние: прогноз по ним грубее, чем по построенному маршруту")
  }
  if (!vehicleKnown) {
    warnings.push("нет данных о транспортном средстве: время по категории по умолчанию")
  }
  if (!weatherAvailable) {
    warnings.push("погода не учтена: источник отключён или недоступен")
  }
  if (legs.length === 0) {
    warnings.push("невозможных плеч не осталось: рейс завершён или точки не определены")
  }

  const corrections: Correction[] = forecast?.segments.flatMap((s) => s.corrections) ?? []

  return {
    modelVersion: forecast?.modelVersion ?? "trip-0",
    calculatedAt: new Date(),
    now,
    stages: prepared,
    currentStageIndex: currentStageIndex === -1 ? null : currentStageIndex,
    nextStageIndex,
    nextPoint,
    remaining: {
      drivingSec: remainingDrivingSec,
      stopsSec: remainingStopsSec,
      restSec: remainingRestSec,
      totalSec: remainingTotalSec,
      arrivalAt: remainingArrivalAt,
    },
    returnToBase,
    totalRemainingSec,
    completionAt,
    scenarios: forecast?.scenarios ?? {
      optimistic: { drivingSec: 0, stopsSec: 0, restSec: 0, totalSec: 0, arrivalAt: now },
      base: { drivingSec: 0, stopsSec: 0, restSec: 0, totalSec: 0, arrivalAt: now },
      conservative: { drivingSec: 0, stopsSec: 0, restSec: 0, totalSec: 0, arrivalAt: now },
    },
    confidence: forecast?.confidence ?? {
      level: "low",
      score: 0.2,
      reasons: ["рейс завершён: нечего прогнозировать"],
    },
    factors: forecast?.explanation ?? [],
    corrections,
    dataQuality: {
      allLegsGeocoded,
      estimatedLegs,
      vehicleKnown,
      hasActuals,
      weatherAvailable,
      warnings,
    },
    sources: {
      routing: "fallback",
      weather: weatherAvailable ? "open-meteo" : "unavailable",
      weatherEnabled: weatherAvailable,
    },
    reliable: forecast ? forecast.reliable : true,
    reliabilityNote: forecast?.reliabilityNote,
  }
}

/** Суммарное время остановок по сценарию — для сверки с движком. */
export function tripStopsSec(
  stages: readonly TripStageForecast[],
  scenario: "optimistic" | "base" | "conservative" = "base",
): number {
  const stops = stages
    .map((stage) => stage.stop)
    .filter((stop): stop is ResolvedStop => Boolean(stop))
  return totalStopMinutes(stops, scenario) * 60
}
