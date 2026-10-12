// lib/rate-limiter.ts - Ограничение попыток входа для auth-эндпоинтов (P1-2)
//
// Два режима, переключаются переменными окружения:
//
//   memory (по умолчанию) — счётчики в памяти процесса. Работает на одном
//   сервере и в Docker, ничего настраивать не нужно.
//
//   upstash — счётчики в Redis (Upstash, REST API). Нужен для serverless
//   (Vercel): там каждый запрос может приехать на другой инстанс, и счётчик
//   в памяти одного процесса защиты не даёт — перебор паролей продолжается.
//   Включается сам, если заданы UPSTASH_REDIS_REST_URL и
//   UPSTASH_REDIS_REST_TOKEN; явно — RATE_LIMIT_DRIVER=upstash.
//
// Синхронные функции (checkRateLimit/recordFailure/resetRateLimit) остались
// прежними — их используют локальные проверки и тесты. В маршрутах нужно
// вызывать ...Async-версии: они работают с общим счётчиком, когда он настроен,
// и молча переходят на память, когда нет.
//
// Если Redis не ответил (сеть, лимиты), лимитер не отказывает всем подряд:
// он переходит на память процесса — защита слабее, но вход не блокируется.

import type { NextRequest } from "next/server"

const WINDOW_MS = 15 * 60 * 1000 // 15 min window
const MAX_ATTEMPTS = 5
const BLOCK_MS = 15 * 60 * 1000 // block for 15 min after exceeding

type Entry = {
  count: number
  firstAttempt: number
  blockedUntil?: number
}

const store = new Map<string, Entry>()

function now(): number {
  return Date.now()
}

function cleanupIfNeeded(): void {
  if (store.size < 1000) return
  const n = now()
  for (const [k, v] of store.entries()) {
    const expired =
      (v.blockedUntil ? v.blockedUntil < n : false) ||
      n - v.firstAttempt > WINDOW_MS * 2
    if (expired) store.delete(k)
  }
  // If still too large, clear oldest half
  if (store.size > 2000) {
    const keys = Array.from(store.keys()).slice(0, 1000)
    for (const k of keys) store.delete(k)
  }
}

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    // first ip is client
    return xff.split(",")[0]?.trim() || "unknown"
  }
  const realIp = req.headers.get("x-real-ip")
  if (realIp) return realIp.trim()
  // NextRequest doesn't have ip directly, fallback
  return "unknown"
}

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: number // timestamp ms when window resets
  retryAfter?: number // seconds
  currentCount: number
}

export function checkRateLimit(key: string): RateLimitResult {
  cleanupIfNeeded()
  const n = now()
  const entry = store.get(key)

  if (!entry) {
    return {
      allowed: true,
      remaining: MAX_ATTEMPTS,
      resetAt: n + WINDOW_MS,
      currentCount: 0,
    }
  }

  // If blocked
  if (entry.blockedUntil && entry.blockedUntil > n) {
    const retryAfter = Math.ceil((entry.blockedUntil - n) / 1000)
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.blockedUntil,
      retryAfter,
      currentCount: entry.count,
    }
  }

  // If window expired, reset
  if (n - entry.firstAttempt > WINDOW_MS) {
    // treat as new window
    store.delete(key)
    return {
      allowed: true,
      remaining: MAX_ATTEMPTS,
      resetAt: n + WINDOW_MS,
      currentCount: 0,
    }
  }

  // Within window
  if (entry.count >= MAX_ATTEMPTS) {
    // Exceeded, block now
    entry.blockedUntil = n + BLOCK_MS
    store.set(key, entry)
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.blockedUntil,
      retryAfter: Math.ceil(BLOCK_MS / 1000),
      currentCount: entry.count,
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, MAX_ATTEMPTS - entry.count),
    resetAt: entry.firstAttempt + WINDOW_MS,
    currentCount: entry.count,
  }
}

export function recordFailure(key: string): RateLimitResult {
  const n = now()
  const existing = store.get(key)

  if (!existing || n - existing.firstAttempt > WINDOW_MS) {
    // new window
    const entry: Entry = { count: 1, firstAttempt: n }
    store.set(key, entry)
    return {
      allowed: true,
      remaining: MAX_ATTEMPTS - 1,
      resetAt: n + WINDOW_MS,
      currentCount: 1,
    }
  }

  existing.count += 1
  if (existing.count >= MAX_ATTEMPTS) {
    existing.blockedUntil = n + BLOCK_MS
  }
  store.set(key, existing)

  const isBlocked = existing.count >= MAX_ATTEMPTS
  return {
    allowed: !isBlocked,
    remaining: Math.max(0, MAX_ATTEMPTS - existing.count),
    resetAt: existing.blockedUntil ?? existing.firstAttempt + WINDOW_MS,
    retryAfter: isBlocked ? Math.ceil(BLOCK_MS / 1000) : undefined,
    currentCount: existing.count,
  }
}

export function resetRateLimit(key: string): void {
  store.delete(key)
}

export function buildRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(MAX_ATTEMPTS),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  }
  if (result.retryAfter) {
    headers["Retry-After"] = String(result.retryAfter)
  }
  return headers
}

// Helper for testing / debugging (not exported to API)
export function _getStoreSize(): number {
  return store.size
}

export const RATE_LIMIT_CONFIG = {
  WINDOW_MS,
  MAX_ATTEMPTS,
  BLOCK_MS,
}


