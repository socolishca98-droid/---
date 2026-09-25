// __tests__/isolation/clients.test.ts
//
// Клиентская база (задача 5): /api/clients, /api/clients/[clientId],
// /api/clients/import и фильтры фотографий по клиенту.
//
// Проверяем то, ради чего база и заводится: клиент видит только свои заказы,
// статистика считается по ним же, импорт не заводит дублей и раскладывает
// существующие заказы по карточкам — и всё это строго внутри организации.

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import {
  cid,
  jsonOf,
  makeRequest,
  routeContext,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

import { GET as clientsGet, POST as clientsPost } from "@/app/api/clients/route"
import {
  DELETE as clientDelete,
  GET as clientGet,
  PATCH as clientPatch,
} from "@/app/api/clients/[clientId]/route"
import { POST as importPost } from "@/app/api/clients/import/route"
import { GET as photosGet } from "@/app/api/photos/route"

let world: World
let cookieA: string
let cookieB: string
let cookieDriverA: string

function seedClient(slug: string, organizationId: string, extra: Record<string, unknown> = {}) {
  const name = (extra.name as string) ?? `ООО ${slug}`
  const id = cid(slug)
  memoryDb.insert("client", {
    id,
    organizationId,
    name,
    nameKey: String(name).toLowerCase().replace(/^ооо\s+/, "").trim(),
    source: "manual",
    ...extra,
  })
  return id
}

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
    status: "delivered",
    price: 50000,
    agreedPrice: null,
    isPaid: false,
    dueDate: null,
    createdAt: new Date("2026-09-01T00:00:00"),
    deadline: new Date("2026-09-10T00:00:00"),
    ...extra,
  })
  return id
}

async function listClients(cookie: string, query = "") {
  const response = await clientsGet(makeRequest("GET", `/api/clients${query}`, { cookie }))
  return { response, data: await jsonOf(response) }
}

async function callCard(clientId: string, cookie: string) {
  const response = await clientGet(
    makeRequest("GET", `/api/clients/${clientId}`, { cookie }),
    routeContext({ clientId }),
  )
  return { response, data: await jsonOf(response) }
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

  // заказы seedWorld отвязываем: каждый тест сам решает, что к какому клиенту
  for (const id of [world.orderA, world.orderB]) {
    const row = memoryDb.find("order", id)
    if (row) {
      row.clientId = null
      row.clientName = `Клиент ${id}`
    }
  }
})

