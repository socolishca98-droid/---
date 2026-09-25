// __tests__/isolation/payments.test.ts
//
// Оплаты (задача 6): /api/payments (GET/PATCH/POST) и /api/payments/export.
//
// Проверяем то, ради чего страница оплат и нужна: суммы и просрочка считаются по
// своим заказам, отметка оплаты не выходит за границы организации, напоминание —
// это настоящее уведомление логистам (и не чаще одного раза в день), а выгрузка
// для бухгалтерии не уводит чужие данные.

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import {
  cid,
  jsonOf,
  makeRequest,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

import { GET as paymentsGet, PATCH as paymentsPatch, POST as paymentsPost } from "@/app/api/payments/route"
import { GET as exportGet } from "@/app/api/payments/export/route"

let world: World
let cookieA: string
let cookieB: string
let cookieDriverA: string

const PAST = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
const TODAY = new Date()

function seedOrder(slug: string, extra: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("order", {
    id,
    organizationId: world.orgA,
    source: "manual",
    routeFrom: "Москва",
    routeTo: "Казань",
    distance: 800,
    weight: 1000,
    cargoType: "Груз",
    clientContact: "",
    clientName: "ООО Ромашка",
    status: "delivered",
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    deadline: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    price: 50000,
    isPaid: false,
    ...extra,
  })
  return id
}

function seedClient(slug: string, organizationId: string, name: string, extra: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("client", {
    id,
    organizationId,
    name,
    nameKey: name.toLowerCase().replace(/^ооо\s+/, "").trim(),
    source: "manual",
    ...extra,
  })
  return id
}

async function listPayments(cookie: string, query = "") {
  const response = await paymentsGet(makeRequest("GET", `/api/payments${query}`, { cookie }))
  return { response, data: await jsonOf(response) }
}

async function patchPayment(cookie: string, body: Record<string, unknown>) {
  const response = await paymentsPatch(makeRequest("PATCH", "/api/payments", { cookie, body }))
  return { response, data: await jsonOf(response) }
}

async function remind(cookie: string, body: Record<string, unknown>) {
  const response = await paymentsPost(makeRequest("POST", "/api/payments", { cookie, body }))
  return { response, data: await jsonOf(response) }
}

function remindersOf(organizationId: string) {
  return memoryDb
    .rows("notification")
    .filter((row) => row.organizationId === organizationId && row.type === "payment_overdue")
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

  // заказы seedWorld в оплатах не участвуют: у них нет суммы к выставлению
  for (const id of [world.orderA, world.orderB]) {
    const row = memoryDb.find("order", id)
    if (row) {
      row.price = null
      row.agreedPrice = null
    }
  }
})

