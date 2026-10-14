// lib/eta/stops.ts
//
// Остановки рейса: погрузка, выгрузка, документы, ожидание, доп. точки.
//
// Время рейса — это НЕ только время движения. По ТЗ §9 оно делится на движение,
// ожидание, погрузку, выгрузку, документы, перерывы, отдых и доп. задержки.
// Здесь — только наземные операции; остановки водителя (перерывы и отдых) живут
// в driver-rest.ts, чтобы не смешивать две разные сущности.
//
// Значения по умолчанию — диапазоны из ТЗ, а не нормативы. Если у склада или
// клиента есть своя фактическая длительность, она передаётся явно и имеет
// приоритет. Повторяющиеся рейсы: медиана/75-й/90-й процентили считаются по
// истории (calibration), здесь только интерфейс для их подстановки.

export type StopKind = "loading" | "unloading" | "documents" | "waiting" | "extra_point" | "other"

export const STOP_LABELS: Record<StopKind, string> = {
  loading: "погрузка",
  unloading: "выгрузка",
  documents: "документы",
  waiting: "ожидание на складе",
  extra_point: "дополнительная точка",
  other: "прочие работы",
}

/** Диапазоны из ТЗ, минуты. */
export const STOP_DEFAULTS: Record<StopKind, { min: number; typical: number; max: number }> = {
  loading: { min: 30, typical: 75, max: 120 },
  unloading: { min: 30, typical: 75, max: 120 },
  documents: { min: 10, typical: 20, max: 30 },
  waiting: { min: 0, typical: 60, max: 120 },
  extra_point: { min: 15, typical: 37, max: 60 },
  other: { min: 0, typical: 22, max: 45 },
}

export interface StopRequest {
  kind: StopKind
  /** Фактическая длительность у этого клиента/склада, минуты */
  actualMinutes?: number
  /** Медиана по истории, минуты */
  medianMinutes?: number
  label?: string
}

export interface ResolvedStop {
  kind: StopKind
  label: string
  /** Базовое время операции, минуты */
  minutes: number
  /** Откуда взялось число */
  source: "actual" | "history" | "default"
  /** Разброс для сценариев */
  optimisticMinutes: number
  conservativeMinutes: number
}

/**
 * Приводит остановку к минутам с указанием источника.
 *
 * Приоритет (ТЗ §9): фактическая длительность у клиента → медиана по истории →
 * диапазон по умолчанию. «Типичное» значение — середина диапазона, а не
 * норматив: это предположение, и в объяснении так и написано.
 */
export function resolveStop(request: StopRequest): ResolvedStop {
  const defaults = STOP_DEFAULTS[request.kind]

  if (typeof request.actualMinutes === "number" && request.actualMinutes >= 0) {
    const minutes = Math.round(request.actualMinutes)
    return {
      kind: request.kind,
      label: request.label || STOP_LABELS[request.kind],
      minutes,
      source: "actual",
      optimisticMinutes: Math.round(minutes * 0.8),
      conservativeMinutes: Math.round(minutes * 1.3),
    }
  }

  if (typeof request.medianMinutes === "number" && request.medianMinutes >= 0) {
    const minutes = Math.round(request.medianMinutes)
    return {
      kind: request.kind,
      label: request.label || STOP_LABELS[request.kind],
      minutes,
      source: "history",
      optimisticMinutes: Math.round(minutes * 0.8),
      conservativeMinutes: Math.round(minutes * 1.5),
    }
  }

  return {
    kind: request.kind,
    label: request.label || STOP_LABELS[request.kind],
    minutes: defaults.typical,
    source: "default",
    optimisticMinutes: defaults.min,
    conservativeMinutes: defaults.max,
  }
}

/** Суммарное время остановок по сценарию. */
export function totalStopMinutes(
  stops: readonly ResolvedStop[],
  scenario: "optimistic" | "base" | "conservative",
): number {
  return stops.reduce((sum, stop) => {
    const value =
      scenario === "optimistic"
        ? stop.optimisticMinutes
        : scenario === "conservative"
          ? stop.conservativeMinutes
          : stop.minutes
    return sum + value
  }, 0)
}

/**
 * Статистика по истории операций — медиана и процентили.
 *
 * Нужна для повторяющихся рейсов (ТЗ §9). Защита от выбросов: значения вне
 * [0, 24 часа] отбрасываются как некорректный факт.
 */
export function operationStats(
  samples: readonly number[],
): { median: number; p75: number; p90: number; count: number } | null {
  const clean = samples.filter((value) => Number.isFinite(value) && value >= 0 && value <= 1440)
  if (clean.length === 0) return null

  const sorted = [...clean].sort((a, b) => a - b)
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

  return {
    median: pick(0.5),
    p75: pick(0.75),
    p90: pick(0.9),
    count: clean.length,
  }
}
