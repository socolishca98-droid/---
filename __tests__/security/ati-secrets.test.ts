// __tests__/security/ati-secrets.test.ts
//
// Шифрование токенов ATI.SU (lib/ati/secrets.ts): AES-256-GCM, ключ —
// SHA-256 от AUTH_SECRET. Токен организации — доступ к ЕЁ аккаунту на бирже,
// поэтому проверяем не только «шифрует/расшифровывает», но и стойкость:
// свежий IV на каждый секрет, подмена данных и чужой ключ → null.

import { beforeEach, describe, expect, it } from "vitest"

import { decryptSecret, encryptSecret } from "@/lib/ati/secrets"

const SECRET = "unit-tests-auth-secret-0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET
})

describe("шифрование секретов ATI", () => {
  it("раундтрип: что зашифровали, то и расшифровали", () => {
    const token = "ati-access-token-1234567890"
    const encrypted = encryptSecret(token)
    expect(encrypted).not.toContain(token)
    expect(encrypted.startsWith("v1.")).toBe(true)
    expect(decryptSecret(encrypted)).toBe(token)
  })

  it("одинаковый текст даёт разные шифртексты (свежий IV)", () => {
    const token = "same-token"
    const first = encryptSecret(token)
    const second = encryptSecret(token)
    expect(first).not.toBe(second)
    expect(decryptSecret(first)).toBe(token)
    expect(decryptSecret(second)).toBe(token)
  })

  it("подмена любого фрагмента — null, а не исключение", () => {
    const encrypted = encryptSecret("token-podmena")
    const parts = encrypted.split(".")

    for (const index of [1, 2, 3]) {
      const tampered = [...parts]
      tampered[index] = Buffer.from("подмена").toString("base64")
      expect(decryptSecret(tampered.join("."))).toBeNull()
    }
  })

  it("мусор и чужой формат — null", () => {
    expect(decryptSecret(null)).toBeNull()
    expect(decryptSecret(undefined)).toBeNull()
    expect(decryptSecret("")).toBeNull()
    expect(decryptSecret("просто-токен-без-шифрования")).toBeNull()
    expect(decryptSecret("v2.aGVsbG8=.aGVsbG8=.aGVsbG8=")).toBeNull()
  })

  it("чужой AUTH_SECRET не расшифровывает", () => {
    const encrypted = encryptSecret("token-organizacii")
    process.env.AUTH_SECRET = "sovershenno-drugoy-secret-0123456789abcdef0123456789ab"
    expect(decryptSecret(encrypted)).toBeNull()
  })

  it("пустое значение не шифруется", () => {
    expect(() => encryptSecret("")).toThrow()
  })
})
