// __tests__/isolation/trip-history.test.ts
//
// История рейса и расходы (задача 7): /api/routes/[routeId]/history,
// /api/routes/[routeId]/expenses, /api/expenses/[expenseId], /api/m/expenses
// и загрузка фото с распознаванием.
//
// Распознавание (tesseract) подменяется: тест проверяет поведение API —
// границы организаций, права водителя, пересчёт итога после расхода, —
// а не качество OCR (для него есть отдельные тесты разбора текста).

import { beforeEach, describe, expect, it, vi } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import { cid, jsonOf, makeRequest, routeContext, seedWorld, sessionCookie, type World } from "./helpers"

vi.mock("@/lib/ocr/service", () => ({
  ocrDataPayload: (ocr: any, parsed: any) => ({
    provider: "tesseract",
    confidence: Math.round(ocr.confidence),
    parsed,
  }),
  recognizeDocumentOnPhoto: vi.fn(async ({ url, hint }: { url: string; hint?: string | null }) => ({
    ok: true,
    ocr: {
      text: "АЗС Лукойл\n07.09.2026\nАИ-95\n25,60 л\nИТОГО 1 600,00",
      confidence: 88,
      provider: "tesseract",
      durationMs: 1200,
      languages: ["rus", "eng"],
    },
    parsed: {
      kind: hint === "waybill" ? "waybill" : "receipt",
      total: 1600,
      liters: 25.6,
      date: "2026-09-07",
      warnings: [],
    },
    detectedKind: hint === "waybill" ? "waybill" : "receipt",
  })),
  recognizeFile: vi.fn(),
  uploadPathFromUrl: (url: string) => url,
}))

import { GET as historyGet } from "@/app/api/routes/[routeId]/history/route"
import { GET as expensesGet, POST as expensesPost } from "@/app/api/routes/[routeId]/expenses/route"
import { DELETE as expenseDelete } from "@/app/api/expenses/[expenseId]/route"
import { GET as mobileExpensesGet, POST as mobileExpensesPost } from "@/app/api/m/expenses/route"
import { GET as mobileOrderGet } from "@/app/api/m/orders/[id]/route"

let world: World
let cookieA: string
let cookieB: string
let cookieDriverA: string

function seedExpense(slug: string, routeId: string, extra: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("routeExpense", {
    id,
    organizationId: extra.organizationId ?? world.orgA,
    routeId,
    type: "fuel",
    amount: 5000,
    liters: 80,
    spentAt: new Date("2026-09-03T10:00:00"),
    source: "manual",
    ...extra,
  })
  return id
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

  // Заказы рейса А: сделка на 100 000, доставлен. Цены задаём явно,
  // чтобы итог рейса считался по одному известному числу.
  const orderA = memoryDb.find("order", world.orderA)
  if (orderA) {
    orderA.price = 100000
    orderA.agreedPrice = null
    orderA.distance = 800
    orderA.status = "delivered"
  }
  const orderB = memoryDb.find("order", world.orderB)
  if (orderB) {
    orderB.price = 50000
    orderB.distance = 400
  }

  for (const routeId of [world.routeA, world.routeB]) {
    const route = memoryDb.find("route", routeId)
    if (route) {
      route.startedAt = new Date("2026-09-02T06:00:00")
      route.completedAt = new Date("2026-09-04T20:00:00")
      route.createdAt = new Date("2026-09-01T08:00:00")
      route.totalDistance = 1600
    }
  }
})

