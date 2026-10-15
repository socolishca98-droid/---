// lib/logist-mobile/assistant-eta.ts
//
// Сравнение «до/после» для помощника сборки рейсов.
//
// Зачем: помощник предлагает СБРАТЬ несколько заказов в один рейс. Логист
// должен видеть, что именно меняется, а не только «стало лучше»:
//   * длина рейса, время движения, операции, перерывы, длительность;
//   * возврат на базу;
//   * нарушения сроков заказов (окон доставки).
//
// «До» — каждый заказ возится отдельным рейсом (как если бы помощник ничего
// не предложил). «После» — предложенный рейс. Разница и есть выгода
// консолидации: экономится холостой пробег между точками разных заказов.
//
// Расчёт идёт через ЕДИНЫЙ механизм lib/eta/trip.ts — тот же, что кабинет
// водителя и карта логиста. Своей формулы здесь нет, иначе помощник обещал
// бы одно время, а водитель увидел бы другое.
//
// Важно: эта функция ничего не пишет в базу. Альтернативы помощника —
// только расчёт на экране; рейс создаётся после подтверждения логистом.

import {
  buildRouteStages,
  calculateTripEta,
  type TripEtaResult,
  type TripEtaOptions,
} from "@/lib/eta/trip"

import type { AssistantOrder, AssistantVehicle } from "./route-assistant"

/** Что показываем в сравнении по одому варианту. */
export interface EtaSummary {
  /** Суммарная длина, км (по оценке маршрутизатора, где он доступен) */
  distanceKm: number
  /** Время движения, с */
  drivingSec: number
  /** Операции (погрузка/выгрузка/документы/ожидание), с */
  stopsSec: number
  /** Обязательные перерывы, с */
  restSec: number
  /** Полная длительность, с */
  totalSec: number
  /** Возврат на базу входит в рейс */
  returnToBase: boolean
  /** Сколько плеч с оценённым (не построенным) расстоянием */
  estimatedLegs: number
  /** Завершение рейса */
  completionAt: Date
}

/** Изменение показателя: было → стало. */
export interface EtaDelta {
  label: string
  before: number
  after: number
  /** На сколько изменилось (after - before) */
  delta: number
  /** Меньше — лучше (для длины, времени, перерывов) */
  lowerIsBetter: boolean
  /** Как форматировать: «км», «мин» */
  unit: "km" | "min"
  /** Объяснение, почему показатель изменился */
  why: string
}

export interface AssistantComparison {
  before: EtaSummary
  after: EtaSummary
  /**
   * Что значит «до»: каждый заказ возится ОТДЕЛЬНЫМ рейсом. Такие рейсы
   * могут ехать параллельно (разные машины), поэтому:
   *   * before.totalSec — СУММА работы по всем рейсам;
   *   * before.completionAt — момент, когда доставлен последний заказ.
   * Сравнивать сумму с суммой, а не сумму с моментом, иначе цифры врут.
   */
  beforeNote: string
  deltas: EtaDelta[]
  /** Заказы, чей срок будет нарушен после сборки рейса */
  deadlineViolations: Array<{ orderId: string; routeTo: string; deadline: string; arrivalAt: Date }>
  /** Объяснения словами: почему стало лучше или хуже */
  explanations: string[]
  /** Прогноз, из которого взяты цифры (для деталей на экране) */
  afterTrip: TripEtaResult
}

export interface AssistantEtaOptions {
  /** База организации: без неё возврат на базу не считается */
  base?: { lat: number; lng: number } | null
  baseAddress?: string
  /** Время начала рейса (по умолчанию — сейчас) */
  departureAt?: Date
  /** Часовой пояс для часовых коэффициентов */
  timeZone?: string
  /**
   * Координаты адресов: адрес → точка. Без них сравнение честно скажет,
   * что плечи не определены, а не покажет нули как результат.
   */
  coords?: Map<string, { lat: number; lng: number } | null>
}

/**
 * Заказы → этапы. Координаты передаёт вызывающий код (сервер геокодирует
 * адреса): без них buildRouteStages не построит ни одного плеча, и сравнение
 * молча превратится в нули.
 */