// ---------------------------------------------------------------------------
// Общий счётчик в Redis (Upstash) — для serverless и нескольких инстансов
// ---------------------------------------------------------------------------

/** Какой режим работает сейчас. */
export type RateLimitBackend = "memory" | "upstash"

/**
 * Lua-сценарий: одна атомарная операция «проверить и засчитать».
 *
 * Возвращает [разрешено (1/0), пауза в секундах, когда сбрасывается окно,
 * сколько попыток в окне]. Атомарность важна: без неё десяток параллельных
 * запросов прочитали бы один и тот же счётчик и все прошли бы до блокировки.
 */
export const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local blockMs = tonumber(ARGV[3])
local maxAttempts = tonumber(ARGV[4])
local shouldCount = tonumber(ARGV[5]) == 1

local count = tonumber(redis.call('HGET', key, 'count')) or 0
local firstAttempt = tonumber(redis.call('HGET', key, 'firstAttempt')) or now
local blockedUntil = tonumber(redis.call('HGET', key, 'blockedUntil')) or 0

if blockedUntil > now then
  return {0, math.ceil((blockedUntil - now) / 1000), blockedUntil, count}
end

if count > 0 and now - firstAttempt > windowMs then
  count = 0
  firstAttempt = now
end

if shouldCount then
  count = count + 1
end

local blocked = 0
if count >= maxAttempts then
  blocked = now + blockMs
end

if shouldCount or blocked > now then
  redis.call('HSET', key, 'count', count, 'firstAttempt', firstAttempt, 'blockedUntil', blocked)
  redis.call('PEXPIRE', key, windowMs + blockMs)
end

local retryAfter = 0
local allowed = 1
if blocked > now then
  retryAfter = math.ceil((blocked - now) / 1000)
  allowed = 0
end
return {allowed, retryAfter, firstAttempt + windowMs, count}
`

function upstashConfig(): { url: string; token: string } | null {
  const url = String(process.env.UPSTASH_REDIS_REST_URL ?? "").trim().replace(/\/+$/, "")
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim()
  if (!url || !token) return null
  return { url, token }
}

/** Режим лимитера: upstash, если он явно включён или ключи заданы. */
export function rateLimitBackend(): RateLimitBackend {
  const driver = String(process.env.RATE_LIMIT_DRIVER ?? "").trim().toLowerCase()
  if (driver === "memory") return "memory"
  if (driver === "upstash" || upstashConfig()) return "upstash"
  return "memory"
}

/** Команда к Upstash REST API. Возвращает result или бросает ошибку. */
async function upstashCommand(command: (string | number)[]): Promise<unknown> {
  const config = upstashConfig()
  if (!config) throw new Error("Upstash не настроен: нужны UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN")

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Upstash ответил ${response.status}`)
  }

  const payload = (await response.json()) as { result?: unknown; error?: string }
  if (payload.error) throw new Error(`Upstash: ${payload.error}`)
  return payload.result
}

/** Разбор ответа сценария в наш формат. */
function toRateLimitResult(raw: unknown): RateLimitResult {
  const [allowedFlag, retryAfter, resetAt, count] = Array.isArray(raw) ? raw : []
  const attempts = Number(count) || 0
  const retryAfterSeconds = Number(retryAfter) || 0
  return {
    allowed: Number(allowedFlag) === 1,
    remaining: Math.max(0, MAX_ATTEMPTS - attempts),
    resetAt: Number(resetAt) || Date.now() + WINDOW_MS,
    retryAfter: retryAfterSeconds > 0 ? retryAfterSeconds : undefined,
    currentCount: attempts,
  }
}

async function upstashHit(key: string, shouldCount: boolean): Promise<RateLimitResult> {
  const result = await upstashCommand([
    "EVAL",
    RATE_LIMIT_SCRIPT,
    "1",
    key,
    String(Date.now()),
    String(WINDOW_MS),
    String(BLOCK_MS),
    String(MAX_ATTEMPTS),
    shouldCount ? "1" : "0",
  ])
  return toRateLimitResult(result)
}

/** Лог одной строкой: сбой общего счётчика не должен ронять вход. */
function logBackendFallback(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[rate-limiter] ${action}: общий счётчик недоступен (${message}), считаю в памяти процесса`)
}

/**
 * Проверка без засчитывания. В маршрутах вызывать перед попыткой входа.
 * С общим счётчиком — атомарно, иначе — в памяти процесса.
 */
export async function checkRateLimitAsync(key: string): Promise<RateLimitResult> {
  if (rateLimitBackend() === "upstash") {
    try {
      return await upstashHit(key, false)
    } catch (error) {
      logBackendFallback("проверка", error)
    }
  }
  return checkRateLimit(key)
}

/** Засчитать неудачную попытку. Блокирует, когда попыток слишком много. */
export async function recordFailureAsync(key: string): Promise<RateLimitResult> {
  if (rateLimitBackend() === "upstash") {
    try {
      return await upstashHit(key, true)
    } catch (error) {
      logBackendFallback("неудачная попытка", error)
    }
  }
  return recordFailure(key)
}

/** Сбросить счётчик (после успешного входа). */
export async function resetRateLimitAsync(key: string): Promise<void> {
  if (rateLimitBackend() === "upstash") {
    try {
      await upstashCommand(["DEL", key])
      return
    } catch (error) {
      logBackendFallback("сброс", error)
    }
  }
  resetRateLimit(key)
}