describe("список оплат (GET /api/payments)", () => {
  it("без сессии — 401, водительская сессия оплат не видит", async () => {
    const anonymous = await listPayments("")
    expect(anonymous.response.status).toBe(401)

    const driver = await listPayments(cookieDriverA)
    expect(driver.response.status).toBe(401)
  })

  it("считает суммы, отсрочку и просрочку по своим заказам", async () => {
    seedOrder("paid", {
      price: 40000,
      isPaid: true,
      paidAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      dueDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    })
    seedOrder("waiting", { price: 30000, deferredDays: 20, dueDate: new Date(Date.now() + 5 * 86400000) })
    const overdueId = seedOrder("overdue", { price: 20000, dueDate: PAST })
    seedOrder("agreed", { price: 10000, agreedPrice: 15000 })

    const { response, data } = await listPayments(cookieA, "?tab=all")

    expect(response.status).toBe(200)
    expect(data.stats.totalOrders).toBe(4)
    expect(data.stats.totalRevenue).toBe(105000) // 40k + 30k + 20k + 15k (согласованная важнее)
    expect(data.stats.totalPaid).toBe(40000)
    expect(data.stats.totalPending).toBe(65000)
    expect(data.stats.totalDeferred).toBe(50000)
    expect(data.stats.deferredCount).toBe(2)
    expect(data.stats.totalOverdue).toBe(20000)
    expect(data.stats.overdueCount).toBe(1)
    expect(data.stats.avgPaymentDays).toBe(2) // оплатили на 2 дня раньше срока

    const overdueRow = data.orders.find((row: any) => row.id === overdueId)
    expect(overdueRow.overdueDays).toBe(10)
    expect(overdueRow.isOverdue).toBe(true)
  })

  it("чужие заказы и нулевые суммы в оплаты не попадают", async () => {
    const mineId = seedOrder("mine", { price: 20000 })
    const foreignId = seedOrder("foreign", { price: 999000, organizationId: world.orgB })
    seedOrder("empty", { price: 0 })

    const { data } = await listPayments(cookieA, "?tab=all")

    expect(data.orders.map((row: any) => row.id)).toEqual([mineId])
    expect(JSON.stringify(data)).not.toContain("999000")
    expect(JSON.stringify(data)).not.toContain(foreignId)
  })

  it("вкладки: ожидают, с отсрочкой, просрочены, оплачено", async () => {
    seedOrder("plain", { price: 10000 })
    const deferredId = seedOrder("deferred", {
      price: 20000,
      deferredDays: 14,
      dueDate: new Date(Date.now() + 86400000),
    })
    const overdueId = seedOrder("overdue", { price: 30000, dueDate: PAST })
    const paidId = seedOrder("paid", { price: 40000, isPaid: true, paidAt: TODAY })

    const pending = await listPayments(cookieA, "?tab=pending")
    expect(pending.data.orders).toHaveLength(3)

    const deferred = await listPayments(cookieA, "?tab=deferred")
    // список идёт по сроку оплаты: просроченное раньше будущего
    expect(deferred.data.orders.map((row: any) => row.id)).toEqual([overdueId, deferredId])

    const overdue = await listPayments(cookieA, "?tab=overdue")
    expect(overdue.data.orders.map((row: any) => row.id)).toEqual([overdueId])

    const paid = await listPayments(cookieA, "?tab=paid")
    expect(paid.data.orders.map((row: any) => row.id)).toEqual([paidId])

    // неизвестная вкладка не ломает запрос — отдаётся весь список
    const garbage = await listPayments(cookieA, "?tab=нет-такой")
    expect(garbage.data.orders).toHaveLength(4)
    expect(garbage.data.tab).toBe("all")

    // статистика считается по всей базе, а не по выбранной вкладке
    expect(overdue.data.stats.pendingCount).toBe(3)
    expect(overdue.data.stats.paidCount).toBe(1)
  })

  it("поиск по клиенту, городу и номеру заказа", async () => {
    seedOrder("romashka", { price: 10000, clientName: "ООО Ромашка", routeTo: "Казань" })
    const tulpanId = seedOrder("tulpan", {
      price: 20000,
      clientName: "ООО Тюльпан",
      routeFrom: "Питер",
      routeTo: "Новгород",
    })

    const byClient = await listPayments(cookieA, "?tab=all&q=тюльпан")
    expect(byClient.data.orders).toHaveLength(1)
    expect(byClient.data.orders[0].clientName).toBe("ООО Тюльпан")

    const byCity = await listPayments(cookieA, "?tab=all&q=казань")
    expect(byCity.data.orders).toHaveLength(1)

    const byId = await listPayments(cookieA, `?tab=all&q=${tulpanId}`)
    expect(byId.data.orders).toHaveLength(1)
  })

  it("должники группируются по клиенту: карточка, суммы и просрочка", async () => {
    const client = seedClient("romashka", world.orgA, "ООО Ромашка", { inn: "760100000000" })
    seedOrder("debt1", { clientId: client, clientName: "ООО Ромашка", price: 30000, dueDate: PAST })
    seedOrder("debt2", { clientId: client, clientName: "ООО Ромашка", price: 20000 })
    seedOrder("noCard1", { clientName: 'ООО "Тюльпан"', price: 10000, dueDate: PAST })
    seedOrder("noCard2", { clientName: "Тюльпан", price: 5000 })
    seedOrder("paid", { clientId: client, clientName: "ООО Ромашка", price: 70000, isPaid: true, paidAt: TODAY })

    const { data } = await listPayments(cookieA, "?tab=pending")

    expect(data.debtors).toHaveLength(2)

    const romashka = data.debtors.find((debtor: any) => debtor.clientId === client)
    expect(romashka.debt).toBe(50000)
    expect(romashka.ordersCount).toBe(2)
    expect(romashka.overdue).toBe(30000)
    expect(romashka.inn).toBe("760100000000")

    // «ООО "Тюльпан"» и «Тюльпан» — один должник, а не два
    const tulpan = data.debtors.find((debtor: any) => debtor.clientId === null)
    expect(tulpan.debt).toBe(15000)
    expect(tulpan.ordersCount).toBe(2)

    // оплаченный заказ в долги не попал
    expect(data.debtors.reduce((sum: number, debtor: any) => sum + debtor.ordersCount, 0)).toBe(4)
  })
})

