// lib/eta/traffic-model.ts
//
// Модель дорожной обстановки без платных API.
//
// Приоритет источников (см. ТЗ §4):
//   1. фактическая скорость на сегменте — есть только у платных сервисов пробок
//      (Яндекс от 120 000 ₽/год, 2ГИС от 6 701 ₽ за 10 000 запросов);
//   2. исторические данные по сегменту — появятся, когда накопится статистика
//      фактических рейсов (lib/eta/calibration);
//   3. модель по часу суток, дню недели, сезону и классу дороги — то, что ниже;
//   4. базовая скорость без поправки.
//
// Коэффициенты — ГИПОТЕЗЫ для начальной модели, не измеренная статистика.
// Поэтому они живут в одной таблице, которую можно заменить на откалиброванную
// без переписывания расчётной логики.

import { localDayOfWeek, localHour, seasonOf, type Season } from "./time"
import type { RoadClass } from "./road-class"

/** Группа дорог: город, пригород, загородная трасса. */
export type TrafficZone = "city" | "suburban" | "rural"

/** Класс дороги → группа пробок. */
export function zoneOfClass(roadClass: RoadClass): TrafficZone {
  switch (roadClass) {
    case "motorway":
    case "federal":
    case "regional":
      return "rural"
    case "rural":
    case "settlement":
      return "suburban"
    case "city":
    case "dense_city":
    case "industrial":
      return "city"
    default:
      // Класс неизвестен — НЕ считаем это городом. Иначе участок трассы без
      // названия получал бы коэффициенты часа пик, которых там нет: на живом
      // маршруте из-за этого 218 км из 265 ехали с городскими поправками.
      // Нейтральная зона — минимальные коэффициенты, без выдумывания.
      // Проверено тестом: «city» обязан давать городскую зону, а не эту.
      return "rural"
  }
}

/**
 * Коэффициенты по часам для обычных городских условий.
 *
 * Время  Город  Пригород  Загородная трасса
 * 00-05  1.00   1.00      1.00
 * 05-06  1.05   1.03      1.00
 * 06-07  1.15   1.10      1.02
 * 07-09  1.50   1.30      1.05
 * 09-11  1.15   1.10      1.02
 * 11-16  1.10   1.05      1.00
 * 16-19  1.55   1.40      1.05
 * 19-21  1.15   1.10      1.02
 * 21-24  1.03   1.02      1.00
 *
 * Это СТАРТОВАЯ КОНФИГУРАЦИЯ, а не норматив. Величина часа пик взята из
 * отношения свободной скорости к средней в часы пик для крупных городов
 * (снижение средней скорости на 35-45%): город ×1.5-1.55, пригород ×1.3-1.4,
 * загородная трасса почти не страдает. Точная настройка — по фактическим
 * рейсам (lib/eta/metrics.ts): пока выборка меньше
 * MIN_SAMPLES_FOR_RECALIBRATION, числа считаем ориентиром. Пересмотр
 * коэффициентов по трём рейсам запрещён — это переобучение.
 */
export const TRAFFIC_BY_HOUR: Record<TrafficZone, number[]> = {
  city: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.15, 1.5, 1.5, 1.15, 1.15, 1.1, 1.1, 1.1, 1.1, 1.1, 1.55, 1.55, 1.55, 1.15, 1.15, 1.03, 1.03],
  suburban: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.03, 1.1, 1.3, 1.3, 1.1, 1.1, 1.05, 1.05, 1.05, 1.05, 1.05, 1.4, 1.4, 1.4, 1.1, 1.1, 1.02, 1.02],
  rural: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.02, 1.05, 1.05, 1.02, 1.02, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.05, 1.05, 1.02, 1.02, 1.0, 1.0],
}

/** Поправка на день недели: пятница вечером и воскресенье обратно пропорциональны. */
const DAY_FACTORS: Record<number, number> = {
  0: 0.95, // воскресенье
  1: 1.0,
  2: 1.0,
  3: 1.0,
  4: 1.02,
  5: 1.08, // пятница
  6: 0.97, // суббота
}

/** Сезонная поправка на ИНТЕНСИВНОСТЬ трафика (не на скорость — это погодная модель). */
const SEASON_TRAFFIC_FACTORS: Record<Season, number> = {
  winter: 1.05,
  spring: 1.02,
  summer: 1.04,
  autumn: 1.03,
}

/**
 * Официальные праздники РФ (фиксированные даты, мм-дд).
 *
 * Переносы выходных не считаем: для планирования рейса важен порядок величин,
 * а не юридическая точность. Если праздник придёт на будний день — берём
 * воскресный коэффициент.
 */
const RU_HOLIDAYS = new Set([
  "01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08",
  "02-23", "03-08", "05-01", "05-09", "06-12", "11-04",
])

export interface TrafficContext {
  when: Date
  roadClass: RoadClass
  /** Часовой пояс, в котором считать местное время сегмента */
  timeZone?: string
}

export interface TrafficEstimate {
  /** Итоговый коэффициент (>= 1: больше единицы — медленнее) */
  factor: number
  zone: TrafficZone
  hourFactor: number
  dayFactor: number
  seasonFactor: number
  holiday: boolean
  /** Из чего сложилось — для объяснения в интерфейсе */
  reason: string
}

/** Считает коэффициент дорожной обстановки для конкретного сегмента в момент прохождения. */
export function estimateTraffic(ctx: TrafficContext): TrafficEstimate {
  const zone = zoneOfClass(ctx.roadClass)
  const hour = Math.min(23, Math.max(0, Math.floor(localHour(ctx.when, ctx.timeZone))))
  const day = localDayOfWeek(ctx.when, ctx.timeZone)
  const season = seasonOf(ctx.when, ctx.timeZone)

  const hourFactor = TRAFFIC_BY_HOUR[zone][hour]
  const dayFactor = DAY_FACTORS[day] ?? 1.0
  const seasonFactor = SEASON_TRAFFIC_FACTORS[season]

  const holiday = isRuHoliday(ctx.when, ctx.timeZone)
  const holidayFactor = holiday ? 0.95 : 1.0

  const factor = hourFactor * dayFactor * seasonFactor * holidayFactor

  const parts: string[] = []
  parts.push(`${zone === "city" ? "город" : zone === "suburban" ? "пригород" : "трасса"} ${hour}:00 ×${round(hourFactor)}`)
  if (Math.abs(dayFactor - 1) > 0.001) parts.push(`день недели ×${round(dayFactor)}`)
  if (Math.abs(seasonFactor - 1) > 0.001) parts.push(`сезон ×${round(seasonFactor)}`)
  if (holiday) parts.push("праздник ×0.95")

  return {
    factor,
    zone,
    hourFactor,
    dayFactor,
    seasonFactor,
    holiday,
    reason: parts.join(", "),
  }
}

function isRuHoliday(date: Date, timeZone?: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || process.env.ETA_TIMEZONE || "Europe/Moscow",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
  return RU_HOLIDAYS.has(parts)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Диапазон неопределённости модели пробок.
 *
 * Верхняя граница — на сколько модель может ошибиться в плохую сторону. Берём
 * запас, пропорциональный силе самого коэффициента: в час пик неизвестность
 * выше, чем ночью. Для оптимистичного и консервативного сценариев.
 */
export function trafficUncertainty(estimate: TrafficEstimate): { optimistic: number; conservative: number } {
  const excess = Math.max(0, estimate.factor - 1)
  return {
    optimistic: 1 - Math.min(0.25, excess * 0.5),
    conservative: 1 + Math.min(0.6, excess * 0.9),
  }
}
