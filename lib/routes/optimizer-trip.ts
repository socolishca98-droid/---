// lib/routes/optimizer-trip.ts
//
// Сценарий рейса для оптимизатора — на ЕДИНОМ движке времени.
//
// Зачем: оптимизатор считал время вызовом calculateETA (lib/eta/service.ts) —
// «одно число на весь маршрут». Из-за этого он не учитывал ни порядок
// погрузки/выгрузки, ни обязательные перерывы, ни возврат на базу, ни сроки
// заказов: в оптимизаторе рейс из 6 точек выходил на 4 часа короче, чем в
// кабинете водителя.
//
// Здесь сценарий считается той же шкалой этапов (lib/eta/trip.ts), что
// показывает водителю и логисту. Своей формулы времени в модуле нет.
//
// API оптимизатора не меняется: модуль возвращает те же величины, что он и
// раньше доставал из ETACalculation (километры, минуты, стоимость, риск).

import {
  buildRouteStages,
  calculateTripEta,
  type TripEtaOptions,
  type TripEtaResult,
} from "@/lib/eta/trip"
import { calculateRouteCost } from "@/lib/eta/coefficients"
import type { Coordinates } from "@/lib/eta/types"
import type { VehicleInput } from "@/lib/eta/vehicle-profile"

/** Заказ оптимизатора в форме, нужной единому движку. */
export interface OptimizerTripOrder {
  id: string
  routeFrom: string
  routeTo: string
  /** Координата погрузки */
  from: Coordinates
  /** Координата выгрузки */
  to: Coordinates
  /** Расстояние погрузка → выгрузка, км (если логист вносил) */
  distance?: number | null
  /** Срок заказа */
  deadline?: Date | null
  price?: number | null
  weight?: number | null
}

export interface OptimizerTripInput {
  /** Заказы УЖЕ в нужном порядке объезда */
  orders: OptimizerTripOrder[]
  /** База: без неё возврат на базу не считается */
  base?: { point: Coordinates; address?: string } | null
  vehicle?: VehicleInput | null
  departure: Date
  timeZone?: string
}

export interface OptimizerTripResult {
  /** Километры по дорогам (или оценка, если OSRM недоступен) */
  distanceKm: number
  /** Время движения, мин */
  baseMin: number
  /** Полное время рейса с операциями и перерывами, мин */
  etaMin: number
  /** Операции (погрузка/выгрузка/документы/ожидание), мин */
  stopsMin: number
  /** Обязательные перерывы, мин */
  restMin: number
  /** Сколько плеч с оценённым расстоянием (не построено маршрутизатором) */
  estimatedLegs: number
  /** Возврат на базу считается отдельным плечом */
  returnToBase: boolean
  /** Завершение рейса */
  completionAt: Date
  /** Сроки, которые будут нарушены */
  deadlineViolations: Array<{ orderId: string; routeTo: string; deadline: Date; arrivalAt: Date }>
  /** Топливо и платные дороги — та же модель, что и раньше в проекте */
  cost: { fuel: number; tolls: number; total: number }
  /** Полный прогноз: этапы, сегменты, уверенность, качество данных */
  trip: TripEtaResult
  /** Шкала этапов для интерфейса: что и когда происходит */
  stages: Array<{
    index: number
    kind: string
    label: string
    address?: string
    orderId: string | null
    distanceKm: number | null
    plannedStartAt: Date
    plannedEndAt: Date
  }>
}

/**
 * Считает сценарий рейса единым движком.
 *
 * Расстояние: у плеча «погрузка → выгрузка» берём расстояние из заказа
 * (его вносили логисты, оно точнее прямой между городами), у остальных плеч —
 * оценку движка (прямая ×1.3, честно помеченная).
 */
export function calculateOptimizerTrip(input: OptimizerTripInput): OptimizerTripResult {
  const { orders, base, vehicle, departure } = input

  const stages = buildRouteStages(
    orders.map((order) => ({
      id: order.id,
      routeFrom: order.routeFrom,
      routeTo: order.routeTo,
      from: order.from,
      to: order.to,
      routeSequence: null,
    })),
    {
      origin: base ?? null,
      returnToBase: base ?? null,
    },
  ).map((stage) => ({
    ...stage,
    // Расстояние заказа — только плечу до точки выгрузки (см. lib/eta/trip.ts)
    distanceM:
      stage.kind === "driving" && stage.leg === "to_dropoff" && stage.orderId
        ? ((orders.find((order) => order.id === stage.orderId)?.distance ?? 0) * 1000 || null)
        : null,
  }))

  const options: TripEtaOptions = {
    now: departure,
    timeZone: input.timeZone,
    vehicle: vehicle ?? undefined,
    restrictions: [],
  }

  const trip = calculateTripEta(stages, options)

  const distanceM = trip.stages.reduce(
    (sum, stage) =>
      sum +
      (stage.kind === "driving" || stage.kind === "return_to_base" ? (stage.distanceM ?? 0) : 0),
    0,
  )
  const distanceKm = Math.round(distanceM / 100) / 10

  // Стоимость — прежняя модель проекта: 32 л/100 км × 65 ₽/л и оценка
  // платных дорог по средней ставке. Она не часть ETA и не менялась.
  const cost = calculateRouteCost(distanceKm, vehicle as never)

  const deadlineViolations: OptimizerTripResult["deadlineViolations"] = []
  for (const order of orders) {
    if (!order.deadline) continue
    const stage = trip.stages.find(
      (candidate) => candidate.orderId === order.id && candidate.kind === "unloading",
    )
    const arrivalAt = stage?.plannedEndAt ?? trip.completionAt
    if (arrivalAt.getTime() > order.deadline.getTime()) {
      deadlineViolations.push({
        orderId: order.id,
        routeTo: order.routeTo,
        deadline: order.deadline,
        arrivalAt,
      })
    }
  }

  return {
    distanceKm,
    baseMin: Math.round(trip.remaining.drivingSec / 60),
    etaMin: Math.round(trip.remaining.totalSec / 60),
    stopsMin: Math.round(trip.remaining.stopsSec / 60),
    restMin: Math.round(trip.remaining.restSec / 60),
    estimatedLegs: trip.dataQuality.estimatedLegs,
    returnToBase: trip.returnToBase != null,
    completionAt: trip.completionAt,
    deadlineViolations,
    cost: { fuel: cost.fuel, tolls: cost.tolls, total: cost.total },
    trip,
    stages: trip.stages.map((stage) => ({
      index: stage.index,
      kind: stage.kind,
      label: stage.label,
      address: stage.address,
      orderId: stage.orderId ?? null,
      distanceKm: stage.distanceM != null ? Math.round((stage.distanceM / 1000) * 10) / 10 : null,
      plannedStartAt: stage.plannedStartAt ?? departure,
      plannedEndAt: stage.plannedEndAt ?? departure,
    })),
  }
}