describe("история рейса (GET /api/routes/[routeId]/history)", () => {
  it("без сессии — 401, водительская сессия карточку рейса не открывает", async () => {
    const anonymous = await historyGet(
      makeRequest("GET", `/api/routes/${world.routeA}/history`),
      routeContext({ routeId: world.routeA }),
    )
    expect(anonymous.status).toBe(401)

    const driver = await historyGet(
      makeRequest("GET", `/api/routes/${world.routeA}/history`, { cookie: cookieDriverA }),
      routeContext({ routeId: world.routeA }),
    )
    expect(driver.status).toBe(401)
  })

  it("чужой рейс — 404, свои данные не отдаются", async () => {
    const response = await historyGet(
      makeRequest("GET", `/api/routes/${world.routeB}/history`, { cookie: cookieA }),
      routeContext({ routeId: world.routeB }),
    )

    expect(response.status).toBe(404)
  })

  it("карточка рейса: итог по заказам и расходам, хронология и фото", async () => {
    seedExpense("fuel1", world.routeA, { amount: 18000, liters: 300 })
    seedExpense("toll", world.routeA, { type: "toll", amount: 2000, liters: null })
    memoryDb.insert("photo", {
      id: cid("receiptPhoto"),
      organizationId: world.orgA,
      url: "/uploads/a/receipt.jpg",
      type: "receipt",
      driverId: world.driverA,
      routeId: world.routeA,
      createdAt: new Date("2026-09-03T11:00:00"),
    })

    const response = await historyGet(
      makeRequest("GET", `/api/routes/${world.routeA}/history`, { cookie: cookieA }),
      routeContext({ routeId: world.routeA }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.route.id).toBe(world.routeA)
    expect(data.summary.ordersCount).toBe(1)
    expect(data.summary.revenueRub).toBe(100000)
    expect(data.summary.expensesRub).toBe(20000)
    expect(data.summary.fuelRub).toBe(18000)
    expect(data.summary.fuelLiters).toBe(300)
    expect(data.summary.profitRub).toBe(80000)
    expect(data.summary.distanceKm).toBe(1600)
    expect(data.summary.fuelPer100Km).toBe(18.8)
    expect(data.summary.durationDays).toBe(3)

    expect(data.byType.map((group: any) => group.type)).toEqual(["fuel", "toll"])
    expect(data.photos).toHaveLength(1)

    const kinds = data.timeline.map((entry: any) => entry.kind)
    expect(kinds).toContain("start")
    expect(kinds).toContain("expense")
    expect(kinds).toContain("order")
    expect(kinds).toContain("finish")

    // чужие данные в ответ не попали
    const payload = JSON.stringify(data)
    expect(payload).not.toContain(world.routeB)
    expect(payload).not.toContain(world.driverB)
  })

  it("итог меняется вместе с расходами и одометром", async () => {
    const route = memoryDb.find("route", world.routeA)
    if (route) {
      route.startOdometer = 120000
      route.endOdometer = 121640
    }
    seedExpense("fuel1", world.routeA, { amount: 15000, liters: 250 })

    const response = await historyGet(
      makeRequest("GET", `/api/routes/${world.routeA}/history`, { cookie: cookieA }),
      routeContext({ routeId: world.routeA }),
    )
    const data = await jsonOf(response)

    // пробег по одометру важнее планового
    expect(data.summary.distanceKm).toBe(1640)
    expect(data.summary.plannedDistanceKm).toBe(1600)
    expect(data.summary.costPerKmRub).toBe(9.15)
  })
})

describe("расходы рейса (GET/POST /api/routes/[routeId]/expenses)", () => {
  it("чужой рейс — 404: ни списка, ни записи", async () => {
    const list = await expensesGet(
      makeRequest("GET", `/api/routes/${world.routeB}/expenses`, { cookie: cookieA }),
      routeContext({ routeId: world.routeB }),
    )
    expect(list.status).toBe(404)

    const created = await expensesPost(
      makeRequest("POST", `/api/routes/${world.routeB}/expenses`, {
        cookie: cookieA,
        body: { type: "fuel", amount: 1000 },
      }),
      routeContext({ routeId: world.routeB }),
    )
    expect(created.status).toBe(404)
    expect(memoryDb.rows("routeExpense")).toHaveLength(0)
  })

  it("расход сохраняется и попадает в итог рейса", async () => {
    const created = await expensesPost(
      makeRequest("POST", `/api/routes/${world.routeA}/expenses`, {
        cookie: cookieA,
        body: {
          type: "fuel",
          amount: 4231.6,
          liters: 68.2,
          vendor: "Лукойл АЗС 214",
          source: "ocr",
          spentAt: "2026-09-03T12:30:00",
        },
      }),
      routeContext({ routeId: world.routeA }),
    )
    const data = await jsonOf(created)

    expect(created.status).toBe(200)
    expect(data.expense.amount).toBe(4232)
    expect(data.expense.liters).toBe(68.2)
    expect(data.expense.source).toBe("ocr")

    const list = await jsonOf(
      await expensesGet(
        makeRequest("GET", `/api/routes/${world.routeA}/expenses`, { cookie: cookieA }),
        routeContext({ routeId: world.routeA }),
      ),
    )

    expect(list.total).toBe(4232)
    expect(list.byType[0]).toMatchObject({ type: "fuel", amount: 4232, liters: 68.2, count: 1 })
  })

  it("одометр из чека становится показаниями рейса — из них считается пробег", async () => {
    await expensesPost(
      makeRequest("POST", `/api/routes/${world.routeA}/expenses`, {
        cookie: cookieA,
        body: { type: "fuel", amount: 3000, liters: 50, odometer: 120000 },
      }),
      routeContext({ routeId: world.routeA }),
    )
    await expensesPost(
      makeRequest("POST", `/api/routes/${world.routeA}/expenses`, {
        cookie: cookieA,
        body: { type: "fuel", amount: 2000, liters: 30, odometer: 121500 },
      }),
      routeContext({ routeId: world.routeA }),
    )

    const route = memoryDb.find("route", world.routeA)
    expect(route?.startOdometer).toBe(120000)
    expect(route?.endOdometer).toBe(121500)

    const history = await jsonOf(
      await historyGet(
        makeRequest("GET", `/api/routes/${world.routeA}/history`, { cookie: cookieA }),
        routeContext({ routeId: world.routeA }),
      ),
    )
    expect(history.summary.distanceKm).toBe(1500)
  })

  it("мусор в расходе отклоняется, чужие поля не проходят", async () => {
    const badAmount = await expensesPost(
      makeRequest("POST", `/api/routes/${world.routeA}/expenses`, {
        cookie: cookieA,
        body: { type: "fuel", amount: -5 },
      }),
      routeContext({ routeId: world.routeA }),
    )
    expect(badAmount.status).toBe(400)

    const badType = await expensesPost(
      makeRequest("POST", `/api/routes/${world.routeA}/expenses`, {
        cookie: cookieA,
        body: { type: "gold", amount: 100 },
      }),
      routeContext({ routeId: world.routeA }),
    )
    expect(badType.status).toBe(400)

    const foreignPhoto = await expensesPost(
      makeRequest("POST", `/api/routes/${world.routeA}/expenses`, {
        cookie: cookieA,
        body: { type: "fuel", amount: 100, photoId: world.photoB },
      }),
      routeContext({ routeId: world.routeA }),
    )
    expect(foreignPhoto.status).toBe(404)

    const unknown = await expensesPost(
      makeRequest("POST", `/api/routes/${world.routeA}/expenses`, {
        cookie: cookieA,
        body: { type: "fuel", amount: 100, organizationId: world.orgB },
      }),
      routeContext({ routeId: world.routeA }),
    )
    expect(unknown.status).toBe(400)

    expect(memoryDb.rows("routeExpense")).toHaveLength(0)
  })

  it("удалить можно только свой расход", async () => {
    const mine = seedExpense("mine", world.routeA)
    const alien = seedExpense("alien", world.routeB, { organizationId: world.orgB })

    const foreign = await expenseDelete(
      makeRequest("DELETE", `/api/expenses/${alien}`, { cookie: cookieA }),
      routeContext({ expenseId: alien }),
    )
    expect(foreign.status).toBe(404)
    expect(memoryDb.find("routeExpense", alien)).toBeTruthy()

    const own = await expenseDelete(
      makeRequest("DELETE", `/api/expenses/${mine}`, { cookie: cookieA }),
      routeContext({ expenseId: mine }),
    )
    expect(own.status).toBe(200)
    expect(memoryDb.find("routeExpense", mine)).toBeUndefined()
  })
})

describe("расходы водителя (GET/POST /api/m/expenses)", () => {
  it("водитель видит расходы своего рейса и пишет в него, а не в чужой", async () => {
    seedExpense("fuelMine", world.routeA, { amount: 7000, liters: 120 })
    seedExpense("fuelAlien", world.routeB, { amount: 9999, liters: 1, organizationId: world.orgB })

    const list = await jsonOf(
      await mobileExpensesGet(makeRequest("GET", "/api/m/expenses", { cookie: cookieDriverA })),
    )

    expect(list.route.id).toBe(world.routeA)
    expect(list.expenses).toHaveLength(1)
    expect(list.total).toBe(7000)
    expect(list.summary.expensesRub).toBe(7000)

    const created = await mobileExpensesPost(
      makeRequest("POST", "/api/m/expenses", {
        cookie: cookieDriverA,
        body: { type: "fuel", amount: 3500, liters: 60, vendor: "Газпромнефть" },
      }),
    )
    const createdData = await jsonOf(created)

    expect(created.status).toBe(200)
    expect(createdData.expense.amount).toBe(3500)

    // расход записался в рейс водителя и в его организацию
    const stored = memoryDb.find("routeExpense", createdData.expense.id)
    expect(stored?.routeId).toBe(world.routeA)
    expect(stored?.organizationId).toBe(world.orgA)

    // и попал в событие рейса — виден в хронологии
    const events = memoryDb.rows("routeEvent").filter((row) => row.type === "expense")
    expect(events).toHaveLength(1)
    expect(events[0].routeId).toBe(world.routeA)
  })

  it("чужое фото чека приложить нельзя, мусорные суммы отклоняются", async () => {
    const foreignPhoto = await mobileExpensesPost(
      makeRequest("POST", "/api/m/expenses", {
        cookie: cookieDriverA,
        body: { type: "fuel", amount: 1000, photoId: world.photoB },
      }),
    )
    expect(foreignPhoto.status).toBe(404)

    const badAmount = await mobileExpensesPost(
      makeRequest("POST", "/api/m/expenses", {
        cookie: cookieDriverA,
        body: { type: "fuel", amount: 0 },
      }),
    )
    expect(badAmount.status).toBe(400)

    expect(memoryDb.rows("routeExpense")).toHaveLength(0)
  })

  it("без активного рейса расход записывать некуда", async () => {
    const route = memoryDb.find("route", world.routeA)
    if (route) route.status = "completed"

    const response = await mobileExpensesPost(
      makeRequest("POST", "/api/m/expenses", {
        cookie: cookieDriverA,
        body: { type: "fuel", amount: 1000 },
      }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(409)
    expect(data.error).toContain("активного рейса")

    const list = await jsonOf(
      await mobileExpensesGet(makeRequest("GET", "/api/m/expenses", { cookie: cookieDriverA })),
    )
    expect(list.route).toBeNull()
  })

  it("штабная сессия мобильные расходы не открывает", async () => {
    const response = await mobileExpensesGet(
      makeRequest("GET", "/api/m/expenses", { cookie: cookieA }),
    )
    expect(response.status).toBe(401)
  })
})

describe("загрузка фото с распознаванием (POST /api/photos/upload)", () => {
  it("файл сохраняется, чек распознаётся, фото попадает в историю рейса", async () => {
    const { POST: upload } = await import("@/app/api/photos/upload/route")

    const form = new FormData()
    form.append(
      "file",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], "receipt.jpg", { type: "image/jpeg" }),
    )
    form.append("type", "receipt")
    form.append("driverId", world.driverA)
    form.append("routeId", world.routeA)

    const request = new (await import("next/server")).NextRequest(
      new URL("http://localhost/api/photos/upload"),
      { method: "POST", body: form, headers: { cookie: cookieA } },
    )

    const response = await upload(request)
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.photo.url).toMatch(/^\/uploads\//)
    expect(data.photo.routeId).toBe(world.routeA)
    expect(data.ocr.total).toBe(1600)
    expect(data.ocr.liters).toBe(25.6)
    expect(data.photo.type).toBe("receipt")

    // фото записано в базу и привязано к рейсу
    const stored = memoryDb.find("photo", data.photo.id)
    expect(stored?.routeId).toBe(world.routeA)
    expect(String(stored?.ocrText)).toContain("ИТОГО")
    expect(stored?.ocrData).toBeTruthy()

    // и видно в истории рейса
    const history = await jsonOf(
      await historyGet(
        makeRequest("GET", `/api/routes/${world.routeA}/history`, { cookie: cookieA }),
        routeContext({ routeId: world.routeA }),
      ),
    )
    expect(history.photos.map((photo: any) => photo.id)).toEqual([data.photo.id])

    // убираем файл за собой: тест не должен оставлять мусор в public/uploads
    const { unlink } = await import("node:fs/promises")
    const path = await import("node:path")
    await unlink(path.join(process.cwd(), "public", data.photo.url.replace(/^\//, ""))).catch(() => {})
  })

  it("неподдерживаемый формат отклоняется, чужой водитель не принимается", async () => {
    const { POST: upload } = await import("@/app/api/photos/upload/route")
    const { NextRequest } = await import("next/server")

    const badFormat = new FormData()
    badFormat.append("file", new File([new Uint8Array([1, 2, 3])], "doc.pdf", { type: "application/pdf" }))
    badFormat.append("type", "receipt")
    badFormat.append("driverId", world.driverA)

    const badFormatResponse = await upload(
      new NextRequest(new URL("http://localhost/api/photos/upload"), {
        method: "POST",
        body: badFormat,
        headers: { cookie: cookieA },
      }),
    )
    expect(badFormatResponse.status).toBe(415)

    const foreignDriver = new FormData()
    foreignDriver.append(
      "file",
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", { type: "image/jpeg" }),
    )
    foreignDriver.append("type", "cargo_before")
    foreignDriver.append("driverId", world.driverB)

    const foreignResponse = await upload(
      new NextRequest(new URL("http://localhost/api/photos/upload"), {
        method: "POST",
        body: foreignDriver,
        headers: { cookie: cookieA },
      }),
    )

    expect(foreignResponse.status).toBe(404)
    expect(memoryDb.rows("photo")).toHaveLength(2) // только фото из seedWorld
  })
})

describe("карточка рейса у водителя (GET /api/m/orders/[id])", () => {
  it("штабная сессия карточку водителя не открывает — 401", async () => {
    const response = await mobileOrderGet(
      makeRequest("GET", `/api/m/orders/${world.orderA}`, { cookie: cookieA }),
      routeContext({ id: world.orderA }),
    )

    expect(response.status).toBe(401)
  })

  it("водитель видит свой заказ с итогом, расходами, фото и ссылкой на печать", async () => {
    seedExpense("driverFuel", world.routeA, { amount: 18000, liters: 300, odometer: 120000 })
    // cid() выдаёт новый id на каждый вызов — запоминаем тот, что попал в базу
    const photoId = cid("driverPhoto")
    memoryDb.insert("photo", {
      id: photoId,
      organizationId: world.orgA,
      url: "/uploads/a/waybill.jpg",
      type: "waybill",
      driverId: world.driverA,
      orderId: world.orderA,
      routeId: world.routeA,
    })

    const response = await mobileOrderGet(
      makeRequest("GET", `/api/m/orders/${world.orderA}`, { cookie: cookieDriverA }),
      routeContext({ id: world.orderA }),
    )
    const body = (await jsonOf(response)) as any

    expect(response.status).toBe(200)
    expect(body.order.id).toBe(world.orderA)
    expect(body.order.statusLabel).toBeTruthy()
    expect(body.summary.ordersCount).toBe(1)
    expect(body.summary.revenueRub).toBe(100000)
    expect(body.summary.expensesRub).toBe(18000)
    expect(body.summary.profitRub).toBe(82000)
    expect(body.expenses).toHaveLength(1)
    expect(body.photos.map((photo: any) => photo.id)).toContain(photoId)
    expect(body.documents.printUrl).toBe(`/print/route/${world.routeA}`)
  })

  it("чужой заказ водителю не отдаётся — 404", async () => {
    const response = await mobileOrderGet(
      makeRequest("GET", `/api/m/orders/${world.orderB}`, { cookie: cookieDriverA }),
      routeContext({ id: world.orderB }),
    )

    expect(response.status).toBe(404)
  })
})
