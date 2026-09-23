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

  it("registerSchema требует пароль не короче 8 символов", () => {
    const res = registerSchema.safeParse({
      email: "a@b.com",
      password: "short",
      name: "Test User",
      organizationName: "ООО Ромашка",
    })
    expect(res.success).toBe(false)
  })

  it("registerSchema принимает сценарий «своя организация»", () => {
    const res = registerSchema.safeParse({
      email: "A@B.com ",
      password: "longpassword123",
      name: " Test User ",
      organizationName: "  ООО   Ромашка ",
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.email).toBe("a@b.com")
      expect(res.data.name).toBe("Test User")
      expect(res.data.organizationName).toBe("ООО Ромашка")
    }
  })

  it("registerSchema принимает сценарий «по коду приглашения»", () => {
    const res = registerSchema.safeParse({
      email: "a@b.com",
      password: "longpassword123",
      name: "Test User",
      inviteCode: "ABCD-2345-EFGH",
    })
    expect(res.success).toBe(true)
  })

  it("registerSchema отклоняет оба сценария сразу и ни одного", () => {
    const both = registerSchema.safeParse({
      email: "a@b.com",
      password: "longpassword123",
      name: "Test User",
      organizationName: "ООО Ромашка",
      inviteCode: "ABCD2345EFGH",
    })
    expect(both.success).toBe(false)

    const none = registerSchema.safeParse({
      email: "a@b.com",
      password: "longpassword123",
      name: "Test User",
    })
    expect(none.success).toBe(false)
  })

  it("driverLoginSchema требует телефон и пароль", () => {
    expect(driverLoginSchema.safeParse({ phone: "", password: "" }).success).toBe(false)
    expect(driverLoginSchema.safeParse({ phone: "+79161234567" }).success).toBe(false)
  })

  it("driverLoginSchema принимает телефон с паролем", () => {
    const res = driverLoginSchema.safeParse({ phone: "+7 916 123-45-67", password: "secret123" })
    expect(res.success).toBe(true)
  })
})
