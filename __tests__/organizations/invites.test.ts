// __tests__/organizations/invites.test.ts
//
// Чистые функции инвайт-кодов и названий организаций — без базы данных,
// поэтому тесты запускаются где угодно: npm run test:vitest

import { describe, expect, it } from "vitest"

import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  describeInvite,
  evaluateInvite,
  formatInviteCode,
  generateInviteCode,
  inviteStatus,
  inviteUsesLeft,
  normalizeInviteCode,
  type InviteRecord,
} from "@/lib/invites"
import { checkOrganizationName, normalizeOrganizationName } from "@/lib/organizations"

const NOW = new Date("2026-09-23T12:00:00.000Z")

function invite(overrides: Partial<InviteRecord> = {}): InviteRecord {
  return {
    id: "invite_1",
    code: "ABCD2345EFGH",
    role: "logist",
    organizationId: "org_1",
    createdById: "user_admin",
    expiresAt: null,
    maxUses: null,
    usedCount: 0,
    revokedAt: null,
    createdAt: NOW.toISOString(),
    ...overrides,
  }
}

describe("normalizeInviteCode", () => {
  it("приводит к верхнему регистру и убирает разделители", () => {
    expect(normalizeInviteCode("abcd-2345-efgh")).toBe("ABCD2345EFGH")
    expect(normalizeInviteCode("  abcd 2345 efgh ")).toBe("ABCD2345EFGH")
    expect(normalizeInviteCode("ABCD_2345.EFGH")).toBe("ABCD2345EFGH")
  })

  it("отклоняет код неверной длины", () => {
    expect(normalizeInviteCode("ABC")).toBe("")
    expect(normalizeInviteCode("ABCD2345EFGHK")).toBe("")
    expect(normalizeInviteCode("")).toBe("")
    expect(normalizeInviteCode(null)).toBe("")
    expect(normalizeInviteCode(undefined)).toBe("")
  })

  it("отклоняет символы вне алфавита (включая похожие 0, 1, I, O)", () => {
    expect(normalizeInviteCode("ABCD2345EFG0")).toBe("")
    expect(normalizeInviteCode("ABCD2345EFGI")).toBe("")
    expect(normalizeInviteCode("ABCD2345EFGO")).toBe("")
    expect(normalizeInviteCode("ABCD2345EFG!")).toBe("")
    for (const char of "01IO") {
      expect(INVITE_CODE_ALPHABET).not.toContain(char)
    }
  })
})

describe("generateInviteCode", () => {
  it("даёт код нужной длины только из символов алфавита", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode()
      expect(code).toHaveLength(INVITE_CODE_LENGTH)
      for (const char of code) {
        expect(INVITE_CODE_ALPHABET).toContain(char)
      }
    }
  })

  it("коды не повторяются", () => {
    const codes = new Set<string>()
    for (let i = 0; i < 2000; i++) codes.add(generateInviteCode())
    expect(codes.size).toBe(2000)
  })

  it("детерминирован при явных байтах (для тестов)", () => {
    const bytes = new Uint8Array(INVITE_CODE_LENGTH).fill(0)
    expect(generateInviteCode(bytes)).toBe(
      INVITE_CODE_ALPHABET[0].repeat(INVITE_CODE_LENGTH),
    )
  })

  it("сгенерированный код проходит нормализацию", () => {
    expect(normalizeInviteCode(generateInviteCode())).toHaveLength(INVITE_CODE_LENGTH)
  })
})

describe("formatInviteCode", () => {
  it("группирует по четыре символа", () => {
    expect(formatInviteCode("ABCD2345EFGH")).toBe("ABCD-2345-EFGH")
    expect(formatInviteCode("abcd2345efgh")).toBe("ABCD-2345-EFGH")
  })

  it("принимает уже разделённый код", () => {
    expect(formatInviteCode("ABCD-2345-EFGH")).toBe("ABCD-2345-EFGH")
  })
})

