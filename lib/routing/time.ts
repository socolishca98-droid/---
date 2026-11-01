// lib/routing/time.ts
//
// Time Engine: календарное расписание рейса.
//
// Что здесь считается и чего не было в старом сборщике:
//   · ожидание окна погрузки и выгрузки — отдельной статьёй, а не «как-нибудь
//     внутри часов»;
//   · рабочие часы точки погрузки (склад не начинает в 3 ночи);
//   · отдых водителя по норме КОНКРЕТНОЙ организации (не зашитые 9/11);
//   · местное время каждой точки и переходы часовых поясов: рейс из
//     Екатеринбурга в Красноярск идёт через два пояса, и «погрузка в 9 утра» —
//     это время склада, а не сервера;
//   · разделение «время в движении» и «календарная длительность» — логист
//     планирует машину по календарю.
//
// Модуль чистый: ни базы, ни сети, ни текущего времени «из системы» — всё
// приходит аргументами, поэтому расписание воспроизводимо.

import type { Place, Settings } from "./types"

export interface TimeEngineInput {
  /** Момент выезда (UTC) */
  departAt: Date
  settings: Pick<
    Settings,
    "drivingLimitHours" | "restHours" | "openingHour" | "preparationHours"
  >
}

/**
 * Форматтеры кешируются: создание `Intl.DateTimeFormat` — самая дорогая
 * операция в расчёте расписания (десятки микросекунд, а вызывается она на
 * каждой точке каждого варианта). Кеш на часовой пояс, а не на вызов.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  formatters.set(timeZone, created)
  return created
}

/**
 * Кеш смещений пояса: (пояс, сутки) → минуты.
 *
 * Смещение меняется дважды в год, а не каждый час, поэтому считать его на
 * каждый переход поиска бессмысленно. Замер: на пуле из 12 заказов
 * `zoneOffsetMinutes` занимал 45 % всего времени расчёта — больше, чем сам
 * перебор цепочек. Ключ — сутки: в пределах суток смещение постоянно, а на
 * границе перевода часов погрешность не выходит за минуты и всё равно
 * пересчитывается на следующих сутках.
 */
const offsetCache = new Map<string, number>()

function dayKey(date: Date, timeZone: string): string {
  return `${timeZone}|${Math.floor(date.getTime() / 86_400_000)}`
}

/** Смещение часового пояса в минутах для конкретного момента. */
export function zoneOffsetMinutes(date: Date, timeZone: string | null | undefined): number {
  if (!timeZone) return 0
  const key = dayKey(date, timeZone)
  const cached = offsetCache.get(key)
  if (cached !== undefined) return cached
  const computed = computeZoneOffsetMinutes(date, timeZone)
  if (offsetCache.size > 20_000) offsetCache.clear()
  offsetCache.set(key, computed)
  return computed
}

function computeZoneOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const parts = formatterFor(timeZone).formatToParts(date)
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second"),
    )
    return Math.round((asUtc - date.getTime()) / 60000)
  } catch {
    return 0
  }
}

/** Местное время точки: часы и минуты. */
export function localClock(
  date: Date,
  timeZone: string | null | undefined,
): { hour: number; minute: number } {
  const offset = zoneOffsetMinutes(date, timeZone)
  const local = new Date(date.getTime() + offset * 60000)
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() }
}

/** Подпись «02.11, 09:40 (Moscow)» — для таймлайна на экране. */
export function formatLocal(date: Date, place: Place | null): string {
  const offset = zoneOffsetMinutes(date, place?.timeZone)
  const local = new Date(date.getTime() + offset * 60000)
  const day = String(local.getUTCDate()).padStart(2, "0")
  const month = String(local.getUTCMonth() + 1).padStart(2, "0")
  const hh = String(local.getUTCHours()).padStart(2, "0")
  const mm = String(local.getUTCMinutes()).padStart(2, "0")
  const zone = place?.timeZone ? ` (${place.timeZone.split("/").pop()})` : ""
  return `${day}.${month}, ${hh}:${mm}${zone}`
}

/** Перевести «местные часы точки» в UTC: ближайшее наступление этого часа. */
export function atLocalHour(date: Date, timeZone: string | null | undefined, hour: number): Date {
  const offset = zoneOffsetMinutes(date, timeZone)
  const local = new Date(date.getTime() + offset * 60000)
  const targetLocal = new Date(local)
  targetLocal.setUTCHours(hour, 0, 0, 0)
  if (targetLocal.getTime() < local.getTime()) targetLocal.setUTCDate(targetLocal.getUTCDate() + 1)
  return new Date(targetLocal.getTime() - offset * 60000)
}

export interface DriveState {
  /** Часы за рулём с последнего отдыха */
  sinceRest: number
  /** Сколько отдыха уже добавлено в календарь */
  restHours: number
  /** Часы вождения всего */
  drivingHours: number
}

/**
 * Движение по участку с нормами отдыха.
 *
 * Возвращает момент прибытия и обновлённое состояние. Отдых не «съедается»
 * молча: он добавляется в календарь, иначе «успеваем» будет ложью.
 */
export function driveSegment(
  start: Date,
  hours: number,
  state: DriveState,
  settings: TimeEngineInput["settings"],
): { arriveAt: Date; state: DriveState; restAdded: number } {
  const limit = Math.max(1, settings.drivingLimitHours)
  const rest = Math.max(0, settings.restHours)
  let remaining = Math.max(0, hours)
  let sinceRest = state.sinceRest
  let clock = start.getTime()
  let restAdded = 0
  let guard = 0
  while (remaining > 1e-9 && guard++ < 500) {
    const available = limit - sinceRest
    if (remaining <= available + 1e-9) {
      clock += remaining * 3600000
      sinceRest += remaining
      remaining = 0
      break
    }
    // Доехали до предела вождения — обязательный отдых.
    clock += available * 3600000
    remaining -= available
    clock += rest * 3600000
    restAdded += rest
    sinceRest = 0
  }
  return {
    arriveAt: new Date(clock),
    state: {
      sinceRest,
      restHours: state.restHours + restAdded,
      drivingHours: state.drivingHours + Math.max(0, hours),
    },
    restAdded,
  }
}

/** Начало работы точки: не раньше открытия и не раньше окна. */
export function readyFrom(
  arrival: Date,
  place: Place,
  windowFrom: string | null | undefined,
  openingHour: number,
): { startAt: Date; waitingHours: number } {
  let start = arrival
  const windowStart = windowFrom ? new Date(windowFrom) : null
  if (windowStart && !Number.isNaN(windowStart.getTime()) && windowStart > start) {
    start = windowStart
  }
  const clock = localClock(start, place.timeZone)
  if (openingHour > 0 && clock.hour < openingHour) {
    start = atLocalHour(start, place.timeZone, openingHour)
  }
  return { startAt: start, waitingHours: Math.max(0, (start.getTime() - arrival.getTime()) / 3600000) }
}

/** Позже окна — опоздание: это предупреждение, а не отказ. */
export function lateBy(startAt: Date, windowTo: string | null | undefined): number | null {
  if (!windowTo) return null
  const to = new Date(windowTo)
  if (Number.isNaN(to.getTime())) return null
  const hours = (startAt.getTime() - to.getTime()) / 3600000
  return hours > 0 ? Math.round(hours * 10) / 10 : null
}
