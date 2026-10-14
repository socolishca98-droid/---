// lib/eta/metrics.ts
//
// Метрики точности прогноза по фактическим рейсам.
//
// Зачем: по ТЗ нужны MAE, медианная абсолютная ошибка, доля попаданий в
// коридор 15/30 минут, систематическое опережение/опоздание и разбивка по
// регионам, типам дорог, сезонам и погоде. Без этого «улучшение» ETA — просто
// набор мнений: непонятно, стало лучше или нет.
//
// Важное правило: автоматически переписывать коэффициенты по нескольким рейсам
// нельзя. Поэтому здесь только ИЗМЕРЕНИЕ, а не обучение. Порог для пересмотра
// коэффициентов задан отдельной константой (MIN_SAMPLES_FOR_RECALIBRATION) —
// пока данных меньше, метрики носят справочный характер.

import { seasonOf, type Season } from "./time"

export const MIN_SAMPLES_FOR_RECALIBRATION = 50

/** Пара «прогноз → факт» по одному рейсу. */
export interface ForecastFact {
  /** Прогноз времени прибытия */
  predictedAt: Date
  /** Фактическое прибытие */
  actualAt: Date
  /** Фактическое время движения, сек (может отличаться от прибытия — остановки) */
  actualDrivingSec?: number | null
  /** Прогноз времени движения, сек */
  predictedDrivingSec?: number
  /**
   * Доминирующий класс дороги по времени сегментов. Строка, а не RoadClass:
   * значение приходит из сохранённого JSON и теоретически может быть любым —
   * для группировки в разбивке этого достаточно.
   */
  roadClass?: string | null
  region?: string | null
  /** Какой была погода в рейсе */
  weatherCondition?: string | null
  /** Выброс: рейс оформлен с ошибкой, в метрики не идёт */
  outlier?: boolean
}

export interface AccuracyMetrics {
  sampleCount: number
  /** Средняя абсолютная ошибка, мин */
  maeMinutes: number
  /** Медианная абсолютная ошибка, мин */
  medianAbsErrorMinutes: number
  /** Доля прогнозов в пределах 15 минут, 0..1 */
  within15Minutes: number
  /** Доля прогнозов в пределах 30 минут, 0..1 */
  within30Minutes: number
  /**
   * Систематическая ошибка, мин: положительная — прогноз ОПОЗДАНИЕ
   * (факт позже прогноза), отрицательная — ОПЕРЕЖЕНИЕ.
   */
  biasMinutes: number
  /** Отклонение прогноза времени движения от факта, мин (если есть данные) */
  drivingBiasMinutes: number | null
  /** Есть ли достаточная выборка для пересмотра коэффициентов */
  recalibrationReady: boolean
  outliersExcluded: number
}

/** Абсолютная ошибка прибытия в минутах. */
export function arrivalErrorMinutes(fact: ForecastFact): number {
  return (fact.actualAt.getTime() - fact.predictedAt.getTime()) / 60_000
}

/** Считает метрики по набору фактов. */
export function calculateAccuracyMetrics(facts: readonly ForecastFact[]): AccuracyMetrics {
  const usable = facts.filter((fact) => !fact.outlier)
  const outliersExcluded = facts.length - usable.length

  if (usable.length === 0) {
    return {
      sampleCount: 0,
      maeMinutes: 0,
      medianAbsErrorMinutes: 0,
      within15Minutes: 0,
      within30Minutes: 0,
      biasMinutes: 0,
      drivingBiasMinutes: null,
      recalibrationReady: false,
      outliersExcluded,
    }
  }

  const errors = usable.map(arrivalErrorMinutes)
  const absolute = errors.map((value) => Math.abs(value))

  const withDriving = usable.filter(
    (fact) => fact.actualDrivingSec != null && fact.predictedDrivingSec != null,
  )
  const drivingBiasMinutes =
    withDriving.length > 0
      ? withDriving.reduce((sum, fact) => {
          const actual = (fact.actualDrivingSec as number) / 60
          const predicted = (fact.predictedDrivingSec as number) / 60
          return sum + (actual - predicted)
        }, 0) / withDriving.length
      : null

  return {
    sampleCount: usable.length,
    maeMinutes: round1(mean(absolute)),
    medianAbsErrorMinutes: round1(median(absolute)),
    within15Minutes: round2(absolute.filter((value) => value <= 15).length / usable.length),
    within30Minutes: round2(absolute.filter((value) => value <= 30).length / usable.length),
    biasMinutes: round1(mean(errors)),
    drivingBiasMinutes: drivingBiasMinutes === null ? null : round1(drivingBiasMinutes),
    recalibrationReady: usable.length >= MIN_SAMPLES_FOR_RECALIBRATION,
    outliersExcluded,
  }
}

export type BreakdownKey = "roadClass" | "region" | "season" | "weatherCondition"

/**
 * Разбивка ошибки по измерению (тип дороги, регион, сезон, погода).
 *
 * Нужна, чтобы понять, ГДЕ именно прогноз врёт: систематическое опоздание
 * только зимой — это погодная модель, а ошибка только на федеральных трассах —
 * базовая скорость.
 */
export function breakdownBy(
  facts: readonly ForecastFact[],
  key: BreakdownKey,
): Array<{ group: string; metrics: AccuracyMetrics }> {
  const groups = new Map<string, ForecastFact[]>()

  for (const fact of facts) {
    let group: string
    if (key === "season") {
      group = seasonOf(fact.predictedAt)
    } else {
      const value = key === "weatherCondition" ? fact.weatherCondition : fact[key]
      group = value == null || value === "" ? "нет данных" : String(value)
    }
    const list = groups.get(group) || []
    list.push(fact)
    groups.set(group, list)
  }

  return [...groups.entries()]
    .map(([group, list]) => ({ group, metrics: calculateAccuracyMetrics(list) }))
    .sort((a, b) => b.metrics.maeMinutes - a.metrics.maeMinutes)
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
