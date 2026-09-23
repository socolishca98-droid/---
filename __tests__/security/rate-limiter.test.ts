import { describe, it, expect, beforeEach } from "vitest"
import { checkRateLimit, recordFailure, resetRateLimit, buildRateLimitHeaders } from "@/lib/rate-limiter"

describe("rate limiter P1-2", () => {
  const key = "test:127.0.0.1:test@example.com"

  beforeEach(() => {
    resetRateLimit(key)
  })

  it("allows first requests", () => {
    const res = checkRateLimit(key)
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBeGreaterThanOrEqual(0)
  })

  it("blocks after 5 failures", () => {
    for (let i = 0; i < 5; i++) {
      recordFailure(key)
    }
    const res = checkRateLimit(key)
    expect(res.allowed).toBe(false)
    expect(res.retryAfter).toBeGreaterThan(0)
  })

  it("reset clears block", () => {
    for (let i = 0; i < 5; i++) recordFailure(key)
    expect(checkRateLimit(key).allowed).toBe(false)
    resetRateLimit(key)
    expect(checkRateLimit(key).allowed).toBe(true)
  })

  it("builds headers", () => {
    const result = checkRateLimit(key)
    const headers = buildRateLimitHeaders(result)
    expect(headers["X-RateLimit-Limit"]).toBe("5")
    expect(headers["X-RateLimit-Remaining"]).toBeDefined()
  })

  it("6th request -> 429 scenario", () => {
    // simulate 5 failures then check 6th
    for (let i = 0; i < 5; i++) recordFailure(key)
    const sixth = checkRateLimit(key)
    expect(sixth.allowed).toBe(false)
    // would be 429 in API
    expect(sixth.retryAfter).toBeGreaterThan(800) // ~900 sec
  })
})
