// __tests__/isolation/reports.test.ts
//
// Отчёты (задача 8): /api/reports и /api/reports/export.
//
// Проверяется то, за что отчёт отвечает перед бизнесом: числа складываются из
// своих записей, чужие данные в отчёт не попадают, период уважается, выгрузка
// совпадает с экраном, а разбор опирается на реальные отклонения.

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import { cid, jsonOf, makeRequest, seedWorld, sessionCookie, type World } from "./helpers"

import { GET as reportsGet } from "@/app/api/reports/route"
import { GET as exportGet } from "@/app/api/reports/export/route"

let world: World
let cookieA: string
let cookieB: string
let cookieDriverA: string

const TODAY = new Date()
const PERIOD_FROM = new Date(TODAY.getTime() - 3 * 24 * 60 * 60 * 1000)

function seedRoute(id: string, organizationId: string, extra: Record<string, unknown> = {}) {
  const routeId = cid(id)
  memoryDb.insert("route", {
    id: routeId,
    organizationId,
    name: `Рейс ${id}`,
    status: "completed",
    createdAt: PERIOD_FROM,
    startedAt: PERIOD_FROM,
    completedAt: new Date(PERIOD_FROM.getTime() + 2 * 24 * 60 * 60 * 1000),
    totalDistance: 1600,
    startOdometer: 100000,
    endOdometer: 101500,
    driverId: extra.driverId ?? null,
    vehicleId: extra.vehicleId ?? null,
    ...extra,
  })
  return routeId
}

function seedExpense(id: string, organizationId: string, routeId: string, extra: Record<string, unknown> = {}) {
  const expenseId = cid(id)
  memoryDb.insert("routeExpense", {
    id: expenseId,
    organizationId,
    routeId,
    type: "fuel",
    amount: 20000,
    liters: 300,
    spentAt: PERIOD_FROM,
    source: "manual",
    ...extra,
  })
  return expenseId
}

beforeEach(async () => {
  world = seedWorld()
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  cookieB = await sessionCookie({ userId: world.adminB, role: "admin", kind: "staff" })
  cookieDriverA = await sessionCookie({
    userId: world.driverUserA,
    role: "driver",
    kind: "driver",
    driverId: world.driverA,
  })

  // Заказ А довезён внутри периода, с ценой и сроком
  const orderA = memoryDb.find("order", world.orderA)
  if (orderA) {
    orderA.status = "delivered"
    orderA.price = 100000
    orderA.agreedPrice = null
    orderA.distance = 800
    orderA.deliveredAt = new Date(PERIOD_FROM.getTime() + 24 * 60 * 60 * 1000)
    orderA.createdAt = PERIOD_FROM
    orderA.deadline = new Date(PERIOD_FROM.getTime() + 2 * 24 * 60 * 60 * 1000)
    orderA.clientId = null
    orderA.clientName = "Ромашка"
    orderA.isPaid = false
    orderA.dueDate = new Date(PERIOD_FROM.getTime() - 24 * 60 * 60 * 1000) // просрочен
  }

  // Заказ Б (чужая организация) — тоже внутри периода: он не должен попасть в отчёт А
  const orderB = memoryDb.find("order", world.orderB)
  if (orderB) {
    orderB.status = "delivered"
    orderB.price = 777777
    orderB.deliveredAt = new Date(PERIOD_FROM.getTime() + 24 * 60 * 60 * 1000)
    orderB.createdAt = PERIOD_FROM
    orderB.clientName = "Чужой клиент"
    orderB.isPaid = false
  }

  for (const routeId of [world.routeA, world.routeB]) {
    const route = memoryDb.find("route", routeId)
    if (route) {
      route.startedAt = PERIOD_FROM
      route.createdAt = PERIOD_FROM
      route.completedAt = new Date(PERIOD_FROM.getTime() + 2 * 24 * 60 * 60 * 1000)
      route.totalDistance = 1600
      route.startOdometer = 100000
      route.endOdometer = 101500
    }
  }

  // Расход на 20 000 в организации А и «ловушка» на 999 999 в организации Б
  seedExpense("fuelA", world.orgA, world.routeA, { amount: 20000, liters: 300 })
  seedExpense("fuelB", world.orgB, world.routeB, { amount: 999999, liters: 9999 })
})

