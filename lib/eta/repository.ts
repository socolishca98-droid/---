// lib/eta/repository.ts
//
// Хранение прогноза и факта времени прибытия.
//
// Два правила, из-за которых этот модуль вообще существует:
//
//   1. Прогноз бесполезен, если его не с чем сравнить. Поэтому при создании
//      сохраняется исходный прогноз, а по завершении рейса — факт и ошибка.
//      Без этого «улучшение ETA» превращается в набор мнений.
//   2. Изоляция организаций. Каждый запрос читает и пишет ТОЛЬКО в пределах
//      organizationId из проверенной сессии. Фильтр стоит в SQL-условии, а не
//      в интерфейсе: спрятать кнопку — не значит закрыть данные.
//
// Файл серверный: Prisma и node-рантайм. В клиентские компоненты не импортировать.

import "server-only"

import { prisma } from "@/lib/prisma"
import type { ForecastResult } from "./forecast"

export interface SaveForecastInput {
  organizationId: string | null
  routeId?: string | null
  orderId?: string | null
  vehicleId?: string | null
  driverId?: string | null
  forecast: ForecastResult
  /** Снимок погодных данных, по которым считали (JSON) */
  weatherSnapshot?: unknown
  /** Источники: osrm, open-meteo, history */
  sources?: string[]
}

/**
 * Сохраняет прогноз. Возвращает id — по нему потом записывается факт.
 *
 * При повторном расчёте того же рейса currentArrivalAt обновляется, а
 * initialArrivalAt остаётся «как посчитали в первый раз»: разница между ними
 * показывает, насколько прогноз уезжал по ходу рейса.
 */
export async function saveForecast(input: SaveForecastInput): Promise<string> {
  const { forecast } = input

  const row = await prisma.etaForecast.create({
    data: {
      organizationId: input.organizationId,
      routeId: input.routeId ?? null,
      orderId: input.orderId ?? null,
      vehicleId: input.vehicleId ?? null,
      driverId: input.driverId ?? null,
      modelVersion: forecast.modelVersion,
      sourcesJson: JSON.stringify(input.sources ?? []),
      timeZone: forecast.timeZone,
      departureAt: forecast.departureAt,
      initialArrivalAt: forecast.scenarios.base.arrivalAt,
      currentArrivalAt: forecast.scenarios.base.arrivalAt,
      optimisticArrivalAt: forecast.scenarios.optimistic.arrivalAt,
      conservativeArrivalAt: forecast.scenarios.conservative.arrivalAt,
      drivingSec: Math.round(forecast.scenarios.base.drivingSec),
      stopsSec: Math.round(forecast.scenarios.base.stopsSec),
      restSec: Math.round(forecast.scenarios.base.restSec),
      totalSec: Math.round(forecast.scenarios.base.totalSec),
      distanceM: Math.round(
        forecast.segments.reduce((sum, segment) => sum + segment.distanceM, 0),
      ),
      confidenceScore: forecast.confidence.score,
      confidenceLevel: forecast.confidence.level,
      confidenceReasonsJson: JSON.stringify(forecast.confidence.reasons),
      segmentsJson: JSON.stringify(forecast.segments),
      explanationJson: JSON.stringify(forecast.explanation),
      weatherJson: input.weatherSnapshot ? JSON.stringify(input.weatherSnapshot) : null,
      violationsJson: JSON.stringify(forecast.violations),
      reliable: forecast.reliable,
      reliabilityNote: forecast.reliabilityNote ?? null,
      calculatedAt: new Date(),
      recalcCount: 0,
    },
    select: { id: true },
  })

  return row.id
}

export interface RecordActualInput {
  actualArrivalAt: Date
  actualDrivingSec?: number
  actualStopsSec?: number
  delayReasons?: string[]
  /** Выброс: рейс оформлен с ошибкой, в метрики не идёт */
  outlier?: boolean
}

/**
 * Записывает фактический результат по прогнозу.
 *
 * organizationId передаётся обязательно и проверяется в условии UPDATE: чужой
 * прогноз обновить нельзя даже зная его id. Это и есть изоляция организаций
 * на уровне данных, а не интерфейса.
 *
 * Ошибка прогноза (errorMinutes) считается здесь же, чтобы её нельзя было
 * подделать с клиента: положительное значение — прибыли позже прогноза.
 */
export async function recordActual(
  forecastId: string,
  organizationId: string,
  input: RecordActualInput,
): Promise<{ ok: true; errorMinutes: number } | { ok: false; reason: "not_found" }> {
  const existing = await prisma.etaForecast.findFirst({
    where: { id: forecastId, organizationId },
    select: { currentArrivalAt: true, drivingSec: true },
  })

  if (!existing) return { ok: false, reason: "not_found" }

  const errorMinutes =
    (input.actualArrivalAt.getTime() - existing.currentArrivalAt.getTime()) / 60_000

  await prisma.etaForecast.update({
    where: { id: forecastId },
    data: {
      actualArrivalAt: input.actualArrivalAt,
      actualDrivingSec: input.actualDrivingSec ?? null,
      actualStopsSec: input.actualStopsSec ?? null,
      delayReasonsJson: input.delayReasons ? JSON.stringify(input.delayReasons) : null,
      errorMinutes,
      outlier: input.outlier ?? false,
    },
  })

  return { ok: true, errorMinutes }
}

