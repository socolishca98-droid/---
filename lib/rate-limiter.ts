// lib/rate-limiter.ts - In-memory rate limiter for auth endpoints (P1-2)
// Simple implementation suitable for single-instance SQLite deployment.
// For multi-instance, replace with Redis.

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