function ordersToStages(
  orders: AssistantOrder[],
  coords?: Map<string, { lat: number; lng: number } | null>,
) {
  return orders.map((order) => ({
    id: order.id,
    routeFrom: order.routeFrom,
    routeTo: order.routeTo,
    routeSequence: null,
    from: coords?.get(order.routeFrom.trim()) ?? undefined,
    to: coords?.get(order.routeTo.trim()) ?? undefined,
  }))
}

/** Сводка по прогнозу рейса. */
function summarize(trip: TripEtaResult): EtaSummary {
  const distanceM = trip.stages.reduce(
    (sum, stage) =>
      sum + (stage.kind === "driving" || stage.kind === "return_to_base" ? (stage.distanceM ?? 0) : 0),
    0,
  )
  return {
    distanceKm: Math.round((distanceM / 1000) * 10) / 10,
    drivingSec: Math.round(trip.remaining.drivingSec),
    stopsSec: Math.round(trip.remaining.stopsSec),
    restSec: Math.round(trip.remaining.restSec),
    totalSec: Math.round(trip.remaining.totalSec),
    returnToBase: trip.returnToBase != null,
    estimatedLegs: trip.dataQuality.estimatedLegs,
    completionAt: trip.completionAt,
  }
}

/** Округление до десятых: 225.40000000000003 в интерфейсе выглядит сломанным. */
function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** Срок заказа → дата. Пустая строка и мусор дают null. */
function parseDeadline(deadline: string | null | undefined): Date | null {
  if (!deadline) return null
  const date = new Date(deadline)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Сравнивает «заказы возим по отдельности» и «всё одним рейсом».
 *
 * Ничего не пишет в базу: альтернатива живёт только в этом расчёте, пока
 * логист не нажал «создать рейс».
 */
export function compareAssistantProposal(
  orders: AssistantOrder[],
  vehicle: AssistantVehicle | null,
  options: AssistantEtaOptions = {},
): AssistantComparison | null {
  if (orders.length === 0) return null

  const now = options.departureAt ?? new Date()
  const etaOptions: TripEtaOptions = {
    now,
    timeZone: options.timeZone,
    vehicle: vehicle
      ? {
          type: vehicle.type ?? undefined,
          capacity: vehicle.capacity ?? undefined,
          volume: vehicle.volume ?? undefined,
        }
      : undefined,
    origin:
      options.base != null
        ? { point: options.base, address: options.baseAddress ?? "база" }
        : null,
    returnToBase:
      options.base != null
        ? { point: options.base, address: options.baseAddress ?? "база" }
        : null,
  }

  // ── «До»: каждый заказ — отдельный рейс ──
  const stageOptions = {
    origin: etaOptions.origin,
    returnToBase: etaOptions.returnToBase,
  }
  const beforeTrips = orders.map((order) =>
    calculateTripEta(buildRouteStages(ordersToStages([order], options.coords), stageOptions), etaOptions),
  )
  const before: EtaSummary = {
    distanceKm: Math.round(beforeTrips.reduce((sum, trip) => sum + summarize(trip).distanceKm, 0) * 10) / 10,
    drivingSec: beforeTrips.reduce((sum, trip) => sum + summarize(trip).drivingSec, 0),
    stopsSec: beforeTrips.reduce((sum, trip) => sum + summarize(trip).stopsSec, 0),
    restSec: beforeTrips.reduce((sum, trip) => sum + summarize(trip).restSec, 0),
    totalSec: beforeTrips.reduce((sum, trip) => sum + summarize(trip).totalSec, 0),
    returnToBase: beforeTrips.every((trip) => trip.returnToBase != null),
    estimatedLegs: beforeTrips.reduce((sum, trip) => sum + trip.dataQuality.estimatedLegs, 0),
    completionAt: new Date(
      Math.max(...beforeTrips.map((trip) => trip.completionAt.getTime())),
    ),
  }

  // ── «После»: предложенный рейс ──
  const afterTrip = calculateTripEta(
    buildRouteStages(ordersToStages(orders, options.coords), stageOptions),
    etaOptions,
  )
  const after = summarize(afterTrip)

  // ── Нарушения сроков ──
  const deadlineViolations: AssistantComparison["deadlineViolations"] = []
  for (const order of orders) {
    const deadline = parseDeadline(order.deadline)
    if (!deadline) continue
    // Ищем момент выгрузки этого заказа в предложенном рейсе
    const stage = afterTrip.stages.find(
      (candidate) => candidate.orderId === order.id && candidate.kind === "unloading",
    )
    const arrivalAt = stage?.plannedEndAt ?? after.completionAt
    if (arrivalAt.getTime() > deadline.getTime()) {
      deadlineViolations.push({
        orderId: order.id,
        routeTo: order.routeTo,
        deadline: deadline.toISOString(),
        arrivalAt,
      })
    }
  }

  // ── Изменения по показателям ──
  const deltas: EtaDelta[] = [
    {
      label: "Длина рейса",
      before: before.distanceKm,
      after: after.distanceKm,
      delta: round(after.distanceKm * 10) / 10 - round(before.distanceKm * 10) / 10,
      lowerIsBetter: true,
      unit: "km",
      why:
        after.distanceKm < before.distanceKm
          ? "заказы едут один маршрут: холостые перегоны между городами разных заказов не повторяются"
          : "маршрут удлинился: точки заказов расположены так, что объединение добавляет пробег",
    },
    {
      label: "Время движения",
      before: Math.round(before.drivingSec / 60),
      after: Math.round(after.drivingSec / 60),
      delta: Math.round(after.drivingSec / 60) - Math.round(before.drivingSec / 60),
      lowerIsBetter: true,
      unit: "min",
      why:
        after.drivingSec < before.drivingSec
          ? "меньше километров — меньше и времени за рулём"
          : "маршрут длиннее, поэтому движения больше",
    },
    {
      label: "Операции",
      before: Math.round(before.stopsSec / 60),
      after: Math.round(after.stopsSec / 60),
      delta: Math.round(after.stopsSec / 60) - Math.round(before.stopsSec / 60),
      lowerIsBetter: true,
      unit: "min",
      why:
        after.stopsSec === before.stopsSec
          ? "погрузка и выгрузка каждого заказа считаются один раз — сборка рейса их не дублирует"
          : "на Operations-points changed: склады рейса другие",
    },
    {
      label: "Перерывы",
      before: Math.round(before.restSec / 60),
      after: Math.round(after.restSec / 60),
      delta: Math.round(after.restSec / 60) - Math.round(before.restSec / 60),
      lowerIsBetter: false,
      unit: "min",
      why:
        after.restSec > before.restSec
          ? "рейс длиннее по времени, поэтому обязательных перерывов больше"
          : "рейс короче по времени, перерывов нужно меньше",
    },
    {
      label: "Длительность",
      before: Math.round(before.totalSec / 60),
      after: Math.round(after.totalSec / 60),
      delta: Math.round(after.totalSec / 60) - Math.round(before.totalSec / 60),
      lowerIsBetter: true,
      unit: "min",
      why:
        after.totalSec < before.totalSec
          ? "в сумме рейс занимает меньше времени, чем заказы по отдельности"
          : "в сумме рейс занимает больше времени: точки удалены друг от друга",
    },
  ]

  const explanations: string[] = deltas
    .filter((delta) => delta.delta !== 0)
    .map((delta) => `${delta.label}: ${delta.why}`)

  if (deadlineViolations.length > 0) {
    explanations.push(
      `Срок будет нарушен у ${deadlineViolations.length} заказ(ов): доставка позже согласованной даты. ` +
        `Либо начните рейс раньше, либо не берите эти заказы в этот рейс.`,
    )
  }
  if (after.estimatedLegs > 0) {
    explanations.push(
      `У ${after.estimatedLegs} плеч(а) расстояние оценено по прямой: маршрутизатор не построил геометрию, цифры грубее.`,
    )
  }

  return {
    before,
    after,
    deltas,
    deadlineViolations,
    explanations,
    afterTrip,
    beforeNote:
      "«До» — каждый заказ отдельным рейсом. Рейсы могут ехать параллельно, " +
      "поэтому общая длительность — сумма работы, а завершение — момент " +
      "доставки последнего заказа.",
  }
}
