// lib/rest/norms.ts
//
// Нормы труда и отдыха водителя: считаем непрерывное время в пути по смене
// и событиям рейса «отдых начался/закончился» и подсказываем, когда пора
// отдыхать. Математика чистая: её видно в тестах, в коде ни одного скрытого
// допущения, кроме одного — незакрытый отдых идёт до текущего момента.

export interface RestEventLike {
  status: string | null
  createdAt: Date | string
}

export const REST_START = "rest_start"
export const REST_END = "rest_end"

function minutes(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / 60000)
}

/** Суммарные минуты отдыха по парам событий; незакрытый отдых идёт до now. */
export function sumRestMinutes(
  events: readonly RestEventLike[],
  shiftStart: Date,
  now: Date,
): number {
  const sorted = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  let total = 0
  let restStartedAt: Date | null = null
  for (const event of sorted) {
    const at = new Date(event.createdAt)
    if (event.status === REST_START) {
      if (restStartedAt === null) restStartedAt = at
    } else if (event.status === REST_END) {
      if (restStartedAt !== null) {
        total += minutes(restStartedAt, at)
        restStartedAt = null
      }
    }
  }
  if (restStartedAt !== null) total += minutes(restStartedAt, now)
  return Math.round(total)
}

/** Непрерывное время в пути: смена минус отдых, не меньше нуля. */
export function drivingMinutes(shiftStart: Date, now: Date, restMinutes: number): number {
  return Math.max(0, Math.round(minutes(shiftStart, now) - restMinutes))
}

export interface RestVerdict {
  /** Водитель прямо сейчас отдыхает (незакрытое событие отдыха) */
  resting: boolean
  /** Пора отдыхать: непрерывное движение достигло лимита */
  restDue: boolean
  /** Минут непрерывного движения до напоминания (0 — уже пора) */
  minutesToRest: number
  /** Сколько минут длится текущий перерыв (0 — не отдыхает) */
  currentBreakMin: number
  /** Текущий перерыв уже засчитывается как отдых по норме */
  breakCounts: boolean
}

export function restVerdict(params: {
  shiftStart: Date
  now: Date
  restMinutes: number
  resting: boolean
  currentBreakMin: number
  limitMin: number
  minBreakMin: number
}): RestVerdict {
  const driven = drivingMinutes(params.shiftStart, params.now, params.restMinutes)
  const restDue = !params.resting && driven >= params.limitMin
  return {
    resting: params.resting,
    restDue,
    minutesToRest: Math.max(0, params.limitMin - driven),
    currentBreakMin: params.currentBreakMin,
    breakCounts: params.resting && params.currentBreakMin >= params.minBreakMin,
  }
}

/** Последнее незакрытое «отдых начался» и длительность перерыва сейчас. */
export function currentBreak(
  events: readonly RestEventLike[],
  now: Date,
): { resting: boolean; currentBreakMin: number } {
  const sorted = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  let startedAt: Date | null = null
  for (const event of sorted) {
    if (event.status === REST_START) startedAt = new Date(event.createdAt)
    else if (event.status === REST_END) startedAt = null
  }
  if (startedAt === null) return { resting: false, currentBreakMin: 0 }
  return { resting: true, currentBreakMin: Math.round(minutes(startedAt, now)) }
}
