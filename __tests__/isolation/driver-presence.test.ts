// __tests__/isolation/driver-presence.test.ts
//
// «N водителей на связи» на карте должно считаться по последней GPS-точке и
// быть проверяемым: вместе со счётчиком эндпоинт отдаёт саму метку, её возраст
// и флаг по каждому водителю.
//
// Всё через настоящий роут GET /api/drivers/locations с настоящей сессией;
// единственная заглушка — in-memory база вместо Prisma.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import {
  cid,
  expectNoForeignIds,
  jsonOf,
  makeRequest,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

import { GET as driversLocationsGet } from "@/app/api/drivers/locations/route"

let world: World
let cookieA: string

/** Водитель с последней GPS-точкой в заданном возрасте (минуты; null — точки нет). */
function seedDriver(slug: string, organizationId: string, ageMinutes: number | null): string {
  const id = cid(slug)
  memoryDb.insert("driver", {
    id,
    organizationId,
    name: `Водитель ${slug}`,
    phone: `+7900${String(Math.abs(id.length) + slug.length).padStart(7, "0")}`,
    status: "available",
    latitude: 55.75,
    longitude: 37.62,
    lastGpsUpdate: ageMinutes === null ? null : new Date(Date.now() - ageMinutes * 60 * 1000),
  })
  return id
}

beforeEach(async () => {
  world = seedWorld()
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
})

async function locations() {
  const response = await driversLocationsGet(makeRequest("GET", "/api/drivers/locations", { cookie: cookieA }))
  expect(response.status).toBe(200)
  return jsonOf(response)
}

describe("GET /api/drivers/locations — присутствие по GPS-точке", () => {
  it("свежая точка — на связи, протухшая — нет, и это видно по каждому водителю", async () => {
    const fresh = seedDriver("pres-fresh", world.orgA, 2)
    const stale = seedDriver("pres-stale", world.orgA, 120)
    const never = seedDriver("pres-never", world.orgA, null)

    const payload = await locations()
    const byId = new Map<string, any>(
      payload.drivers.map((driver: any) => [driver.id, driver] as [string, any]),
    )

    expect(byId.get(fresh).online).toBe(true)
    expect(byId.get(fresh).gpsAgeSec).toBeGreaterThanOrEqual(110)
    expect(byId.get(fresh).gpsAgeSec).toBeLessThanOrEqual(130)
    expect(byId.get(fresh).lastGpsUpdate).toBeTruthy()

    expect(byId.get(stale).online).toBe(false)
    expect(byId.get(stale).gpsAgeSec).toBeGreaterThanOrEqual(7100)

    expect(byId.get(never).online).toBe(false)
    expect(byId.get(never).gpsAgeSec).toBeNull()
    expect(byId.get(never).lastGpsUpdate).toBeNull()
  })

  it("счётчик «на связи» совпадает с флагами водителей", async () => {
    seedDriver("count-fresh-1", world.orgA, 1)
    seedDriver("count-fresh-2", world.orgA, 14)
    seedDriver("count-stale", world.orgA, 60)
    seedDriver("count-never", world.orgA, null)

    const payload = await locations()
    const flagged = payload.drivers.filter((driver: any) => driver.online).length

    // Счётчик в сводке обязан совпадать с флагами по каждому водителю
    expect(payload.stats.online).toBe(flagged)
    expect(flagged).toBeGreaterThanOrEqual(2)
  })

  it("водитель со статусом «available», но без свежей точки — не на связи", async () => {
    const id = seedDriver("status-lie", world.orgA, 600)

    const payload = await locations()
    const driver = payload.drivers.find((row: any) => row.id === id)

    expect(driver.rawStatus).toBe("available")
    expect(driver.online).toBe(false)
  })

  it("чужие водители и их точки не видны", async () => {
    const foreign = seedDriver("pres-foreign", world.orgB, 1)

    const payload = await locations()
    expect(payload.drivers.some((driver: any) => driver.id === foreign)).toBe(false)
    expectNoForeignIds(payload, world)
  })
})
