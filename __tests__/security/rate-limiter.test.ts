import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildRateLimitHeaders,
  checkRateLimit,
  checkRateLimitAsync,
  rateLimitBackend,
  recordFailure,
  recordFailureAsync,
  resetRateLimit,
  resetRateLimitAsync,
} from "@/lib/rate-limiter"

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

// ---------------------------------------------------------------------------
// Общий счётчик в Redis (Upstash): нужен, когда приложение работает на
// serverless — счётчик в памяти одного инстанса перебор паролей не остановит.
// ---------------------------------------------------------------------------

const UPSTASH_ENV = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "RATE_LIMIT_DRIVER",
] as const

let savedUpstashEnv: Record<string, string | undefined>

/** Включает режим Upstash и перехватывает запросы к нему. */
function useUpstash(results: unknown[] = []) {
  process.env.UPSTASH_REDIS_REST_URL = "https://loginex.upstash.io"
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
  delete process.env.RATE_LIMIT_DRIVER

  const calls: { url: string; body: unknown; authorization: string | null }[] = []
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit)
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      authorization: headers.get("authorization"),
    })
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: results.length > 1 ? results.shift() : results[0] }),
    } as Response
  })
  return calls
}

beforeEach(() => {
  savedUpstashEnv = Object.fromEntries(UPSTASH_ENV.map((key) => [key, process.env[key]]))
})

afterEach(() => {
  for (const key of UPSTASH_ENV) {
    if (savedUpstashEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedUpstashEnv[key]
  }
  vi.unstubAllGlobals()
})

describe("rate limiter: выбор режима", () => {
  it("по умолчанию считает в памяти процесса", () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    delete process.env.RATE_LIMIT_DRIVER
    expect(rateLimitBackend()).toBe("memory")
  })

  it("включает Upstash, когда заданы ключи", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://loginex.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
    expect(rateLimitBackend()).toBe("upstash")
  })

  it("RATE_LIMIT_DRIVER=memory принудительно возвращает память", () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://loginex.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
    process.env.RATE_LIMIT_DRIVER = "memory"
    expect(rateLimitBackend()).toBe("memory")
  })
})

describe("rate limiter: общий счётчик в Redis", () => {
  it("проверка уходит одним атомарным EVAL с нашими параметрами", async () => {
    const calls = useUpstash([[1, 0, 1899999999999, 2]])

    const result = await checkRateLimitAsync("login:1.2.3.4:79161234501")

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://loginex.upstash.io")
    expect(calls[0].authorization).toBe("Bearer test-token")
    const command = calls[0].body as unknown[]
    expect(command[0]).toBe("EVAL")
    expect(command[2]).toBe("1")
    expect(command[3]).toBe("login:1.2.3.4:79161234501")
    // окно 15 минут, блокировка 15 минут, пять попыток, проверка без засчитывания
    expect(Number(command[4])).toBeGreaterThan(1_700_000_000_000)
    expect(command.slice(5)).toEqual(["900000", "900000", "5", "0"])

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(3)
    expect(result.currentCount).toBe(2)
  })

  it("неудачная попытка засчитывается, блокировка отдаёт паузу", async () => {
    useUpstash([[0, 900, 1899999999999, 5]])

    const result = await recordFailureAsync("login:1.2.3.4:79161234501")

    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBe(900)
    expect(result.remaining).toBe(0)
  })

  it("сценарий на стороне Redis засчитывает попытку", async () => {
    const calls = useUpstash([[1, 0, 1899999999999, 1]])
    await recordFailureAsync("login:1.2.3.4:79161234501")
    expect((calls[0].body as unknown[])[8]).toBe("1")
  })

  it("сброс удаляет ключ", async () => {
    const calls = useUpstash(["OK"])
    await resetRateLimitAsync("login:1.2.3.4:79161234501")
    expect(calls[0].body).toEqual(["DEL", "login:1.2.3.4:79161234501"])
  })

  it("Redis недоступен — лимитер не отказывает всем, а считает в памяти", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://loginex.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
    vi.stubGlobal("fetch", async () => {
      throw new Error("сеть недоступна")
    })

    const key = "login:fallback:test"
    resetRateLimit(key)

    const first = await checkRateLimitAsync(key)
    expect(first.allowed).toBe(true)

    // попытка всё равно засчитана — в памяти процесса
    const afterFailure = await recordFailureAsync(key)
    expect(afterFailure.allowed).toBe(true)
    expect(afterFailure.currentCount).toBe(1)
    expect(checkRateLimit(key).currentCount).toBe(1)
  })
})
