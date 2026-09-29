// lib/drivers/rating.ts
//
// Рейтинг водителя — только из проверяемых фактов программы: своевременные
// доставки (deliveredAt против deadline заказа) и полнота документов
// (фото типа document у доставленных заказов). Никаких субъективных оценок:
// каждую цифру можно открыть и пересчитать.

/** Веса итоговой оценки: пунктуальность важнее бумаг, но бумаги не пустышка. */
export const RATING_WEIGHT_ON_TIME = 0.6
export const RATING_WEIGHT_DOCS = 0.4

/** Доля 0..1; при нулевом знаменателе — null (данных нет, а не «ноль»). */
export function share(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  const value = (Number.isFinite(part) ? part : 0) / total
  return Math.min(1, Math.max(0, value))
}

export type DriverGrade = "отлично" | "хорошо" | "удовлетворительно" | "требует внимания"

export function gradeByScore(score: number): DriverGrade {
  if (score >= 90) return "отлично"
  if (score >= 75) return "хорошо"
  if (score >= 50) return "удовлетворительно"
  return "требует внимания"
}

export interface DriverRating {
  /** Доставок всего */
  deliveredTotal: number
  /** Доля доставок в срок, 0..1 */
  onTime: number | null
  /** Доля доставок с документами на месте, 0..1 */
  docs: number | null
  /** Итоговая оценка 0..100 */
  score: number
  grade: DriverGrade
}

export function driverRating(params: {
  deliveredTotal: number
  deliveredOnTime: number
  deliveredWithDocs: number
}): DriverRating | null {
  if (!Number.isFinite(params.deliveredTotal) || params.deliveredTotal <= 0) return null
  const onTime = share(params.deliveredOnTime, params.deliveredTotal)
  const docs = share(params.deliveredWithDocs, params.deliveredTotal)
  const score = Math.round(
    (RATING_WEIGHT_ON_TIME * (onTime ?? 0) + RATING_WEIGHT_DOCS * (docs ?? 0)) * 100,
  )
  return {
    deliveredTotal: params.deliveredTotal,
    onTime,
    docs,
    score,
    grade: gradeByScore(score),
  }
}