describe("отчёт (GET /api/reports)", () => {
  it("без сессии и с водительской сессией — 401", async () => {
    const anonymous = await reportsGet(makeRequest("GET", "/api/reports"))
    expect(anonymous.status).toBe(401)

    const driver = await reportsGet(
      makeRequest("GET", "/api/reports", { cookie: cookieDriverA }),
    )
    expect(driver.status).toBe(401)
  })

  it("отчёт собирается только из данных своей организации", async () => {
    const response = await reportsGet(
      makeRequest("GET", "/api/reports?from=2026-01-01&to=2030-01-01", { cookie: cookieA }),
    )
    const body = (await jsonOf(response)) as any

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)

    // Выручка — только заказ А (100 000), расходы — только чек А (20 000)
    expect(body.report.finance.revenueRub).toBe(100000)
    expect(body.report.finance.expensesRub).toBe(20000)
    expect(body.report.finance.profitRub).toBe(80000)
    expect(body.report.finance.distanceKm).toBe(1500)

    // 777 777 ₽ из организации Б в отчёте появиться не могут
    expect(JSON.stringify(body)).not.toContain("777777")
    expect(JSON.stringify(body)).not.toContain("Чужой клиент")
    expect(JSON.stringify(body)).not.toContain("9999")
  })

  it("водители и клиенты считаются по именам, а не по идентификаторам", async () => {
    const response = await reportsGet(
      makeRequest("GET", "/api/reports?from=2026-01-01&to=2030-01-01", { cookie: cookieA }),
    )
    const body = (await jsonOf(response)) as any

    expect(body.report.drivers).toHaveLength(1)
    expect(body.report.drivers[0].driverId).toBe(world.driverA)
    expect(body.report.drivers[0].revenueRub).toBe(100000)
    expect(body.report.drivers[0].expensesRub).toBe(20000)

    expect(body.report.vehicles).toHaveLength(1)
    expect(body.report.vehicles[0].revenueRub).toBe(100000)

    expect(body.report.clients.top[0].name).toBe("Ромашка")
    expect(body.report.clients.top[0].revenueRub).toBe(100000)
  })

  it("оплаты видны целиком: просрочка найдена, разбор её называет", async () => {
    const response = await reportsGet(
      makeRequest("GET", "/api/reports?from=2026-01-01&to=2030-01-01", { cookie: cookieA }),
    )
    const body = (await jsonOf(response)) as any

    expect(body.report.payments.overdueRub).toBe(100000)
    expect(body.report.payments.overdueCount).toBe(1)
    expect(body.report.payments.overdueClients[0].name).toBe("Ромашка")

    const ids = body.insights.map((insight: any) => insight.id)
    expect(ids).toContain("payments-overdue")
    const overdue = body.insights.find((insight: any) => insight.id === "payments-overdue")
    expect(overdue.level).toBe("risk")
    expect(overdue.source).toBe("Оплаты")
  })

  it("период уважается: пустое окно даёт нули, а не данные из другого месяца", async () => {
    const response = await reportsGet(
      makeRequest("GET", "/api/reports?from=2020-01-01&to=2020-01-31", { cookie: cookieA }),
    )
    const body = (await jsonOf(response)) as any

    expect(body.report.data.ordersInPeriod).toBe(0)
    expect(body.report.data.hasData).toBe(false)
    expect(body.report.finance.revenueRub).toBe(0)
    expect(body.report.series).toHaveLength(31)
    expect(body.insights.map((insight: any) => insight.id)).toContain("no-data")
  })

  it("пресеты: неизвестное значение приводится к 30 дням, а не падает", async () => {
    const response = await reportsGet(
      makeRequest("GET", "/api/reports?preset=quarter", { cookie: cookieA }),
    )
    const body = (await jsonOf(response)) as any

    expect(response.status).toBe(200)
    expect(body.report.period.label).toBe("Последние 30 дней")
    expect(body.report.series).toHaveLength(30)
  })

  it("организация Б видит свои числа — отчёты не пересекаются", async () => {
    const response = await reportsGet(
      makeRequest("GET", "/api/reports?from=2026-01-01&to=2030-01-01", { cookie: cookieB }),
    )
    const body = (await jsonOf(response)) as any

    expect(body.report.finance.revenueRub).toBe(777777)
    expect(body.report.finance.expensesRub).toBe(999999)
    expect(JSON.stringify(body)).not.toContain("Ромашка")
  })
})

describe("выгрузка отчёта (GET /api/reports/export)", () => {
  it("текстовая выгрузка содержит те же числа, что и экран", async () => {
    const response = await exportGet(
      makeRequest("GET", "/api/reports/export?from=2026-01-01&to=2030-01-01", { cookie: cookieA }),
    )
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/plain")
    expect(response.headers.get("Content-Disposition")).toContain("attachment")
    expect(response.headers.get("X-Report-Insights")).toBeTruthy()

    expect(text).toContain("Выручка: 100")
    expect(text).toContain("Расходы: 20")
    expect(text).toContain("Ромашка")
    expect(text).toContain("РАЗБОР")
    expect(text).not.toContain("777")
    expect(text).not.toContain("999")
  })

  it("CSV для бухгалтерии: BOM, точка с запятой и итоговая строка", async () => {
    const response = await exportGet(
      makeRequest("GET", "/api/reports/export?format=csv&from=2026-01-01&to=2030-01-31", {
        cookie: cookieA,
      }),
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = new TextDecoder("utf-8").decode(bytes)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/csv")
    expect(response.headers.get("Content-Disposition")).toContain(".csv")

    // BOM проверяем по байтам: Response.text() его срезает
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])

    const lines = text.replace(/^\uFEFF/, "").split("\r\n")
    expect(lines[0]).toBe("Период;Выручка, ₽;Расходы, ₽;Прибыль, ₽;Заказов")
    expect(lines[lines.length - 1]).toBe("Итого;100000;20000;80000;1")
    expect(lines.length).toBeGreaterThan(2)
    expect(text).not.toContain("777")
  })

  it("чужая организация не выгружается через идентификаторы периода", async () => {
    const response = await exportGet(
      makeRequest("GET", "/api/reports/export?format=txt&from=2026-01-01&to=2030-01-01", {
        cookie: cookieB,
      }),
    )
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toContain("777")
    expect(text).not.toContain("100 000 ₽")
    expect(text).not.toContain("Ромашка")
  })

  it("выгрузка без сессии — 401", async () => {
    const response = await exportGet(makeRequest("GET", "/api/reports/export"))
    expect(response.status).toBe(401)
  })
})
