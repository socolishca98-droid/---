// lib/eta/rate-limit.ts
//
// Ограничение частоты для эндпоинтов, которые обращаются к внешним API.
//
// Зачем отдельный модуль. POST /api/eta/forecast и GET /api/routes/:id/trip
// делают запросы к OSRM и (при включённой погоде) к Open-Meteo. Без
// ограничения один пользователь может выжать чужие лимиты: на Hobby-плане
// Vercel функция живёт 10 с, а OSRM-демо — публичный сервер проекта OSRM,
// рассчитанный на умеренную нагрузку.
//
// Почему через lib/rate-limiter.ts, а не своя реализация: там уже есть
// распределённый бэкенд (Upstash при REDIS_URL/UPSTASH_*, иначе память
// процесса). Своя реализация на Map в модуле работала бы только в пределах
// одного экземпляра функции — в бессерверной среде это не защита.
//
// Ограничение став organisation+IP, а не только IP: в одной организации
// логист и несколько водителей — легитимная нагрузка, а вот один клиент,
// долбящий эндпоинт в цикле, — нет.

import "server-only"

import { NextResponse } from "next/server"

import { buildRateLimitHeaders, checkRateLimitAsync, getClientIp } from "@/lib/rate-limiter"

/** Лимиты по эндпоинтам: сколько запросов в окно. */
export const ETA_RATE_LIMITS = {
  /** Расчёт прогноза: 30 запросов в минуту на организацию+IP */
  forecast: { max: 30, windowMs: 60_000, blockMs: 60_000 },
  /** Прогноз по рейсу (карта, кабинет): чаще, но тоже ограничено */
  trip: { max: 120, windowMs: 60_000, blockMs: 60_000 },
  /** Запись факта: редкая операция */
  actual: { max: 60, windowMs: 60_000, blockMs: 60_000 },
  /** Метрики: тяжёлая выборка */
  metrics: { max: 30, windowMs: 60_000, blockMs: 60_000 },
} as const

export type EtaRateLimitKind = keyof typeof ETA_RATE_LIMITS

export interface RateLimitDecision {
  allowed: boolean
  response?: NextResponse
}

/**
 * Проверяет частоту запроса. При превышении возвращает готовый 429 —
 * вызывающий код обязан его вернуть, не продолжая работу.
 *
 * organizationId берётся из проверенной сессии (никогда из тела запроса),
 * поэтому подменить его нельзя.
 */
export async function checkEtaRateLimit(
  request: Request,
  kind: EtaRateLimitKind,
  organizationId: string,
): Promise<RateLimitDecision> {
  const limit = ETA_RATE_LIMITS[kind]
  const key = `eta-${kind}:${organizationId}:${getClientIp(request as never)}`
  const result = await checkRateLimitAsync(key, limit)

  if (result.allowed) return { allowed: true }

  return {
    allowed: false,
    response: NextResponse.json(
      {
        error: "Слишком много запросов расчёта. Повторите через минуту",
        code: "rate_limited",
        retryAfterSec: result.retryAfter ?? Math.ceil(limit.windowMs / 1000),
      },
      { status: 429, headers: buildRateLimitHeaders(result) },
    ),
  }
}