/** Пересчёт прогноза в рейсе: обновляет прогноз, не трогая исходный. */
export async function updateForecast(
  forecastId: string,
  organizationId: string,
  forecast: ForecastResult,
): Promise<{ ok: boolean }> {
  const existing = await prisma.etaForecast.findFirst({
    where: { id: forecastId, organizationId },
    select: { id: true },
  })
  if (!existing) return { ok: false }

  await prisma.etaForecast.update({
    where: { id: forecastId },
    data: {
      currentArrivalAt: forecast.scenarios.base.arrivalAt,
      optimisticArrivalAt: forecast.scenarios.optimistic.arrivalAt,
      conservativeArrivalAt: forecast.scenarios.conservative.arrivalAt,
      drivingSec: Math.round(forecast.scenarios.base.drivingSec),
      stopsSec: Math.round(forecast.scenarios.base.stopsSec),
      restSec: Math.round(forecast.scenarios.base.restSec),
      totalSec: Math.round(forecast.scenarios.base.totalSec),
      confidenceScore: forecast.confidence.score,
      confidenceLevel: forecast.confidence.level,
      confidenceReasonsJson: JSON.stringify(forecast.confidence.reasons),
      segmentsJson: JSON.stringify(forecast.segments),
      explanationJson: JSON.stringify(forecast.explanation),
      violationsJson: JSON.stringify(forecast.violations),
      reliable: forecast.reliable,
      reliabilityNote: forecast.reliabilityNote ?? null,
      modelVersion: forecast.modelVersion,
      recalcCount: { increment: 1 },
    },
  })

  return { ok: true }
}

/** Читает прогноз. Только в пределах организации. */
export async function getForecast(forecastId: string, organizationId: string) {
  return prisma.etaForecast.findFirst({
    where: { id: forecastId, organizationId },
  })
}

/** Последний прогноз по рейсу — для показа «как считали изначально». */
export async function getForecastByRoute(routeId: string, organizationId: string) {
  return prisma.etaForecast.findFirst({
    where: { routeId, organizationId },
    orderBy: { createdAt: "desc" },
  })
}

export interface ForecastFactRow {
  predictedAt: Date
  actualAt: Date
  actualDrivingSec: number | null
  predictedDrivingSec: number
  roadClass: string | null
  region: string | null
  weatherCondition: string | null
  outlier: boolean
}

/**
 * Выборка «прогноз → факт» по организации для метрик точности.
 *
 * Берём только строки с заполненным фактом: незавершённые рейсы в метрики
 * не идут, иначе половина «ошибок» окажется просто незакрытыми рейсами.
 */
export async function listForecastFacts(
  organizationId: string,
  options: { since?: Date; until?: Date; limit?: number } = {},
): Promise<ForecastFactRow[]> {
  const rows = await prisma.etaForecast.findMany({
    where: {
      organizationId,
      actualArrivalAt: { not: null },
      ...(options.since || options.until
        ? {
            calculatedAt: {
              ...(options.since ? { gte: options.since } : {}),
              ...(options.until ? { lte: options.until } : {}),
            },
          }
        : {}),
    },
    orderBy: { calculatedAt: "desc" },
    take: options.limit ?? 500,
    select: {
      currentArrivalAt: true,
      actualArrivalAt: true,
      actualDrivingSec: true,
      drivingSec: true,
      segmentsJson: true,
      weatherJson: true,
      outlier: true,
    },
  })

  return rows.map((row) => {
    // Доминирующий класс дороги по времени — из сегментов
    const roadClass = dominantRoadClass(row.segmentsJson)
    const weatherCondition = dominantWeather(row.weatherJson)

    return {
      predictedAt: row.currentArrivalAt,
      actualAt: row.actualArrivalAt as Date,
      actualDrivingSec: row.actualDrivingSec,
      predictedDrivingSec: row.drivingSec,
      roadClass,
      region: null,
      weatherCondition,
      outlier: row.outlier,
    }
  })
}

/**
 * Доминирующий класс дороги по времени сегментов.
 *
 * Нужен для разбивки ошибки по типам дорог: если промах только на трассах —
 * дело в базовой скорости, если в городе — в модели пробок.
 */
function dominantRoadClass(segmentsJson: string | null): string | null {
  if (!segmentsJson) return null
  try {
    const segments = JSON.parse(segmentsJson) as Array<{ roadClass?: string; drivingSec?: number }>
    const byTime = new Map<string, number>()
    for (const segment of segments) {
      if (!segment.roadClass) continue
      byTime.set(segment.roadClass, (byTime.get(segment.roadClass) ?? 0) + (segment.drivingSec ?? 0))
    }
    let best: string | null = null
    let bestTime = -1
    for (const [klass, seconds] of byTime) {
      if (seconds > bestTime) {
        bestTime = seconds
        best = klass
      }
    }
    return best
  } catch {
    return null
  }
}

/** Самое «влиятельное» погодное условие рейса. */
function dominantWeather(weatherJson: string | null): string | null {
  if (!weatherJson) return null
  try {
    const parsed = JSON.parse(weatherJson) as unknown
    if (Array.isArray(parsed)) {
      const conditions = parsed
        .map((item) => (item as { condition?: string })?.condition)
        .filter((value): value is string => Boolean(value) && value !== "clear")
      return conditions[0] ?? (parsed[0] as { condition?: string })?.condition ?? null
    }
    return (parsed as { condition?: string })?.condition ?? null
  } catch {
    return null
  }
}