describe("клиентская база (GET/POST /api/clients)", () => {
  it("без сессии — 401, водительская сессия штабной роут не открывает", async () => {
    const anonymous = await listClients("")
    expect(anonymous.response.status).toBe(401)

    const driver = await listClients(cookieDriverA)
    expect(driver.response.status).toBe(401)
  })

  it("список содержит только своих клиентов и их статистику", async () => {
    const mine = seedClient("romashka", world.orgA, { name: "ООО Ромашка", inn: "760100000000" })
    seedClient("tulpan", world.orgB, { name: "ООО Тюльпан", organizationId: world.orgB })

    seedOrder("paidOrder", { clientId: mine, isPaid: true, paidAt: new Date("2026-09-10T00:00:00") })
    seedOrder("debtOrder", {
      clientId: mine,
      status: "control",
      price: 30000,
      dueDate: new Date("2026-09-20T00:00:00"),
    })
    // чужой заказ того же клиента быть не может: проверяем, что чужой клиент не виден
    seedOrder("alienOrder", {
      clientId: cid("tulpan"),
      organizationId: world.orgB,
      price: 999000,
    })

    const { response, data } = await listClients(cookieA)

    expect(response.status).toBe(200)
    expect(data.total).toBe(1)
    expect(data.clients[0].id).toBe(mine)
    expect(data.clients[0].stats.total).toBe(2)
    expect(data.clients[0].stats.paidRub).toBe(50000)
    expect(data.clients[0].stats.unpaidRub).toBe(30000)
    expect(data.clients[0].stats.overdueRub).toBe(30000)
    expect(data.clients[0].stats.overdueCount).toBe(1)
    expect(JSON.stringify(data)).not.toContain("Тюльпан")
    expect(JSON.stringify(data)).not.toContain("999000")
  })

  it("поиск по названию, ИНН и телефону", async () => {
    seedClient("romashka", world.orgA, { name: "ООО Ромашка", inn: "760100000000" })
    seedClient("tulpan", world.orgA, { name: "ООО Тюльпан", phone: "+79000000002" })

    const byName = await listClients(cookieA, "?search=ромаш")
    expect(byName.data.total).toBe(1)
    expect(byName.data.clients[0].name).toBe("ООО Ромашка")

    const byInn = await listClients(cookieA, "?search=7601000000")
    expect(byInn.data.total).toBe(1)

    const byPhone = await listClients(cookieA, "?search=9000000002")
    expect(byPhone.data.total).toBe(1)
    expect(byPhone.data.clients[0].name).toBe("ООО Тюльпан")
  })

  it("дубликат по названию — 409, а не вторая карточка", async () => {
    seedClient("romashka", world.orgA, { name: "ООО Ромашка" })

    const response = await clientsPost(
      makeRequest("POST", "/api/clients", {
        cookie: cookieA,
        body: { name: 'ООО "Ромашка"' },
      }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(409)
    expect(data.error).toContain("уже есть")
    expect(memoryDb.rows("client").filter((row) => row.organizationId === world.orgA)).toHaveLength(1)
  })

  it("создание приводит телефон, ИНН и отсрочку к одному виду", async () => {
    const response = await clientsPost(
      makeRequest("POST", "/api/clients", {
        cookie: cookieA,
        body: {
          name: "ООО Ромашка",
          phone: "8 (900) 000-00-01",
          inn: "760 100 000 000",
          kpp: "760101001",
          deferredDays: "14 дней",
          paymentType: "безнал",
        },
      }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.client.phone).toBe("+79000000001")
    expect(data.client.inn).toBe("760100000000")
    expect(data.client.deferredDays).toBe(14)
    expect(data.client.paymentType).toBe("bank")
    expect(data.client.nameKey).toBe("ромашка")
  })

  it("неизвестные поля отклоняются", async () => {
    const response = await clientsPost(
      makeRequest("POST", "/api/clients", {
        cookie: cookieA,
        body: { name: "ООО Ромашка", organizationId: world.orgB },
      }),
    )

    expect(response.status).toBe(400)
  })
})

describe("карточка клиента (GET/PATCH/DELETE /api/clients/[clientId])", () => {
  it("чужой клиент — 404 на чтение, правку и удаление", async () => {
    const alien = seedClient("alien", world.orgB, { name: "ООО Чужой" })

    const read = await callCard(alien, cookieA)
    expect(read.response.status).toBe(404)

    const patch = await clientPatch(
      makeRequest("PATCH", `/api/clients/${alien}`, { cookie: cookieA, body: { name: "Новое" } }),
      routeContext({ clientId: alien }),
    )
    expect(patch.status).toBe(404)

    const remove = await clientDelete(
      makeRequest("DELETE", `/api/clients/${alien}`, { cookie: cookieA }),
      routeContext({ clientId: alien }),
    )
    expect(remove.status).toBe(404)

    expect(memoryDb.find("client", alien)?.name).toBe("ООО Чужой")
  })

  it("карточка отдаёт историю заказов и статистику клиента", async () => {
    const client = seedClient("romashka", world.orgA, { name: "ООО Ромашка" })
    seedOrder("history1", { clientId: client, createdAt: new Date("2026-09-05T00:00:00") })
    const cancelledOrder = seedOrder("history2", {
      clientId: client,
      status: "cancelled",
      createdAt: new Date("2026-09-06T00:00:00"),
    })
    seedOrder("otherClient", { clientId: null, createdAt: new Date("2026-09-07T00:00:00") })

    const { response, data } = await callCard(client, cookieA)

    expect(response.status).toBe(200)
    expect(data.client.name).toBe("ООО Ромашка")
    expect(data.orders).toHaveLength(2)
    expect(data.orders[0].id).toBe(cancelledOrder)
    expect(data.stats.total).toBe(2)
    expect(data.stats.delivered).toBe(1)
    expect(data.stats.cancelled).toBe(1)
    expect(data.stats.reliabilityPercent).toBe(50)
    // заказ другого клиента в историю не попадает
    expect(JSON.stringify(data)).not.toContain(cid("otherClient"))
  })

  it("правка: переименование в занятое имя — 409, своё имя — ок", async () => {
    const first = seedClient("romashka", world.orgA, { name: "ООО Ромашка" })
    seedClient("tulpan", world.orgA, { name: "ООО Тюльпан" })

    const conflict = await clientPatch(
      makeRequest("PATCH", `/api/clients/${first}`, {
        cookie: cookieA,
        body: { name: "Тюльпан" },
      }),
      routeContext({ clientId: first }),
    )
    expect(conflict.status).toBe(409)

    const ok = await clientPatch(
      makeRequest("PATCH", `/api/clients/${first}`, {
        cookie: cookieA,
        body: { name: "ООО Ромашка Плюс", contactName: "Пётр" },
      }),
      routeContext({ clientId: first }),
    )
    const data = await jsonOf(ok)

    expect(ok.status).toBe(200)
    expect(data.client.name).toBe("ООО Ромашка Плюс")
    expect(data.client.nameKey).toBe("ромашка плюс")
    expect(data.client.contactName).toBe("Пётр")
  })

  it("удаление клиента с заказами — 409 со счётчиком", async () => {
    const client = seedClient("busy", world.orgA, { name: "ООО Занятой" })
    seedOrder("busyOrder", { clientId: client })

    const response = await clientDelete(
      makeRequest("DELETE", `/api/clients/${client}`, { cookie: cookieA }),
      routeContext({ clientId: client }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(409)
    expect(data.ordersCount).toBe(1)
    expect(memoryDb.find("client", client)).toBeTruthy()
  })

  it("клиент без заказов удаляется", async () => {
    const client = seedClient("free", world.orgA, { name: "ООО Свободный" })

    const response = await clientDelete(
      makeRequest("DELETE", `/api/clients/${client}`, { cookie: cookieA }),
      routeContext({ clientId: client }),
    )

    expect(response.status).toBe(200)
    expect(memoryDb.find("client", client)).toBeUndefined()
  })
})

describe("импорт клиентской базы (POST /api/clients/import)", () => {
  it("без сессии — 401; пустой файл — 400", async () => {
    const anonymous = await importPost(
      makeRequest("POST", "/api/clients/import", { body: { text: "Наименование\nООО Ромашка" } }),
    )
    expect(anonymous.status).toBe(401)

    const empty = await importPost(
      makeRequest("POST", "/api/clients/import", { cookie: cookieA, body: { text: "   " } }),
    )
    expect(empty.status).toBe(400)
  })

  it("предпросмотр: раскладывает колонки и ничего не пишет в базу", async () => {
    const text = [
      "Наименование;Телефон;ИНН/КПП;Отсрочка",
      "ООО Ромашка;+79000000001;760100000000/760101001;14 дней",
      "ООО Тюльпан;+79000000002;760100000012;",
    ].join("\n")

    const response = await importPost(
      makeRequest("POST", "/api/clients/import", { cookie: cookieA, body: { text } }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.applied).toBe(false)
    expect(data.preview.rows).toHaveLength(2)
    expect(data.preview.rows[0].fields.inn).toBe("760100000000")
    expect(data.preview.rows[0].fields.kpp).toBe("760101001")
    expect(data.preview.rows[0].fields.deferredDays).toBe(14)
    expect(data.plan.summary.create).toBe(2)

    // в базу ничего не записали
    expect(memoryDb.rows("client")).toHaveLength(0)
  })

  it("импорт создаёт карточки и привязывает к ним существующие заказы по имени", async () => {
    const orderId = seedOrder("existingOrder", {
      clientName: 'ООО "Ромашка"',
      clientId: null,
    })

    const text = ["Контрагент;Телефон", "ООО Ромашка;+79000000001", "ООО Тюльпан;+79000000002"].join("\n")

    const response = await importPost(
      makeRequest("POST", "/api/clients/import", {
        cookie: cookieA,
        body: { text, apply: true, mode: "merge" },
      }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.applied).toBe(true)
    expect(data.result.created).toBe(2)
    expect(data.result.linkedOrders).toBe(1)

    const clients = memoryDb.rows("client").filter((row) => row.organizationId === world.orgA)
    expect(clients).toHaveLength(2)
    expect(clients.every((row) => row.source === "import")).toBe(true)

    // заказ нашёл своего клиента, хотя имя было записано по-другому
    const linked = memoryDb.find("order", orderId)
    const romashka = clients.find((row) => row.nameKey === "ромашка")
    expect(linked?.clientId).toBe(romashka?.id)
  })

  it("повторный импорт не заводит дублей, а дополняет карточку", async () => {
    const text = ["Наименование;Телефон", "ООО Ромашка;+79000000001"].join("\n")

    await importPost(
      makeRequest("POST", "/api/clients/import", {
        cookie: cookieA,
        body: { text, apply: true, mode: "merge" },
      }),
    )

    const second = ["Наименование;Телефон;Контактное лицо", "ООО Ромашка;+79000000001;Пётр"].join("\n")
    const response = await importPost(
      makeRequest("POST", "/api/clients/import", {
        cookie: cookieA,
        body: { text: second, apply: true, mode: "merge" },
      }),
    )
    const data = await jsonOf(response)

    const clients = memoryDb.rows("client").filter((row) => row.organizationId === world.orgA)
    expect(clients).toHaveLength(1)
    expect(data.result.created).toBe(0)
    expect(data.result.updated).toBe(1)
    // заполнилось только пустое поле, телефон остался прежним
    expect(clients[0].contactName).toBe("Пётр")
    expect(clients[0].phone).toBe("+79000000001")
  })

  it("режим «только новые» существующих клиентов не трогает", async () => {
    const existing = seedClient("romashka", world.orgA, { name: "ООО Ромашка", contactName: "Пётр" })

    const text = ["Наименование;Контактное лицо", "ООО Ромашка;Иван", "ООО Тюльпан;Мария"].join("\n")

    const response = await importPost(
      makeRequest("POST", "/api/clients/import", {
        cookie: cookieA,
        body: { text, apply: true, mode: "add" },
      }),
    )
    const data = await jsonOf(response)

    expect(data.result.created).toBe(1)
    expect(data.result.updated).toBe(0)
    expect(data.result.skipped).toBe(1)

    const romashka = memoryDb.find("client", existing)
    expect(romashka?.contactName).toBe("Пётр")
  })

  it("импорт не видит и не трогает клиентов чужой организации", async () => {
    const alienClient = seedClient("alien", world.orgB, { name: "ООО Ромашка", contactName: "Чужой" })

    const text = ["Наименование;Контактное лицо", "ООО Ромашка;Наш"].join("\n")

    const response = await importPost(
      makeRequest("POST", "/api/clients/import", {
        cookie: cookieA,
        body: { text, apply: true, mode: "merge" },
      }),
    )
    const data = await jsonOf(response)

    // для организации А это новый клиент, чужую карточку не обновили
    expect(data.result.created).toBe(1)
    expect(memoryDb.find("client", alienClient)?.contactName).toBe("Чужой")

    const clientsA = memoryDb.rows("client").filter((row) => row.organizationId === world.orgA)
    const clientsB = memoryDb.rows("client").filter((row) => row.organizationId === world.orgB)
    expect(clientsA).toHaveLength(1)
    expect(clientsB).toHaveLength(1)
  })
})

describe("фотографии по клиенту (GET /api/photos?clientId=)", () => {
  function seedPhoto(slug: string, orderId: string | null, extra: Record<string, unknown> = {}) {
    const id = cid(slug)
    memoryDb.insert("photo", {
      id,
      organizationId: world.orgA,
      url: `/uploads/${slug}.jpg`,
      type: "cargo",
      driverId: world.driverA,
      orderId,
      createdAt: new Date(),
      ...extra,
    })
    return id
  }

  it("отдаёт фото заказов клиента и не отдаёт чужие", async () => {
    const client = seedClient("romashka", world.orgA, { name: "ООО Ромашка" })
    const ownOrder = seedOrder("clientOrder", { clientId: client })
    const otherOrder = seedOrder("otherOrder", { clientId: null })

    const wanted = seedPhoto("clientPhoto", ownOrder)
    seedPhoto("otherPhoto", otherOrder)

    const response = await photosGet(
      makeRequest("GET", `/api/photos?clientId=${client}`, { cookie: cookieA }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.photos).toHaveLength(1)
    expect(data.photos[0].id).toBe(wanted)
  })

  it("фильтр по рейсу и машине тоже работает по своим заказам", async () => {
    const routeId = cid("filterRoute")
    const vehicleId = cid("filterVehicle")

    const byRoute = seedOrder("routeOrder", {
      routeId,
      assignedVehicleId: vehicleId,
      organizationId: world.orgA,
    })
    const photoId = seedPhoto("routePhoto", byRoute)

    const viaRoute = await jsonOf(
      await photosGet(makeRequest("GET", `/api/photos?routeId=${routeId}`, { cookie: cookieA })),
    )
    expect(viaRoute.photos.map((photo: any) => photo.id)).toEqual([photoId])

    const viaVehicle = await jsonOf(
      await photosGet(
        makeRequest("GET", `/api/photos?vehicleId=${vehicleId}`, { cookie: cookieA }),
      ),
    )
    expect(viaVehicle.photos.map((photo: any) => photo.id)).toEqual([photoId])

    // чужая сессия по тем же фильтрам не получает ничего
    const foreign = await jsonOf(
      await photosGet(makeRequest("GET", `/api/photos?routeId=${routeId}`, { cookie: cookieB })),
    )
    expect(foreign.photos).toHaveLength(0)
  })
})
