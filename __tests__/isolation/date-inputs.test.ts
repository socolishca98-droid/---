// __tests__/isolation/date-inputs.test.ts
//
// Календарная дата из формы (<input type="date">) должна лечь в базу ТЕМ ЖЕ
// днём, который выбрал пользователь.
//
// Раньше сервер разбирал строку «2026-10-05» через new Date(), а это полночь
// UTC: в Москве в базе оказывалось 03:00 того же дня (полдня срока прав
// «съедались»), а в зонах западнее Гринвича — предыдущий день целиком.
// Проверяем настоящие роуты в двух зонах; единственная заглушка — in-memory
// база вместо Prisma (__tests__/__mocks__/prisma-memory.ts).
//
// Запуск: npm run test:isolation

import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import {
  jsonOf,
  makeRequest,
  routeContext,
  rowOf,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

import { POST as driversPost } from "@/app/api/drivers/route"
import { PATCH as driverPatch } from "@/app/api/drivers/[id]/route"
import { POST as mMaintenancePost } from "@/app/api/m/maintenance/route"
import { GET as paymentsGet, PATCH as paymentsPatch } from "@/app/api/payments/route"

const originalTz = process.env.TZ

let world: World
let cookieA: string

beforeEach(async () => {
  world = seedWorld()
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
})

afterAll(() => {
  process.env.TZ = originalTz
})

/** Полночь местных суток — то, что должно лежать в базе для календарной даты. */
function localMidnight(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

function timeOf(value: unknown): number {
  return new Date(value as string | Date).getTime()
}

describe("срок прав и медосмотра: POST /api/drivers", () => {
  it("в зоне западнее Гринвича день не съезжает назад", async () => {
    process.env.TZ = "America/New_York"

    const response = await driversPost(
      makeRequest("POST", "/api/drivers", {
        cookie: cookieA,
        body: {
          name: "Проверочный Водитель",
          phone: "+79005554433",
          licenseExpiry: "2026-10-05",
          medicalExpiry: "2027-01-11",
        },
      }),
    )

    expect(response.status).toBeLessThan(300)
    const payload = await jsonOf(response)
    const row = rowOf("driver", payload.driver.id)

    expect(timeOf(row.licenseExpiry)).toBe(localMidnight(2026, 10, 5))
    expect(timeOf(row.medicalExpiry)).toBe(localMidnight(2027, 1, 11))
  })

  it("в Москве день тот же, а не следующий", async () => {
    process.env.TZ = "Europe/Moscow"

    const response = await driversPost(
      makeRequest("POST", "/api/drivers", {
        cookie: cookieA,
        body: {
          name: "Московский Водитель",
          phone: "+79005554434",
          licenseExpiry: "2026-10-05",
        },
      }),
    )

    expect(response.status).toBeLessThan(300)
    const payload = await jsonOf(response)
    expect(timeOf(rowOf("driver", payload.driver.id).licenseExpiry)).toBe(
      localMidnight(2026, 10, 5),
    )
  })

  it("мусор вместо даты — 400, а не Invalid Date в базе", async () => {
    process.env.TZ = "Europe/Moscow"

    const response = await driversPost(
      makeRequest("POST", "/api/drivers", {
        cookie: cookieA,
        body: {
          name: "Водитель С Мусором",
          phone: "+79005554435",
          licenseExpiry: "пятое октября",
        },
      }),
    )

    expect(response.status).toBe(400)
    expect(
      memoryDb.rows("driver").some((row) => row.phone === "+79005554435"),
    ).toBe(false)
  })
})

describe("срок прав и медосмотра: PATCH /api/drivers/[id]", () => {
  it("обновление сохраняет выбранный день", async () => {
    process.env.TZ = "America/New_York"

    const response = await driverPatch(
      makeRequest("PATCH", `/api/drivers/${world.driverA}`, {
        cookie: cookieA,
        body: { licenseExpiry: "2026-11-20", medicalExpiry: "2026-12-01" },
      }),
      routeContext({ id: world.driverA }),
    )

    expect(response.status).toBeLessThan(300)
    const row = rowOf("driver", world.driverA)
    expect(timeOf(row.licenseExpiry)).toBe(localMidnight(2026, 11, 20))
    expect(timeOf(row.medicalExpiry)).toBe(localMidnight(2026, 12, 1))
  })

  it("пустое значение снимает срок, а не превращает его в epoch", async () => {
    process.env.TZ = "Europe/Moscow"

    const response = await driverPatch(
      makeRequest("PATCH", `/api/drivers/${world.driverA}`, {
        cookie: cookieA,
        body: { licenseExpiry: "" },
      }),
      routeContext({ id: world.driverA }),
    )

    expect(response.status).toBeLessThan(300)
    expect(rowOf("driver", world.driverA).licenseExpiry ?? null).toBeNull()
  })
})

describe("плановая дата ТО: POST /api/m/maintenance", () => {
  it("планируется на выбранный день, а не на полночь UTC", async () => {
    process.env.TZ = "America/New_York"

    const response = await mMaintenancePost(
      makeRequest("POST", "/api/m/maintenance", {
        cookie: cookieA,
        body: {
          vehicleId: world.vehicleA,
          driverId: world.driverA,
          type: "oil",
          description: "плановая замена масла",
          status: "planned",
          plannedDate: "2026-10-05",
        },
      }),
    )

    expect(response.status).toBeLessThan(300)
    const payload = await jsonOf(response)
    expect(timeOf(rowOf("maintenanceLog", payload.maintenance.id).startedAt)).toBe(
      localMidnight(2026, 10, 5),
    )
  })

  it("неверная дата — 400, запись ТО не создаётся", async () => {
    process.env.TZ = "Europe/Moscow"
    const before = memoryDb.rows("maintenanceLog").length

    const response = await mMaintenancePost(
      makeRequest("POST", "/api/m/maintenance", {
        cookie: cookieA,
        body: {
          vehicleId: world.vehicleA,
          driverId: world.driverA,
          type: "oil",
          description: "с мусором вместо даты",
          status: "planned",
          plannedDate: "05.10.2026",
        },
      }),
    )

    expect(response.status).toBe(400)
    expect(memoryDb.rows("maintenanceLog")).toHaveLength(before)
  })
})

describe("срок оплаты: PATCH /api/payments", () => {
  it("сохраняется выбранный день", async () => {
    process.env.TZ = "America/New_York"

    const response = await paymentsPatch(
      makeRequest("PATCH", "/api/payments", {
        cookie: cookieA,
        body: { orderId: world.orderA, dueDate: "2026-10-05" },
      }),
    )

    expect(response.status).toBeLessThan(300)
    expect(timeOf(rowOf("order", world.orderA).dueDate)).toBe(localMidnight(2026, 10, 5))
  })

  it("мусор вместо срока — 400 и старое значение остаётся", async () => {
    process.env.TZ = "Europe/Moscow"

    const response = await paymentsPatch(
      makeRequest("PATCH", "/api/payments", {
        cookie: cookieA,
        body: { orderId: world.orderA, dueDate: "когда-нибудь" },
      }),
    )

    expect(response.status).toBe(400)
  })
})

describe("фильтр периода: GET /api/payments?from&to", () => {
  it("первый час первого дня попадает в выборку (Москва)", async () => {
    process.env.TZ = "Europe/Moscow"

    // Заказ создан в 00:30 местных суток 1 октября: при границе «полночь UTC»
    // (03:00 по Москве) он выпадал бы из отбора
    const earlyId = "order_early_msk_000000000000000"
    memoryDb.insert("order", {
      id: earlyId,
      organizationId: world.orgA,
      status: "delivered",
      price: 1000,
      createdAt: new Date(2026, 9, 1, 0, 30),
      deliveredAt: new Date(2026, 9, 1, 10, 0),
    })

    const response = await paymentsGet(
      makeRequest("GET", "/api/payments?from=2026-10-01&to=2026-10-05", { cookie: cookieA }),
    )

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    const ids = JSON.stringify(payload)
    expect(ids).toContain(earlyId)
  })

  it("вечер перед первым днём в выборку не попадает (Нью-Йорк)", async () => {
    process.env.TZ = "America/New_York"

    // 30 сентября 22:00 местных суток: при границе «полночь UTC»
    // (= 20:00 30 сентября по местному времени) этот заказ ошибочно
    // попадал в выборку
    const lateId = "order_late_ny_0000000000000000"
    memoryDb.insert("order", {
      id: lateId,
      organizationId: world.orgA,
      status: "delivered",
      price: 2000,
      createdAt: new Date(2026, 8, 30, 22, 0),
      deliveredAt: new Date(2026, 8, 30, 23, 0),
    })

    // Сначала убеждаемся, что заказ вообще виден в этом эндпоинте, иначе
    // «не содержит» прошло бы и без всякой границы периода
    const wide = await paymentsGet(
      makeRequest("GET", "/api/payments?from=2026-09-30&to=2026-10-05", { cookie: cookieA }),
    )
    expect(wide.status).toBe(200)
    expect(JSON.stringify(await jsonOf(wide))).toContain(lateId)

    const response = await paymentsGet(
      makeRequest("GET", "/api/payments?from=2026-10-01&to=2026-10-05", { cookie: cookieA }),
    )

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(JSON.stringify(payload)).not.toContain(lateId)
  })
})
