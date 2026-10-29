// lib/analytics/shift-time.ts
//
// Аналитика времени водителей: сколько ехал, сколько стоял на погрузке,
// сколько ждал у ворот, сколько отдыхал.
//
// Источник — журнал переключений статусов смены (ShiftEvent, type: "status"),
// который пишут кнопки на главном экране водителя. Ничего не выдумываем:
// если водитель не нажал кнопку, время уйдёт в тот статус, который был
// включён, — это честнее, чем придумывать «нормативное» время.
//
// Функции чистые: на вход структуры, на выход числа. Поэтому их можно
// проверить тестами без базы и использовать и в API, и в выгрузке.

import {
  bucketOf,
  buildTimeline,
  summarizeTimeline,
  type BucketSummary,
  type ShiftBucket,
  type ShiftSegment,
  type ShiftStatusEvent,
} from "@/lib/shift/timeline"

export interface ShiftTimeInput {
  id: string
  driverId: string
  driverName: string
  startedAt: Date
  endedAt: Date | null
  events: ShiftStatusEvent[]
}

export interface BucketStats {
  seconds: number
  stops: number
}

export interface DriverTimeRow {
  driverId: string
  driverName: string
  /** Сколько смен попало в период */
  shifts: number
  /** По группам: путь, погрузка, выгрузка, ожидание, отдых, заправка */
  buckets: Record<ShiftBucket, BucketStats>
  /** Средняя длина одной погрузки, секунды (0 — погрузок не было) */
  avgLoadingSeconds: number
  /** Самая долгая погрузка за период, секунды */
  maxLoadingSeconds: number
  /** Средняя длина одной выгрузки, секунды */
  avgUnloadingSeconds: number
  /** Самая долгая выгрузка за период, секунды */
  maxUnloadingSeconds: number
  /** Всего учтённого времени (сумма групп) */
  totalSeconds: number
}

export interface ShiftTimeReport {
  /** По водителям, отсортировано по убыванию учтённого времени */
  drivers: DriverTimeRow[]
  /** Итоги по организации */
  totals: Record<ShiftBucket, BucketStats>
  /** Сколько смен обработано */
  shiftsCount: number
  /** Смены без единого события: кнопки не нажимались, время не измерено */
  shiftsWithoutEvents: number
}

function emptyBuckets(): Record<ShiftBucket, BucketStats> {
  return {
    driving: { seconds: 0, stops: 0 },
    loading: { seconds: 0, stops: 0 },
    unloading: { seconds: 0, stops: 0 },
    waiting: { seconds: 0, stops: 0 },
    resting: { seconds: 0, stops: 0 },
    fueling: { seconds: 0, stops: 0 },
    other: { seconds: 0, stops: 0 },
  }
}

/** Среднее по ненулевым значениям: нулевые длины не занижают результат. */
function average(values: number[]): number {
  const meaningful = values.filter((value) => value > 0)
  if (meaningful.length === 0) return 0
  return Math.round(meaningful.reduce((sum, value) => sum + value, 0) / meaningful.length)
}

/**
 * Аналитика по сменам: одна смена = один набор отрезков, из отрезков —
 * итоги по группам и остановки (погрузок, выгрузок, перерывов).
 */
export function buildShiftTimeReport(shifts: readonly ShiftTimeInput[]): ShiftTimeReport {
  const byDriver = new Map<string, DriverTimeRow>()
  const totals = emptyBuckets()
  let shiftsWithoutEvents = 0

  for (const shift of shifts) {
    if (shift.events.length === 0) shiftsWithoutEvents += 1

    const segments: ShiftSegment[] = buildTimeline({
      events: shift.events,
      shiftStart: shift.startedAt,
      until: shift.endedAt ?? new Date(),
    })

    const summary: BucketSummary[] = summarizeTimeline(segments)

    const row =
      byDriver.get(shift.driverId) ??
      ({
        driverId: shift.driverId,
        driverName: shift.driverName,
        shifts: 0,
        buckets: emptyBuckets(),
        avgLoadingSeconds: 0,
        maxLoadingSeconds: 0,
        avgUnloadingSeconds: 0,
        maxUnloadingSeconds: 0,
        totalSeconds: 0,
      } satisfies DriverTimeRow)

    row.shifts += 1

    const loadingLengths: number[] = []
    const unloadingLengths: number[] = []

    for (const segment of segments) {
      const bucket = bucketOf(segment.status)
      if (bucket === "loading") loadingLengths.push(segment.seconds)
      if (bucket === "unloading") unloadingLengths.push(segment.seconds)
    }

    for (const entry of summary) {
      row.buckets[entry.bucket].seconds += entry.seconds
      row.buckets[entry.bucket].stops += entry.stops
      totals[entry.bucket].seconds += entry.seconds
      totals[entry.bucket].stops += entry.stops
    }

    row.avgLoadingSeconds = average([...loadingLengths])
    row.maxLoadingSeconds = Math.max(row.maxLoadingSeconds, ...loadingLengths, 0)
    row.avgUnloadingSeconds = average([...unloadingLengths])
    row.maxUnloadingSeconds = Math.max(row.maxUnloadingSeconds, ...unloadingLengths, 0)
    row.totalSeconds = Object.values(row.buckets).reduce((sum, entry) => sum + entry.seconds, 0)

    byDriver.set(shift.driverId, row)
  }

  const drivers = [...byDriver.values()].sort((a, b) => b.totalSeconds - a.totalSeconds)

  return {
    drivers,
    totals,
    shiftsCount: shifts.length,
    shiftsWithoutEvents,
  }
}

/** Доля группы в учтённом времени, проценты — для полосок в отчёте. */
export function bucketShare(seconds: number, totalSeconds: number): number {
  if (totalSeconds <= 0) return 0
  return Math.round((seconds / totalSeconds) * 100)
}
