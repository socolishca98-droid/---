// __tests__/isolation/orders-process.test.ts
//
// Функциональные тесты задачи 2 «Заказы как процесс»:
//   Поиск → Согласование → Маршрут → Документы → Назначение → Контроль.
//
// Проверяется то, что нельзя проверить типами:
//   * заказ рождается в своей организации и на этапе «Поиск»;
//   * общая база ATI (AtiCache) не меняется — груз остаётся доступным другим;
//   * чужой заказ не читается и не меняется (404, а не 403);
//   * на холст/в рейс попадают только согласованные заказы;
//   * смена цены и статуса автоматически попадает в ленту согласования.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import {
  cid,
  expectNoForeignIds,
  jsonOf,
  makeRequest,
  rowOf,
  routeContext,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

import { POST as takeFromCachePost } from "@/app/api/orders/from-cache/route"
import { GET as sandboxGet, DELETE as sandboxDelete } from "@/app/api/ati/sandbox/route"
import {
  GET as negotiationGet,
  POST as negotiationPost,
} from "@/app/api/orders/[id]/negotiation/route"
import { PATCH as orderPatch } from "@/app/api/orders/[id]/route"
import { POST as ordersPost } from "@/app/api/orders/route"
import { POST as routesPost } from "@/app/api/routes/route"

let world: World
let cookieA: string
let cookieB: string

/** Строка общей накопленной базы ATI (биржа грузов — организация не применяется). */
function seedCacheRow(slug: string, overrides: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("atiCache", {
    id,
    atiLoadId: `ati-${slug}`,
    routeFrom: "Москва",
    routeTo: "Казань",
    distance: 800,
    weight: 5000,
    volume: 20,
    cargoType: "Стройматериалы",
    loadingType: "pallets",
    price: 45000,
    paymentType: "nal",
    firmName: "ООО Ромашка",
    firmId: "7712345678",
    contactName: "Иван",
    contactPhone: "+7 900 000-00-00",
    note: "Погрузка с 9:00",
    status: "new",
    aiScore: 70,
    aiReason: "Подходит по направлению",
    loadingDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  })
  return id
}

/** Заказ организации на нужном этапе (по умолчанию — согласованный, без рейса). */
function seedOrder(
  slug: string,
  organizationId: string,
  overrides: Record<string, unknown> = {},
) {
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
    clientName: "Клиент",
    clientContact: "",
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: "agreed",
    negotiationStatus: "agreed",
    routeId: null,
    ...overrides,
  })
  return id
}

function auditRows(action: string) {
  return memoryDb.rows("auditLog").filter((row) => row.action === action)
}

function negotiationRows(orderId: string) {
  return memoryDb.rows("orderNegotiation").filter((row) => row.orderId === orderId)
}

beforeEach(async () => {
  world = seedWorld()
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  cookieB = await sessionCookie({ userId: world.adminB, role: "admin", kind: "staff" })
})

// ---------------------------------------------------------------------------
// Взять в работу из накопленной базы
// ---------------------------------------------------------------------------

