import { describe, it, expect } from "vitest"
import { generateCsrfToken, verifyCsrf } from "@/lib/csrf"

describe("CSRF P1-3", () => {
  it("generates token", () => {
    const token = generateCsrfToken()
    expect(token.length).toBe(64) // 32 bytes hex
  })

  it("generates unique tokens", () => {
    const t1 = generateCsrfToken()
    const t2 = generateCsrfToken()
    expect(t1).not.toBe(t2)
  })

  it("verifies valid token", () => {
    const token = generateCsrfToken()
    // mock request with cookie and header
    const req = {
      cookies: { get: (name: string) => (name === "loginex_csrf" ? { value: token } : undefined) },
      headers: { get: (name: string) => (name.toLowerCase() === "x-csrf-token" ? token : null) },
    } as any
    const res = verifyCsrf(req)
    expect(res.valid).toBe(true)
  })

  it("fails when missing", () => {
    const req = {
      cookies: { get: () => undefined },
      headers: { get: () => null },
    } as any
    const res = verifyCsrf(req)
    expect(res.valid).toBe(false)
  })

  it("fails when mismatch", () => {
    const token1 = generateCsrfToken()
    const token2 = generateCsrfToken()
    const req = {
      cookies: { get: () => ({ value: token1 }) },
      headers: { get: () => token2 },
    } as any
    const res = verifyCsrf(req)
    expect(res.valid).toBe(false)
  })
})
