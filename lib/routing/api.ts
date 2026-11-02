// lib/routing/api.ts
//
// Контракт эндпоинта `POST /api/logist/routing/plan`: вход и выход.
//
// Зачем отдельным модулем. Всё, что стоит между ядром и логистом, — это разбор
// тела запроса и сборка ответа. Ошибка здесь не видна ни в тестах ядра, ни в
// аудите качества: ядро посчитает правильно, а экран получит не то. Пример из
// этой же работы: сервер отдавал по семь вариантов на машину — 143 КБ на пять
// машин и около 1,8 МБ в худшем случае, — а экран всё равно показывал три.
//
// Поэтому разбор запроса (ограничение значений, отбраковка мусора, момент
// расчёта) и сборка ответа (даты строками, ограничение вариантов, честный
// счётчик `variantsTotal`) живут здесь и проверяются отдельно.

import type { PlanResult, RoutePlan } from "./types"
import type { OptimizerOutput } from "./service"

/** Сколько грузов максимум берём из накопительной базы за один расчёт. */
export const POOL_LIMIT_MAX = 200
export const POOL_LIMIT_DEFAULT = 120
/** Горизонт планирования: от часа до двух недель. */
export const HORIZON_MAX_HOURS = 24 * 14
export const HORIZON_DEFAULT_HOURS = 72
/** Сколько идентификаторов принимаем в exclude/keep — защита от «запроса на мегабайт». */
export const IDS_MAX = 300
/** Сколько вариантов на машину отдаём экрану (он показывает не больше трёх). */
export const VARIANTS_PER_VEHICLE = 3
/**
 * Насколько «в прошлое» можно попросить расчёт. Дальше суток назад план
 * бессмыслен: машины уже не там, окна прошли.
 */
export const NOW_PAST_LIMIT_MS = 86_400_000

export interface PlanRequest {
  poolLimit: number
  horizonHours: number
  source: "ati" | "orders" | "both"
  now: Date
  excludeIds?: string[]
  keepIds?: string[]
  vehicleId?: string
}

/**
 * Тело запроса → параметры расчёта.
 *
 * Правило одно: ни одно поле не может подменить данные. «Чьи грузы» и «чей
 * автопарк» берутся из сессии, а не из тела, поэтому здесь только размеры и
 * фильтры по СВОИМ данным. Всё, что не проходит проверку, заменяется
 * значением по умолчанию — молча, но предсказуемо: отказ на «poolLimit: -5» не
 * помогает логисту, а «взять 120» — помогает.
 */
export function parsePlanRequest(body: unknown, now: Date = new Date()): PlanRequest {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {}

  const number = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(Math.max(Math.round(parsed), min), max)
  }

  const source: PlanRequest["source"] =
    raw.source === "ati" || raw.source === "orders" || raw.source === "both" ? raw.source : "both"

  // Момент расчёта передаётся для воспроизводимости (тесты, разбор случая).
  // «Позавчера» и «через год» — не воспроизводимость, а способ сломать план.
  let moment = now
  if (typeof raw.now === "string") {
    const parsed = new Date(raw.now)
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() >= now.getTime() - NOW_PAST_LIMIT_MS) {
      moment = parsed
    }
  }

  const idList = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined
    return value
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .slice(0, IDS_MAX)
  }

  return {
    poolLimit: number(raw.poolLimit, POOL_LIMIT_DEFAULT, 1, POOL_LIMIT_MAX),
    horizonHours: number(raw.horizonHours, HORIZON_DEFAULT_HOURS, 1, HORIZON_MAX_HOURS),
    source,
    now: moment,
    excludeIds: idList(raw.excludeIds),
    keepIds: idList(raw.keepIds),
    vehicleId: typeof raw.vehicleId === "string" && raw.vehicleId.length > 0 ? raw.vehicleId : undefined,
  }
}

/**
 * План → JSON.
 *
 * Даты уходят строками ISO: браузер не должен догадываться, в каком поясе
 * пришло «2026-11-02T05:00:00.000Z», и не должен получать объект `Date`,
 * который в JSON молча станет строкой без явного формата.
 */
export function serializePlan(plan: RoutePlan) {
  return {
    ...plan,
    schedule: {
      ...plan.schedule,
      startAt: plan.schedule.startAt.toISOString(),
      endAt: plan.schedule.endAt.toISOString(),
      events: plan.schedule.events.map((event) => ({
        ...event,
        at: event.at.toISOString(),
      })),
    },
    stops: plan.stops.map((stop) => ({
      ...stop,
      arriveAt: stop.arriveAt.toISOString(),
      startAt: stop.startAt.toISOString(),
      endAt: stop.endAt.toISOString(),
    })),
  }
}

/** Одна машина в ответе: рекомендация, варианты для экрана и счёт найденного. */
export function serializeVehiclePlan(item: PlanResult) {
  return {
    vehicleId: item.vehicleId,
    organisationId: item.organisationId,
    recommended: item.recommended ? serializePlan(item.recommended) : null,
    variants: item.variants.slice(0, VARIANTS_PER_VEHICLE).map(serializePlan),
    // Сколько вариантов нашлось ВСЕГО. Без этого числа «показали три» читается
    // как «нашли три», и логист не знает, что поиск был шире.
    variantsTotal: item.variants.length,
    rejected: item.rejected,
    stats: item.stats,
  }
}

/**
 * Результат расчёта → тело ответа.
 *
 * Два случая, и оба честные:
 *  · плана нет — отдаём причину первым блокером и полный список блокеров;
 *  · план есть — отдаём машины, проверку независимым валидатором и сводку.
 * Пустого ответа «200 и ничего» не бывает: если маршрута нет, сказано почему.
 */
export function planResponse(result: OptimizerOutput) {
  const base = {
    readiness: result.readiness,
    summary: result.summary,
  }
  if (!result.plan) {
    return {
      ...base,
      ok: false as const,
      message: result.readiness.blockers[0] ?? "маршрут не построен",
    }
  }
  return {
    ...base,
    ok: true as const,
    organisationId: result.plan.organisationId,
    stats: result.plan.stats,
    perVehicle: result.plan.perVehicle.map(serializeVehiclePlan),
    // Проверка независимым валидатором — в ответе, а не «в логах»: если правило
    // нарушено, это видно и API, и экрану.
    validations: result.plan.validations.map((entry) => ({
      planId: entry.planId,
      ok: entry.result.ok,
      issues: entry.result.issues,
    })),
  }
}
