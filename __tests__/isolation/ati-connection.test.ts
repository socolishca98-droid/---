// __tests__/isolation/ati-connection.test.ts
//
// ATI.SU многоарендный: у каждой организации СВОЙ аккаунт, токен и кэш.
// Проверяем:
//   * токен хранится зашифрованным и возвращается только своей организации,
//     у чужой — понятный ati_not_connected (а не чужой токен или 500);
//   * connectionStatus — только метаданные, токена в нём нет никогда;
//   * строки AtiCache и статистика видны только своей организации;
//   * отключение одной организации не трогает другую;
//   * битый шифртекст трактуется как invalid, а не роняет сервер.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import { cid, seedWorld, type World } from "./helpers"

import {
  connectionStatus,
  disconnectAti,
  getActiveAtiToken,
  saveManualToken,
} from "@/lib/ati/connection"
import { decryptSecret } from "@/lib/ati/secrets"
import { getAtiCache, getAtiStats } from "@/lib/ati-client"

let world: World

/** Строка накопленной базы ATI конкретной организации. */
function seedCacheRow(slug: string, organizationId: string, status = "new") {
  const id = cid(slug)
  memoryDb.insert("atiCache", {
    id,
    organizationId,
    atiLoadId: `ati-${slug}`,
    routeFrom: "Москва",
    routeTo: "Казань",
    distance: 800,
    weight: 5000,
    price: 45000,
    status,
    scannedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  })
  return id
}

beforeEach(() => {
  world = seedWorld()
})

// ---------------------------------------------------------------------------
// Подключение (AtiConnection)
// ---------------------------------------------------------------------------

describe("подключение организации к ATI.SU", () => {
  it("токен хранится зашифрованным и работает только у своей организации", async () => {
    await saveManualToken(world.orgA, "ati-token-organization-A")

    const own = await getActiveAtiToken(world.orgA)
    expect(own.ok).toBe(true)
    if (own.ok) expect(own.token).toBe("ati-token-organization-A")

    // в БД — шифртекст v1.<iv>.<tag>.<data>, а не сам токен
    const row = memoryDb.rows("atiConnection").find((r) => r.organizationId === world.orgA)!
    expect(row.tokenEncrypted.startsWith("v1.")).toBe(true)
    expect(row.tokenEncrypted).not.toContain("ati-token-organization-A")
    expect(decryptSecret(row.tokenEncrypted)).toBe("ati-token-organization-A")

    // у чужой организации подключения нет, и токен А не протекает в ответе
    const foreign = await getActiveAtiToken(world.orgB)
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) expect(foreign.code).toBe("ati_not_connected")
    expect(JSON.stringify(foreign)).not.toContain("ati-token-organization-A")
  })

  it("подключение одно на организацию: новый токен заменяет старый", async () => {
    await saveManualToken(world.orgA, "old-token")
    await saveManualToken(world.orgA, "new-token")

    const rows = memoryDb.rows("atiConnection").filter((r) => r.organizationId === world.orgA)
    expect(rows.length).toBe(1)
    expect(rows[0].tokenEncrypted).not.toContain("old-token")

    const active = await getActiveAtiToken(world.orgA)
    expect(active.ok).toBe(true)
    if (active.ok) expect(active.token).toBe("new-token")
  })

  it("статус подключения — метаданные без токена", async () => {
    await saveManualToken(world.orgA, "super-secret-token")

    const statusA = await connectionStatus(world.orgA)
    expect(statusA.connected).toBe(true)
    expect(JSON.stringify(statusA)).not.toContain("super-secret-token")

    const statusB = await connectionStatus(world.orgB)
    expect(statusB.connected).toBe(false)
    expect(statusB.connection).toBeNull()
  })

  it("отключение одной организации не трогает другую", async () => {
    await saveManualToken(world.orgA, "token-A")
    await saveManualToken(world.orgB, "token-B")

    await disconnectAti(world.orgA)

    expect((await getActiveAtiToken(world.orgA)).ok).toBe(false)
    const b = await getActiveAtiToken(world.orgB)
    expect(b.ok).toBe(true)
    if (b.ok) expect(b.token).toBe("token-B")
  })

  it("битый шифртекст — invalid, а не падение", async () => {
    const id = await saveManualToken(world.orgA, "token-A")
    const row = memoryDb.find("atiConnection", (r) => r.id === id)!
    row.tokenEncrypted = "мусор.вместо.шифртекста"

    const result = await getActiveAtiToken(world.orgA)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("invalid")
    expect(JSON.stringify(result)).not.toContain("token-A")
  })
})

// ---------------------------------------------------------------------------
// Накопленная база (AtiCache) — своя у каждой организации
// ---------------------------------------------------------------------------

describe("кэш ATI у каждой организации свой", () => {
  it("строки и статистика видны только своей организации", async () => {
    seedCacheRow("a1", world.orgA)
    seedCacheRow("a2", world.orgA, "expired")
    const bRow = seedCacheRow("b1", world.orgB)

    const cacheA = await getAtiCache({ organizationId: world.orgA })
    expect(cacheA.total).toBe(1) // статус по умолчанию — только «new»
    expect(cacheA.items.every((item: any) => item.organizationId === world.orgA)).toBe(true)

    const statsA = await getAtiStats(world.orgA)
    expect(statsA.total).toBe(2)
    expect(statsA.new).toBe(1)
    expect(statsA.expired).toBe(1)

    const statsB = await getAtiStats(world.orgB)
    expect(statsB.total).toBe(1)

    const cacheB = await getAtiCache({ organizationId: world.orgB })
    expect(cacheB.items.map((item: any) => item.id)).toEqual([bRow])
  })

  it("без своих строк база и статистика пустые — чужие не всплывают", async () => {
    seedCacheRow("b1", world.orgB)

    const cacheA = await getAtiCache({ organizationId: world.orgA })
    expect(cacheA.total).toBe(0)
    expect(cacheA.items.length).toBe(0)

    const statsA = await getAtiStats(world.orgA)
    expect(statsA.total).toBe(0)
    expect(statsA.new).toBe(0)
  })
})