describe("условия и отметка оплаты (PATCH /api/payments)", () => {
  it("чужой заказ — 404, ничего не меняется", async () => {
    const foreign = seedOrder("foreign", { price: 50000, organizationId: world.orgB })

    const { response } = await patchPayment(cookieA, { orderId: foreign, isPaid: true })

    expect(response.status).toBe(404)
    expect(memoryDb.find("order", foreign)?.isPaid).toBe(false)
  })

  it("отметка оплаты фиксирует дату, снятие — возвращает в работу", async () => {
    const orderId = seedOrder("mine", { price: 50000 })

    const paid = await patchPayment(cookieA, { orderId, isPaid: true })
    expect(paid.response.status).toBe(200)
    expect(paid.data.order.isPaid).toBe(true)
    expect(paid.data.order.paidAt).toBeTruthy()

    const listAfterPaid = await listPayments(cookieA, "?tab=pending")
    expect(listAfterPaid.data.orders).toHaveLength(0)

    const reset = await patchPayment(cookieA, { orderId, isPaid: false })
    expect(reset.data.order.isPaid).toBe(false)
    expect(reset.data.order.paidAt).toBeNull()
  })

  it("отсрочка считает срок так же, как список платежей: доставка → срок заказа → оформление", async () => {
    // 1) есть фактическая доставка — срок считаем от неё
    const delivered = seedOrder("mine", {
      price: 50000,
      createdAt: new Date("2026-09-01T10:00:00"),
      deadline: new Date("2026-09-05T10:00:00"),
      deliveredAt: new Date("2026-09-10T10:00:00"),
    })

    const byDelivery = await patchPayment(cookieA, { orderId: delivered, deferredDays: 14 })

    expect(byDelivery.data.order.deferredDays).toBe(14)
    expect(new Date(byDelivery.data.order.dueDate).toISOString().slice(0, 10)).toBe("2026-09-24")

    // сохранённый срок и то, что показывает список платежей, — одна и та же дата
    const list = await listPayments(cookieA, "?tab=all")
    const row = list.data.orders.find((item: { id: string }) => item.id === delivered)
    expect(new Date(row.dueDate).toISOString().slice(0, 10)).toBe("2026-09-24")

    // 2) доставки ещё не было — берём срок по заказу
    const planned = seedOrder("mine2", {
      price: 50000,
      createdAt: new Date("2026-09-01T10:00:00"),
      deadline: new Date("2026-09-05T10:00:00"),
      deliveredAt: null,
    })

    const byDeadline = await patchPayment(cookieA, { orderId: planned, deferredDays: 14 })
    expect(new Date(byDeadline.data.order.dueDate).toISOString().slice(0, 10)).toBe("2026-09-19")

    // снятие отсрочки убирает и срок
    const cleared = await patchPayment(cookieA, { orderId: delivered, deferredDays: null })
    expect(cleared.data.order.dueDate).toBeNull()
  })

  it("мусор в полях отклоняется понятной ошибкой", async () => {
    const orderId = seedOrder("mine", { price: 50000 })

    const badDays = await patchPayment(cookieA, { orderId, deferredDays: 9999 })
    expect(badDays.response.status).toBe(400)
    expect(badDays.data.error).toContain("0 до 365")

    const badPrice = await patchPayment(cookieA, { orderId, price: -100 })
    expect(badPrice.response.status).toBe(400)

    const badDate = await patchPayment(cookieA, { orderId, dueDate: "не дата" })
    expect(badDate.response.status).toBe(400)

    const unknown = await patchPayment(cookieA, { orderId, isPaid: true, clientId: world.orgB })
    expect(unknown.response.status).toBe(400)
    expect(unknown.data.error).toContain("clientId")

    expect(memoryDb.find("order", orderId)?.isPaid).toBe(false)
  })
})

