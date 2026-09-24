// __tests__/isolation/sidebar-counts.test.ts
//
// Счётчики для сайдбара (GET /api/sidebar-counts) — настоящие числа организации,
// а не зашитые в компонент значения.
//
// Проверяется:
//   * счётчики считают только данные своей организации;
//   * «Заказы» — заказы, которые ждут действия логиста (Поиск/Согласование и
//     просроченные напоминания), закрытые заказы не считаются;
//   * прежние значения статусов (база может быть ещё не перенесена) считаются
//     так же, как канон;
//   * «Чат» — непрочитанные сообщения организации, кроме собственных.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import { cid, jsonOf, makeRequest, seedWorld, sessionCookie, type World } from "./helpers"

import { GET as sidebarCountsGet } from "@/app/api/sidebar-counts/route"

let world: World
let cookieA: string
let cookieB: string

function seedOrder(slug: string, organizationId: string, overrides: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("order", {
    id,
    organizationId,
    source: "manual",
    routeFrom: "Москва",
    routeTo: "Тула",
    distance: 180,
    weight: 3000,
    price: 25000,
    cargoType: "Груз",
    clientContact: "",
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: "search",
    negotiationStatus: "new",
    routeId: null,
    ...overrides,
  })
  return id
}

function seedMessage(slug: string, organizationId: string, overrides: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("chatMessage", {
    id,
    organizationId,
    senderId: world.driverA,
    senderRole: "driver",
    senderName: "Водитель",
    content: "сообщение",
    isRead: false,
    ...overrides,
  })
  return id
}

async function counts(cookie: string) {
  const response = await sidebarCountsGet(
    makeRequest("GET", "/api/sidebar-counts", { cookie }),
  )
  return { response, data: await jsonOf(response) }
}

beforeEach(async () => {
  world = seedWorld()
  // стартовые сообщения из seedWorld помечаем прочитанными: тогда в каждом тесте
  // непрочитанных ровно столько, сколько завёл сам тест
  for (const id of [world.chatA, world.chatB]) {
    const row = memoryDb.find("chatMessage", id)
    if (row) row.isRead = true
  }
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  cookieB = await sessionCookie({ userId: world.adminB, role: "admin", kind: "staff" })
})

describe("счётчики сайдбара (GET /api/sidebar-counts)", () => {
  it("без сессии — 401, у логиста без организации — 403", async () => {
    const anonymous = await sidebarCountsGet(makeRequest("GET", "/api/sidebar-counts"))
    expect(anonymous.status).toBe(401)

    const noOrgCookie = await sessionCookie({
      userId: world.logistNoOrg,
      role: "logist",
      kind: "staff",
    })
    const noOrg = await sidebarCountsGet(
      makeRequest("GET", "/api/sidebar-counts", { cookie: noOrgCookie }),
    )
    expect(noOrg.status).toBe(403)
  })

  it("считает заказы, которые ждут действия логиста", async () => {
    seedOrder("pending1", world.orgA, { status: "search" })
    seedOrder("pending2", world.orgA, { status: "negotiation" })
    // согласованный заказ ждёт не логиста, а сборки рейса — в этот счётчик не входит
    seedOrder("agreed1", world.orgA, { status: "agreed" })
    seedOrder("inroute1", world.orgA, { status: "in_route", routeId: world.routeA })

    const { data } = await counts(cookieA)
    expect(data.success).toBe(true)
    expect(data.orders).toBe(2)
  })

  it("закрытые заказы не считаются", async () => {
    seedOrder("closed1", world.orgA, { status: "delivered" })
    seedOrder("closed2", world.orgA, { status: "cancelled" })
    seedOrder("closed3", world.orgA, { status: "rejected" })

    const { data } = await counts(cookieA)
    expect(data.orders).toBe(0)
  })

  it("просроченное напоминание поднимает заказ в счётчик, даже если заказ согласован", async () => {
    const overdue = seedOrder("overdue", world.orgA, {
      status: "agreed",
      nextFollowUpAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    // напоминание в будущем — заказ ждёт, но не сейчас
    seedOrder("future", world.orgA, {
      status: "agreed",
      nextFollowUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })

    const { data } = await counts(cookieA)
    expect(data.orders).toBe(1)

    // у обработанного заказа напоминание проставлено в будущее — счётчик падает
    const row = memoryDb.find("order", overdue)
    if (!row) throw new Error("заказ не найден в тестовой базе")
    row.nextFollowUpAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

    const after = await counts(cookieA)
    expect(after.data.orders).toBe(0)
  })

  it("прежние значения статусов считаются так же, как канон", async () => {
    // база может быть ещё не перенесена на канон (scripts/migrate-order-stages.ts)
    seedOrder("legacy1", world.orgA, { status: "new" })
    seedOrder("legacy2", world.orgA, { status: "processing" })
    seedOrder("legacy3", world.orgA, { status: "needs_clarification" })

    const { data } = await counts(cookieA)
    expect(data.orders).toBe(3)
  })

  it("чужие заказы и сообщения в счётчики не попадают", async () => {
    seedOrder("ownPending", world.orgA, { status: "search" })
    seedOrder("foreignPending", world.orgB, { status: "search" })
    seedMessage("ownUnread", world.orgA)
    seedMessage("foreignUnread", world.orgB)

    const { data } = await counts(cookieA)
    expect(data.orders).toBe(1)
    expect(data.chat).toBe(1)

    const foreign = await counts(cookieB)
    expect(foreign.data.orders).toBe(1)
    expect(foreign.data.chat).toBe(1)
  })

  it("свои сообщения непрочитанными не считаются, прочитанные — тоже", async () => {
    // чужое непрочитанное — считается
    seedMessage("fromDriver", world.orgA)
    // моё собственное непрочитанное — не считается
    seedMessage("fromMe", world.orgA, {
      senderId: world.adminA,
      senderRole: "logist",
      senderName: "Администратор",
    })
    // прочитанное — не считается
    seedMessage("read", world.orgA, { isRead: true, readAt: new Date() })

    const { data } = await counts(cookieA)
    expect(data.chat).toBe(1)
  })

  it("в ответе нет чужих идентификаторов и лишних данных", async () => {
    seedOrder("ownPending2", world.orgA, { status: "search" })
    seedMessage("ownUnread2", world.orgA)

    const { data } = await counts(cookieA)
    expect(Object.keys(data).sort()).toEqual(["chat", "orders", "success"])
    const serialized = JSON.stringify(data)
    for (const id of world.foreignIds) {
      expect(serialized.includes(id)).toBe(false)
    }
  })
})