describe("evaluateInvite", () => {
  it("действующий код без срока и лимита проходит", () => {
    expect(evaluateInvite(invite(), NOW)).toEqual({ ok: true })
  })

  it("отозванный код отклоняется", () => {
    const result = evaluateInvite(invite({ revokedAt: new Date(NOW.getTime() - 1000) }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("revoked")
  })

  it("просроченный код отклоняется, включая границу «истёк ровно сейчас»", () => {
    const past = evaluateInvite(invite({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)
    expect(past.ok).toBe(false)
    if (!past.ok) expect(past.reason).toBe("expired")

    const boundary = evaluateInvite(invite({ expiresAt: NOW }), NOW)
    expect(boundary.ok).toBe(false)

    const future = evaluateInvite(invite({ expiresAt: new Date(NOW.getTime() + 1000) }), NOW)
    expect(future.ok).toBe(true)
  })

  it("исчерпанный лимит отклоняется, а null означает «без лимита»", () => {
    const exhausted = evaluateInvite(invite({ maxUses: 3, usedCount: 3 }), NOW)
    expect(exhausted.ok).toBe(false)
    if (!exhausted.ok) expect(exhausted.reason).toBe("exhausted")

    expect(evaluateInvite(invite({ maxUses: 3, usedCount: 2 }), NOW).ok).toBe(true)
    expect(evaluateInvite(invite({ maxUses: null, usedCount: 500 }), NOW).ok).toBe(true)
  })

  it("отзыв важнее срока и лимита", () => {
    const result = evaluateInvite(
      invite({ revokedAt: NOW, expiresAt: new Date(NOW.getTime() + 100000), maxUses: 5, usedCount: 1 }),
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("revoked")
  })

  it("понимает строковые даты из БД", () => {
    const result = evaluateInvite(invite({ expiresAt: "2020-01-01T00:00:00.000Z" }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("expired")
  })

  it("сообщение об отказе непустое и не раскрывает название организации", () => {
    const result = evaluateInvite(invite({ revokedAt: NOW }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(10)
      expect(result.message).not.toMatch(/ИП|ООО/)
    }
  })
})

describe("inviteStatus и inviteUsesLeft", () => {
  it("статусы соответствуют причинам отказа", () => {
    expect(inviteStatus(invite(), NOW)).toBe("active")
    expect(inviteStatus(invite({ revokedAt: NOW }), NOW)).toBe("revoked")
    expect(inviteStatus(invite({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe("expired")
    expect(inviteStatus(invite({ maxUses: 1, usedCount: 1 }), NOW)).toBe("exhausted")
  })

  it("остаток использований", () => {
    expect(inviteUsesLeft({ maxUses: null, usedCount: 7 })).toBeNull()
    expect(inviteUsesLeft({ maxUses: 5, usedCount: 2 })).toBe(3)
    expect(inviteUsesLeft({ maxUses: 5, usedCount: 9 })).toBe(0)
  })
})

describe("describeInvite", () => {
  it("отдаёт код в читаемом виде и ISO-даты", () => {
    const view = describeInvite(
      invite({
        code: "ABCD2345EFGH",
        expiresAt: new Date("2026-10-01T00:00:00.000Z"),
        maxUses: 10,
        usedCount: 4,
        _count: { users: 4 },
      }),
      NOW,
    )

    expect(view.code).toBe("ABCD-2345-EFGH")
    expect(view.expiresAt).toBe("2026-10-01T00:00:00.000Z")
    expect(view.usesLeft).toBe(6)
    expect(view.registeredUsers).toBe(4)
    expect(view.status).toBe("active")
  })
})

describe("название организации", () => {
  it("приводит регистр и пробелы", () => {
    expect(normalizeOrganizationName("  ООО   Ромашка ")).toBe("ооо ромашка")
    expect(normalizeOrganizationName("ИП Фролов Иван Александрович")).toBe(
      "ип фролов иван александрович",
    )
  })

  it("проверка возвращает имя и ключ", () => {
    const result = checkOrganizationName("  ООО   Ромашка ")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe("ООО Ромашка")
      expect(result.nameKey).toBe("ооо ромашка")
    }
  })

  it("слишком короткое или длинное название отклоняется", () => {
    expect(checkOrganizationName("Ы").ok).toBe(false)
    expect(checkOrganizationName("   ").ok).toBe(false)
    expect(checkOrganizationName("").ok).toBe(false)
    expect(checkOrganizationName(null).ok).toBe(false)
    expect(checkOrganizationName("Ы".repeat(121)).ok).toBe(false)
    expect(checkOrganizationName("Ы".repeat(120)).ok).toBe(true)
  })
})
