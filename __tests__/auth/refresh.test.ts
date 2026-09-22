import { describe, it, expect, beforeEach } from "vitest"
import { createRefreshEntry, getRefreshEntry, revokeRefreshToken, rotateRefreshToken, generateJti } from "@/lib/refresh-tokens"

describe("refresh token rotation P1-5", () => {
  it("creates and retrieves entry", () => {
    const jti = generateJti()
    createRefreshEntry({ jti, userId: "user1", role: "admin", expiresInMs: 60000 })
    const entry = getRefreshEntry(jti)
    expect(entry).toBeDefined()
    expect(entry?.userId).toBe("user1")
  })

  it("revokes token", () => {
    const jti = generateJti()
    createRefreshEntry({ jti, userId: "user2", role: "admin", expiresInMs: 60000 })
    revokeRefreshToken(jti)
    expect(getRefreshEntry(jti)).toBeNull()
  })

  it("rotates invalidates old", () => {
    const oldJti = generateJti()
    const newJti = generateJti()
    createRefreshEntry({ jti: oldJti, userId: "user3", role: "driver", expiresInMs: 60000 })
    const rotated = rotateRefreshToken(oldJti, newJti, 60000)
    expect(rotated).not.toBeNull()
    expect(getRefreshEntry(oldJti)).toBeNull()
    expect(getRefreshEntry(newJti)).toBeDefined()
  })

  it("generates unique jti", () => {
    const j1 = generateJti()
    const j2 = generateJti()
    expect(j1).not.toBe(j2)
    expect(j1.length).toBe(32) // 16 bytes hex
  })
})
