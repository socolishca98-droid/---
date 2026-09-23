import { describe, it, expect } from "vitest"
import { loginSchema, registerSchema, driverLoginSchema } from "@/lib/validators"

describe("auth validators P1-6", () => {
  it("loginSchema rejects invalid email", () => {
    const res = loginSchema.safeParse({ email: "bad", password: "123" })
    expect(res.success).toBe(false)
  })

  it("loginSchema accepts valid", () => {
    const res = loginSchema.safeParse({ email: "test@example.com", password: "secret123" })
    expect(res.success).toBe(true)
  })

  it("loginSchema rejects empty password", () => {
    const res = loginSchema.safeParse({ email: "test@example.com", password: "" })
    expect(res.success).toBe(false)
  })

  it("registerSchema requires min 8 password", () => {
    const res = registerSchema.safeParse({ email: "a@b.com", password: "short", name: "Test" })
    expect(res.success).toBe(false)
  })

  it("registerSchema accepts valid", () => {
    const res = registerSchema.safeParse({ email: "a@b.com", password: "longpassword123", name: "Test" })
    expect(res.success).toBe(true)
  })

  it("driverLoginSchema requires phone and org", () => {
    const res = driverLoginSchema.safeParse({ phone: "", organization: "" })
    expect(res.success).toBe(false)
  })

  it("driverLoginSchema accepts valid", () => {
    const res = driverLoginSchema.safeParse({ phone: "+79161234567", organization: "TestOrg" })
    expect(res.success).toBe(true)
  })
})
