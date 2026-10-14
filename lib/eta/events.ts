// lib/eta/events.ts
//
// Дорожные события: ДТП, ремонт, полное перекрытие.
//
// Зачем отдельный модуль: ТЗ требует проверять ДОПУСТИМОСТЬ маршрута отдельно от
// коэффициентов. Частичное перекрытие — это поправка ко времени на затронутых
// сегментах, и она честно попадает в объяснение. А вот ПОЛНОЕ перекрытие нельзя
// «замаскировать» коэффициентом: любое число, которым мы умножим время, будет
// ложью — машина не проедет. Поэтому полное перекрытие возвращает признак
// blocked, а ETA помечается ненадёжной и требует альтернативного маршрута.
//
// Источник данных: события приходят извне параметром (оператор, диспетчер,
// сообщение клиента). Бесплатного автоматического источника происшествий по
// России нет — см. раздел «Источники данных» в отчёте.

import type { RoadClass } from "./road-class"

export type EventSeverity = "partial" | "full"

export interface RoadEvent {
  /** К какому сегменту относится */
  segmentIndex: number
  severity: EventSeverity
  /** Что случилось — для объяснения */
  description: string
  /** Когда сообщено */
  reportedAt: Date
  /** После этого момента событие устаревает; 0 — бессрочно */
  expiresAt?: Date | null
}

export interface EventAssessment {
  /** Множитель времени на сегменте */
  factor: number
  /** Полное перекрытие: сегмент непроходим */
  blocked: boolean
  reason: string
}

/** Сколько раз дольше ехать на затронутом участке. */
const PARTIAL_FACTOR: Record<RoadClass, number> = {
  motorway: 1.6,
  federal: 1.6,
  regional: 1.5,
  rural: 1.4,
  settlement: 1.4,
  city: 1.45,
  dense_city: 1.35,
  industrial: 1.3,
  unknown: 1.4,
}

/**
 * Оценивает влияние события на сегмент.
 *
 * Не «штрафуем» за любое событие одинаково: на узкой городской улице пробка
 * от ДТП относительна меньше, чем сужение магистрали с 4 полос до 1.
 */
export function assessEvent(
  event: RoadEvent,
  roadClass: RoadClass,
): EventAssessment {
  if (event.severity === "full") {
    return {
      factor: Number.POSITIVE_INFINITY,
      blocked: true,
      reason: `${event.description}: движение невозможно, нужен другой маршрут`,
    }
  }

  return {
    factor: PARTIAL_FACTOR[roadClass] ?? 1.4,
    blocked: false,
    reason: `${event.description}: движение ограничено`,
  }
}

/**
 * События, действующие на интересующий момент.
 *
 * Устаревшие события отбрасываются: диспетчер сообщил о ДТП в 9:00, а расчёт
 * идёт на 19:00 — вряди ли пробка там ещё стоит. Без проверки времени события
 * модель навсегда запомнила бы аварию на одном и том же месте.
 */
export function activeEvents(
  events: readonly RoadEvent[],
  at: Date,
): RoadEvent[] {
  return events.filter((event) => {
    if (event.expiresAt && event.expiresAt.getTime() < at.getTime()) return false
    return true
  })
}

/** События, привязанные к конкретному сегменту. */
export function eventsForSegment(
  events: readonly RoadEvent[],
  segmentIndex: number,
): RoadEvent[] {
  return events.filter((event) => event.segmentIndex === segmentIndex)
}

/** Есть ли среди событий блокирующие (для API: reliable = false). */
export function hasBlockingEvent(assessments: readonly EventAssessment[]): boolean {
  return assessments.some((assessment) => assessment.blocked)
}