describe("взять груз в работу (POST /api/orders/from-cache)", () => {
  it("создаёт заказ своей организации на этапе «Поиск»", async () => {
    const cacheId = seedCacheRow("cache1")

    const response = await takeFromCachePost(
      makeRequest("POST", "/api/orders/from-cache", { cookie: cookieA, body: { cacheId } }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.order.status).toBe("search")
    expect(data.order.stage).toBe("search")
    expect(data.order.atiCacheId).toBe(cacheId)

    const order = rowOf("order", data.order.id)
    expect(order.organizationId).toBe(world.orgA)
    expect(order.status).toBe("search")
    expect(order.negotiationStatus).toBe("new")
    expect(order.takenById).toBe(world.adminA)
    expect(order.routeFrom).toBe("Москва")
    expect(order.routeTo).toBe("Казань")
    expect(order.price).toBe(45000)
    expectNoForeignIds(data, world)
  })

  it("общая база ATI не меняется: тот же груз берёт другая организация", async () => {
    const cacheId = seedCacheRow("cache2")

    const first = await jsonOf(
      await takeFromCachePost(
        makeRequest("POST", "/api/orders/from-cache", { cookie: cookieA, body: { cacheId } }),
      ),
    )
    expect(first.success).toBe(true)

    // строка общей базы осталась как была — груз не «спрятан» от других
    expect(rowOf("atiCache", cacheId).status).toBe("new")

    const second = await takeFromCachePost(
      makeRequest("POST", "/api/orders/from-cache", { cookie: cookieB, body: { cacheId } }),
    )
    const data = await jsonOf(second)

    expect(second.status).toBe(200)
    expect(data.success).toBe(true)
    expect(rowOf("order", data.order.id).organizationId).toBe(world.orgB)
    expectNoForeignIds({ order: { id: data.order.id, status: data.order.status } }, world)
  })

  it("второй раз тот же груз в своей организации взять нельзя — 409", async () => {
    const cacheId = seedCacheRow("cache3")
    const first = await jsonOf(
      await takeFromCachePost(
        makeRequest("POST", "/api/orders/from-cache", { cookie: cookieA, body: { cacheId } }),
      ),
    )

    const response = await takeFromCachePost(
      makeRequest("POST", "/api/orders/from-cache", { cookie: cookieA, body: { cacheId } }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(409)
    expect(data.code).toBe("already_taken")
    expect(data.order.id).toBe(first.order.id)
    // дубль не создан
    expect(
      memoryDb.rows("order").filter((row) => row.atiCacheId === cacheId && row.organizationId === world.orgA)
        .length,
    ).toBe(1)
  })

  it("несуществующего груза нет — 404, снятого груза — 410", async () => {
    const missing = await takeFromCachePost(
      makeRequest("POST", "/api/orders/from-cache", {
        cookie: cookieA,
        body: { cacheId: cid("nocache") },
      }),
    )
    expect(missing.status).toBe(404)

    const expiredId = seedCacheRow("cacheexpired", { status: "expired" })
    const expired = await takeFromCachePost(
      makeRequest("POST", "/api/orders/from-cache", { cookie: cookieA, body: { cacheId: expiredId } }),
    )
    expect(expired.status).toBe(410)
    expect((await jsonOf(expired)).success).toBe(false)
  })

  it("без cacheId — 400, без сессии — 401", async () => {
    const noBody = await takeFromCachePost(
      makeRequest("POST", "/api/orders/from-cache", { cookie: cookieA, body: {} }),
    )
    expect(noBody.status).toBe(400)

    const anonymous = await takeFromCachePost(
      makeRequest("POST", "/api/orders/from-cache", { body: { cacheId: seedCacheRow("cache4") } }),
    )
    expect(anonymous.status).toBe(401)
  })

  it("действие пишется в журнал аудита своей организации", async () => {
    const cacheId = seedCacheRow("cache5")
    const data = await jsonOf(
      await takeFromCachePost(
        makeRequest("POST", "/api/orders/from-cache", { cookie: cookieA, body: { cacheId } }),
      ),
    )

    const rows = auditRows("order_take_from_base")
    expect(rows.length).toBe(1)
    expect(rows[0].organizationId).toBe(world.orgA)
    expect(rows[0].targetId).toBe(data.order.id)
    // lib/audit.ts кладёт metadata строкой JSON — так же, как в реальной базе
    expect(JSON.parse(rows[0].metadata).atiCacheId).toBe(cacheId)
  })
})

describe("ручное создание заказа (POST /api/orders)", () => {
  it("заказ, заведённый вручную, начинается с этапа «Согласование»", async () => {
    const response = await ordersPost(
      makeRequest("POST", "/api/orders", {
        cookie: cookieA,
        body: {
          routeFrom: "Москва",
          routeTo: "Тверь",
          weight: 18000,
          price: 45000,
          cargoType: "Стройматериалы",
          clientName: "Иван",
          clientContact: "+79251112233",
          requirements: "тент, боковая загрузка",
        },
      }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)

    const order = rowOf("order", data.order.id)
    expect(order.organizationId).toBe(world.orgA)
    // цена ещё не согласована — заказ ждёт переговоров, а не «в поиске»
    expect(order.status).toBe("negotiation")
    expect(order.negotiationStatus).toBe("new")
    expect(order.requirements).toBe("тент, боковая загрузка")
    expect(order.weight).toBe(18000)
  })

  it("на строку накопленной базы заказ у организации один", async () => {
    const cacheId = seedCacheRow("cache8")
    const body = {
      routeFrom: "Москва",
      routeTo: "Казань",
      atiCacheId: cacheId,
    }

    const first = await ordersPost(
      makeRequest("POST", "/api/orders", { cookie: cookieA, body }),
    )
    expect(first.status).toBe(200)

    const second = await ordersPost(
      makeRequest("POST", "/api/orders", { cookie: cookieA, body }),
    )
    const data = await jsonOf(second)

    expect(second.status).toBe(409)
    expect(data.code).toBe("already_taken")
    expect(
      memoryDb
        .rows("order")
        .filter((row) => row.atiCacheId === cacheId && row.organizationId === world.orgA).length,
    ).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Песочница: список заказов и возврат в базу
// ---------------------------------------------------------------------------

describe("песочница заказов (GET/DELETE /api/ati/sandbox)", () => {
  it("показывает только заказы своей организации", async () => {
    const own = seedOrder("sandboxa", world.orgA, { status: "agreed", routeId: null })
    const foreign = seedOrder("sandboxb", world.orgB, { status: "agreed", routeId: null })

    const response = await sandboxGet(makeRequest("GET", "/api/ati/sandbox", { cookie: cookieA }))
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
    const ids = data.map((row: any) => row.id)
    // заказ организации А виден, заказ организации Б — нет
    expect(ids).toContain(own)
    expect(ids).not.toContain(foreign)
    expect(ids).not.toContain(world.orderB)
    expectNoForeignIds(data, world)
  })

  it("заказы в рейсе и закрытые в песочницу не попадают", async () => {
    const inRoute = seedOrder("sandboxinroute", world.orgA, { status: "in_route", routeId: world.routeA })
    const closed = seedOrder("sandboxclosed", world.orgA, { status: "delivered" })
    const free = seedOrder("sandboxfree", world.orgA, { status: "agreed", routeId: null })

    const data = await jsonOf(
      await sandboxGet(makeRequest("GET", "/api/ati/sandbox", { cookie: cookieA })),
    )
    const ids = data.map((row: any) => row.id)

    expect(ids).toContain(free)
    expect(ids).not.toContain(inRoute)
    expect(ids).not.toContain(closed)
  })

  it("чужой заказ вернуть в базу нельзя — 404", async () => {
    const response = await sandboxDelete(
      makeRequest("DELETE", "/api/ati/sandbox", { cookie: cookieA, body: { id: world.orderB } }),
    )
    expect(response.status).toBe(404)
    // заказ организации Б на месте
    expect(rowOf("order", world.orderB).id).toBe(world.orderB)
  })

  it("заказ в рейсе вернуть в базу нельзя — 409", async () => {
    const response = await sandboxDelete(
      makeRequest("DELETE", "/api/ati/sandbox", { cookie: cookieA, body: { id: world.orderA } }),
    )
    expect(response.status).toBe(409)
    expect(rowOf("order", world.orderA).id).toBe(world.orderA)
  })

  it("свой заказ из базы ATI возвращается в базу и пишется аудит", async () => {
    const cacheId = seedCacheRow("cache6")
    const taken = await jsonOf(
      await takeFromCachePost(
        makeRequest("POST", "/api/orders/from-cache", { cookie: cookieA, body: { cacheId } }),
      ),
    )
    const orderId = taken.order.id

    const response = await sandboxDelete(
      makeRequest("DELETE", "/api/ati/sandbox", { cookie: cookieA, body: { id: orderId } }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(memoryDb.find("order", orderId)).toBeUndefined()
    // строка общей базы не пострадала
    expect(rowOf("atiCache", cacheId).id).toBe(cacheId)

    const rows = auditRows("order_return_to_base")
    expect(rows.length).toBe(1)
    expect(rows[0].organizationId).toBe(world.orgA)
    expect(rows[0].targetId).toBe(orderId)
  })
})

// ---------------------------------------------------------------------------
// Согласование: лента переговоров
// ---------------------------------------------------------------------------

describe("согласование заказа (GET/POST /api/orders/:id/negotiation)", () => {
  it("чужой заказ не читается и не комментируется — 404", async () => {
    const read = await negotiationGet(
      makeRequest("GET", `/api/orders/${world.orderB}/negotiation`, { cookie: cookieA }),
      routeContext({ id: world.orderB }),
    )
    expect(read.status).toBe(404)

    const write = await negotiationPost(
      makeRequest("POST", `/api/orders/${world.orderB}/negotiation`, {
        cookie: cookieA,
        body: { kind: "note", text: "Чужой заказ" },
      }),
      routeContext({ id: world.orderB }),
    )
    expect(write.status).toBe(404)
    expect(negotiationRows(world.orderB).length).toBe(0)
  })

  it("заметка и предложение цены добавляются в ленту своей организации", async () => {
    const orderId = seedOrder("nego1", world.orgA, { status: "negotiation", negotiationStatus: "in_progress" })
    const ctx = routeContext({ id: orderId })

    const note = await jsonOf(
      await negotiationPost(
        makeRequest("POST", `/api/orders/${orderId}/negotiation`, {
          cookie: cookieA,
          body: { kind: "note", text: "Клиент просит отсрочку платежа" },
        }),
        ctx,
      ),
    )
    expect(note.success).toBe(true)
    expect(note.entry.kind).toBe("note")
    expect(note.entry.authorId).toBe(world.adminA)

    const offer = await negotiationPost(
      makeRequest("POST", `/api/orders/${orderId}/negotiation`, {
        cookie: cookieA,
        body: { kind: "price_offer", text: "Предложили 23 000", priceOffer: 23000 },
      }),
      ctx,
    )
    expect(offer.status).toBe(200)

    const rows = negotiationRows(orderId)
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.organizationId).toBe(world.orgA)
      expect(row.orderId).toBe(orderId)
    }

    const feed = await jsonOf(
      await negotiationGet(makeRequest("GET", `/api/orders/${orderId}/negotiation`, { cookie: cookieA }), ctx),
    )
    expect(feed.success).toBe(true)
    expect(feed.entries.length).toBe(2)
    expect(feed.order.id).toBe(orderId)
    expect(feed.entries.some((entry: any) => entry.priceOffer === 23000)).toBe(true)
    expectNoForeignIds(feed, world)
  })

  it("предложение цены без суммы и пустая запись отклоняются — 400", async () => {
    const orderId = seedOrder("nego2", world.orgA)
    const ctx = routeContext({ id: orderId })

    const noPrice = await negotiationPost(
      makeRequest("POST", `/api/orders/${orderId}/negotiation`, {
        cookie: cookieA,
        body: { kind: "price_offer", text: "Дорого" },
      }),
      ctx,
    )
    expect(noPrice.status).toBe(400)

    const empty = await negotiationPost(
      makeRequest("POST", `/api/orders/${orderId}/negotiation`, { cookie: cookieA, body: { kind: "note" } }),
      ctx,
    )
    expect(empty.status).toBe(400)
    expect(negotiationRows(orderId).length).toBe(0)
  })

  it("автоматические виды записей руками добавить нельзя — 400", async () => {
    const orderId = seedOrder("nego3", world.orgA)
    const ctx = routeContext({ id: orderId })

    for (const kind of ["price_change", "status_change", "свой вид"]) {
      const response = await negotiationPost(
        makeRequest("POST", `/api/orders/${orderId}/negotiation`, {
          cookie: cookieA,
          body: { kind, text: "Обход автоматики" },
        }),
        ctx,
      )
      expect(response.status).toBe(400)
    }
    expect(negotiationRows(orderId).length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Этапы заказа: переходы и автоматическая история
// ---------------------------------------------------------------------------

describe("этапы заказа (PATCH /api/orders/:id)", () => {
  it("прежнее значение статуса принимается и приводится к канону", async () => {
    const orderId = seedOrder("stage1", world.orgA, { status: "search", negotiationStatus: "new" })

    const response = await orderPatch(
      makeRequest("PATCH", `/api/orders/${orderId}`, {
        cookie: cookieA,
        body: { status: "processing" },
      }),
      routeContext({ id: orderId }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(rowOf("order", orderId).status).toBe("negotiation")

    // смена статуса попала в ленту согласования автоматически
    const feed = negotiationRows(orderId)
    expect(feed.length).toBe(1)
    expect(feed[0].kind).toBe("status_change")
    expect(feed[0].organizationId).toBe(world.orgA)
  })

  it("запрещённый переход отклоняется — 400 и список доступных этапов", async () => {
    const orderId = seedOrder("stage2", world.orgA, { status: "search" })

    const response = await orderPatch(
      makeRequest("PATCH", `/api/orders/${orderId}`, { cookie: cookieA, body: { status: "in_transit" } }),
      routeContext({ id: orderId }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(400)
    expect(data.code).toBe("invalid_status_transition")
    expect(Array.isArray(data.allowed)).toBe(true)
    expect(data.allowed).not.toContain("control")
    // заказ не изменился
    expect(rowOf("order", orderId).status).toBe("search")
    expect(negotiationRows(orderId).length).toBe(0)
  })

  it("неизвестный статус отклоняется — 400", async () => {
    const orderId = seedOrder("stage3", world.orgA, { status: "search" })
    const response = await orderPatch(
      makeRequest("PATCH", `/api/orders/${orderId}`, { cookie: cookieA, body: { status: "прогулка" } }),
      routeContext({ id: orderId }),
    )
    expect(response.status).toBe(400)
    expect(rowOf("order", orderId).status).toBe("search")
  })

  it("торг по цене автоматически попадает в ленту согласования", async () => {
    const orderId = seedOrder("stage4", world.orgA, { status: "negotiation", price: 25000 })

    const response = await orderPatch(
      makeRequest("PATCH", `/api/orders/${orderId}`, {
        cookie: cookieA,
        body: { price: 23000, agreedPrice: 23000 },
      }),
      routeContext({ id: orderId }),
    )

    expect(response.status).toBe(200)
    expect(rowOf("order", orderId).agreedPrice).toBe(23000)

    const feed = negotiationRows(orderId)
    expect(feed.length).toBe(2)
    expect(feed.every((row) => row.kind === "price_change")).toBe(true)
    expect(feed.some((row) => row.priceOffer === 23000)).toBe(true)
    expect(feed.every((row) => row.organizationId === world.orgA)).toBe(true)
  })

  it("итог переговоров переводит заказ: договорились → согласован", async () => {
    const orderId = seedOrder("stage5", world.orgA, { status: "search", negotiationStatus: "new" })

    const response = await orderPatch(
      makeRequest("PATCH", `/api/orders/${orderId}`, {
        cookie: cookieA,
        body: { negotiationStatus: "agreed", agreedPrice: 24000 },
      }),
      routeContext({ id: orderId }),
    )

    expect(response.status).toBe(200)
    const order = rowOf("order", orderId)
    expect(order.negotiationStatus).toBe("agreed")
    expect(order.status).toBe("agreed")
    expect(negotiationRows(orderId).some((row) => row.kind === "status_change")).toBe(true)
  })

  it("не договорились → заказ отклонён", async () => {
    const orderId = seedOrder("stage6", world.orgA, { status: "negotiation", negotiationStatus: "in_progress" })

    const response = await orderPatch(
      makeRequest("PATCH", `/api/orders/${orderId}`, { cookie: cookieA, body: { negotiationStatus: "lost" } }),
      routeContext({ id: orderId }),
    )

    expect(response.status).toBe(200)
    expect(rowOf("order", orderId).status).toBe("rejected")
  })

  it("чужой заказ не меняется — 404", async () => {
    const before = rowOf("order", world.orderB).status
    const response = await orderPatch(
      makeRequest("PATCH", `/api/orders/${world.orderB}`, { cookie: cookieA, body: { status: "cancelled" } }),
      routeContext({ id: world.orderB }),
    )
    expect(response.status).toBe(404)
    expect(rowOf("order", world.orderB).status).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Рейс из согласованных заказов
// ---------------------------------------------------------------------------

describe("сборка рейса (POST /api/routes)", () => {
  it("чужой заказ в рейс не берётся — 404", async () => {
    const response = await routesPost(
      makeRequest("POST", "/api/routes", { cookie: cookieA, body: { orderIds: [world.orderB] } }),
    )
    expect(response.status).toBe(404)
    expect(rowOf("order", world.orderB).routeId).toBe(world.routeB)
  })

  it("несогласованный заказ в рейс не берётся — 409 orders_not_agreed", async () => {
    const orderId = seedOrder("route1", world.orgA, { status: "search", negotiationStatus: "new" })

    const response = await routesPost(
      makeRequest("POST", "/api/routes", { cookie: cookieA, body: { orderIds: [orderId] } }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(409)
    expect(data.code).toBe("orders_not_agreed")
    expect(data.orderIds).toEqual([orderId])
    expect(rowOf("order", orderId).routeId).toBeNull()
  })

  it("заказ из другого рейса не перетягивается — 409 orders_already_in_route", async () => {
    const response = await routesPost(
      makeRequest("POST", "/api/routes", { cookie: cookieA, body: { orderIds: [world.orderA] } }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(409)
    expect(data.code).toBe("orders_already_in_route")
    expect(rowOf("order", world.orderA).routeId).toBe(world.routeA)
  })

  it("согласованный заказ привязывается к рейсу, машина не обязательна", async () => {
    const orderId = seedOrder("route2", world.orgA, { status: "agreed", routeId: null })

    const response = await routesPost(
      makeRequest("POST", "/api/routes", {
        cookie: cookieA,
        body: { orderIds: [orderId], name: "Рейс: Москва — Тула" },
      }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.ordersCount).toBe(1)

    const route = rowOf("route", data.routeId)
    expect(route.organizationId).toBe(world.orgA)
    expect(route.vehicleId).toBeNull()
    expect(route.name).toBe("Рейс: Москва — Тула")

    const order = rowOf("order", orderId)
    expect(order.routeId).toBe(data.routeId)
    expect(order.status).toBe("in_route")
    expect(order.routeSequence).toBe(1)

    // переход «согласован → в рейсе» записан в ленту согласования
    const feed = negotiationRows(orderId)
    expect(feed.length).toBe(1)
    expect(feed[0].kind).toBe("status_change")
    expect(feed[0].organizationId).toBe(world.orgA)

    expectNoForeignIds(data, world)
  })

  it("несколько согласованных заказов — один рейс с порядком точек", async () => {
    const first = seedOrder("route3a", world.orgA, { status: "agreed", routeId: null })
    const second = seedOrder("route3b", world.orgA, { status: "agreed", routeId: null, routeTo: "Рязань" })

    const data = await jsonOf(
      await routesPost(
        makeRequest("POST", "/api/routes", { cookie: cookieA, body: { orderIds: [first, second] } }),
      ),
    )

    expect(data.success).toBe(true)
    expect(data.ordersCount).toBe(2)
    expect(rowOf("order", first).routeSequence).toBe(1)
    expect(rowOf("order", second).routeSequence).toBe(2)
    expect(rowOf("order", first).routeId).toBe(rowOf("order", second).routeId)
  })

  it("груз без заказа создаётся в рейсе и связывается со строкой базы", async () => {
    const cacheId = seedCacheRow("cache7")

    const data = await jsonOf(
      await routesPost(
        makeRequest("POST", "/api/routes", {
          cookie: cookieA,
          body: {
            orders: [
              {
                atiCacheId: cacheId,
                routeFrom: "Москва",
                routeTo: "Казань",
                distance: 800,
                weight: 5000,
                price: 45000,
                cargo: "Стройматериалы",
              },
            ],
          },
        }),
      ),
    )

    expect(data.success).toBe(true)
    const orders = memoryDb.rows("order").filter((row) => row.atiCacheId === cacheId)
    expect(orders.length).toBe(1)
    expect(orders[0].organizationId).toBe(world.orgA)
    expect(orders[0].status).toBe("in_route")
    // общая база не помечается: груз виден другим организациям
    expect(rowOf("atiCache", cacheId).status).toBe("new")
  })

  it("пустой рейс не создаётся — 400", async () => {
    const response = await routesPost(
      makeRequest("POST", "/api/routes", { cookie: cookieA, body: {} }),
    )
    expect(response.status).toBe(400)
  })
})