describe("напоминания о просрочке (POST /api/payments)", () => {
  it("создаёт уведомление логистам организации и не повторяет его в тот же день", async () => {
    const orderId = seedOrder("overdue", { price: 45000, dueDate: PAST, clientContact: "+79000000001" })

    const first = await remind(cookieA, { orderId })
    expect(first.response.status).toBe(200)
    expect(first.data.created).toBe(1)
    expect(first.data.totalAmount).toBe(45000)

    const created = remindersOf(world.orgA)
    expect(created).toHaveLength(1)
    expect(created[0].userRole).toBe("logist")
    expect(created[0].orderId).toBe(orderId)
    expect(created[0].title).toBe("Просрочена оплата")
    expect(String(created[0].message)).toContain("10 дн.")
    expect(remindersOf(world.orgB)).toHaveLength(0)

    // повтор в тот же день — не новый спам, а понятный ответ
    const second = await remind(cookieA, { orderId })
    expect(second.data.created).toBe(0)
    expect(second.data.skipped).toBe(1)
    expect(remindersOf(world.orgA)).toHaveLength(1)

    // напоминание видно в списке оплат
    const { data } = await listPayments(cookieA, "?tab=overdue")
    expect(data.orders[0].reminderCount).toBe(1)
    expect(data.orders[0].remindedAt).toBeTruthy()
  })

  it("«напомнить всем» обходит все просроченные и не трогает оплаченные", async () => {
    const overdue1 = seedOrder("overdue1", { price: 10000, dueDate: PAST })
    const overdue2 = seedOrder("overdue2", { price: 20000, dueDate: new Date(Date.now() - 3 * 86400000) })
    seedOrder("waiting", { price: 30000, dueDate: new Date(Date.now() + 86400000) })
    seedOrder("paid", { price: 40000, isPaid: true, paidAt: TODAY, dueDate: PAST })

    const { response, data } = await remind(cookieA, { allOverdue: true })

    expect(response.status).toBe(200)
    expect(data.created).toBe(2)
    expect(data.totalAmount).toBe(30000)

    const created = remindersOf(world.orgA)
    expect(created).toHaveLength(2)
    expect(created.map((row) => row.orderId).sort()).toEqual([overdue1, overdue2].sort())
  })

  it("чужие заказы не напоминают и напоминаний по ним нет", async () => {
    const foreign = seedOrder("foreign", { price: 50000, dueDate: PAST, organizationId: world.orgB })

    const single = await remind(cookieA, { orderId: foreign })
    expect(single.response.status).toBe(404)

    const bulk = await remind(cookieA, { allOverdue: true })
    expect(bulk.data.created).toBe(0)
    expect(remindersOf(world.orgA)).toHaveLength(0)
    expect(remindersOf(world.orgB)).toHaveLength(0)
  })

  it("без просрочек — понятный ответ, а не пустое уведомление", async () => {
    seedOrder("waiting", { price: 30000, dueDate: new Date(Date.now() + 86400000) })

    const { data } = await remind(cookieA, { allOverdue: true })

    expect(data.created).toBe(0)
    expect(data.message).toContain("Просроченных оплат нет")
    expect(remindersOf(world.orgA)).toHaveLength(0)
  })

  it("без orderId и allOverdue — 400", async () => {
    const { response, data } = await remind(cookieA, {})

    expect(response.status).toBe(400)
    expect(data.error).toContain("orderId")
  })
})

describe("выгрузка для бухгалтерии (GET /api/payments/export)", () => {
  it("CSV своей организации: BOM, заголовки и суммы; чужие данные не попадают", async () => {
    const mineId = seedOrder("mine", {
      price: 45000,
      clientName: "ООО Ромашка",
      clientContact: "+79000000001",
      dueDate: PAST,
      paymentType: "bank_transfer",
      vatType: "vat20",
    })
    seedOrder("foreign", {
      price: 999000,
      clientName: "ООО Чужой",
      organizationId: world.orgB,
    })

    const response = await exportGet(makeRequest("GET", "/api/payments/export?tab=pending", { cookie: cookieA }))
    // Response.text() по стандарту съедает BOM, поэтому проверяем исходные байты
    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    const csv = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/csv")
    expect(response.headers.get("content-disposition")).toContain("payments-pending-")
    expect(response.headers.get("x-payments-count")).toBe("1")
    expect(response.headers.get("x-payments-pending")).toBe("45000")

    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    expect(csv).toContain("Заказ;Дата заказа;Клиент;ИНН;")
    expect(csv).toContain("ООО Ромашка")
    expect(csv).toContain("45000")
    expect(csv).toContain("НДС 20%")
    expect(csv).toContain("Безнал")
    expect(csv).toContain("Просрочен на 10 дн.")
    expect(csv).toContain(mineId)

    expect(csv).not.toContain("999000")
    expect(csv).not.toContain("ООО Чужой")
  })

  it("выгрузка чужой сессии не содержит заказов соседней организации", async () => {
    const mineId = seedOrder("mine", { price: 10000 })
    seedOrder("foreign", { price: 20000, organizationId: world.orgB })

    const responseB = await exportGet(makeRequest("GET", "/api/payments/export", { cookie: cookieB }))
    const csvB = await responseB.text()

    expect(responseB.headers.get("x-payments-count")).toBe("1")
    expect(csvB).toContain("20000")
    expect(csvB).not.toContain(mineId)
  })

  it("без сессии — 401", async () => {
    const response = await exportGet(makeRequest("GET", "/api/payments/export"))
    expect(response.status).toBe(401)
  })
})
