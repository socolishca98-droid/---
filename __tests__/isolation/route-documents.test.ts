// __tests__/isolation/route-documents.test.ts
//
// Документы по маршруту (задача 3, пункт 3): GET /api/routes/[routeId]/documents.
//
// Проверяем, что документы собираются только по СВОЕМУ рейсу и с реквизитами
// СВОЕЙ организации: чужой рейс — 404, реквизиты и заказы другой организации
// не попадают в бланк, неизвестный вид документа — 400 (а не молчаливый
// полный комплект).
//
// Запуск: npm run test:isolation

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

import { GET as documentsGet } from "@/app/api/routes/[routeId]/documents/route"

let world: World
let cookieA: string
let cookieB: string
let cookieDriverA: string

function seedOrder(slug: string, overrides: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("order", {
    id,
    organizationId: world.orgA,
    routeId: world.routeA,
    assignedDriverId: world.driverA,
    assignedVehicleId: world.vehicleA,
    source: "manual",
    routeFrom: "Ярославль",
    routeTo: "Москва",
    distance: 270,
    weight: 12000,
    volume: 40,
    cargoType: "Бытовая техника",
    clientName: "ООО Ромашка",
    clientContact: "+7 495 000-00-00",
    paymentType: "bank",
    vatType: "vat20",
    deferredDays: 5,
    price: 45000,
    status: "in_route",
    routeSequence: 1,
    deadline: new Date("2026-09-30T00:00:00"),
    ...overrides,
  })
  return id
}

/** Реквизиты организации А — то, что печатается в бланке. */
function seedRequisites(carrier: string) {
  const settings = memoryDb.find("fleetSettings", world.settingsA)
  if (settings) {
    settings.parkName = "Автопарк А"
    settings.legalName = carrier
    settings.inn = "760100000000"
    settings.legalAddress = "150000, г. Ярославль, ул. Промышленная, д. 5"
    settings.signerName = "Фролов И. А."
    settings.signerPosition = "Индивидуальный предприниматель"
  }

  const foreign = memoryDb.find("fleetSettings", world.settingsB)
  if (foreign) {
    foreign.parkName = "Автопарк Б"
    foreign.legalName = "ООО Чужая Фирма"
    foreign.inn = "999999999999"
    foreign.legalAddress = "г. Псков, ул. Чужая, д. 1"
  }
}

async function callDocuments(routeId: string, cookie: string, types?: string) {
  const query = types === undefined ? "" : `?types=${encodeURIComponent(types)}`
  const response = await documentsGet(
    makeRequest("GET", `/api/routes/${routeId}/documents${query}`, { cookie }),
    routeContext({ routeId }),
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
  seedRequisites("ИП Фролов Иван Александрович")

  // заказы seedWorld уже привязаны к рейсам: каждый тест сам решает, что в рейсе
  for (const id of [world.orderA, world.orderB]) {
    const row = memoryDb.find("order", id)
    if (row) {
      row.routeId = null
      row.routeSequence = null
    }
  }
})

describe("документы по маршруту (GET /api/routes/[routeId]/documents)", () => {
  it("без сессии — 401, водительская сессия штабной роут не открывает", async () => {
    const anonymous = await documentsGet(
      makeRequest("GET", `/api/routes/${world.routeA}/documents`),
      routeContext({ routeId: world.routeA }),
    )
    expect(anonymous.status).toBe(401)

    const driver = await callDocuments(world.routeA, cookieDriverA)
    expect(driver.response.status).toBe(401)
  })

  it("чужой рейс — 404, документы по нему не собираются", async () => {
    seedOrder("docForeign")

    const foreign = await callDocuments(world.routeB, cookieA)
    expect(foreign.response.status).toBe(404)

    const own = await callDocuments(world.routeA, cookieA)
    expect(own.response.status).toBe(200)
  })

  it("по умолчанию — полный комплект: накладные и заявки по заказам, путевой лист один", async () => {
    seedOrder("docA1", { routeSequence: 1 })
    seedOrder("docA2", {
      routeSequence: 2,
      routeFrom: "Москва",
      routeTo: "Тверь",
      weight: 5000,
      price: 20000,
    })

    const { response, data } = await callDocuments(world.routeA, cookieA)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.kinds).toEqual(["ttn", "waybill", "contract"])
    expect(data.route.id).toBe(world.routeA)
    expect(data.route.ordersCount).toBe(2)
    expect(data.documents.map((doc: any) => doc.kind)).toEqual([
      "ttn",
      "ttn",
      "waybill",
      "contract",
      "contract",
    ])
  })

  it("в документах — реквизиты своей организации, машина и водитель своего рейса", async () => {
    seedOrder("docRequisites")
    const route = memoryDb.find("route", world.routeA)
    if (route) {
      route.name = "Рейс А"
      route.startedAt = new Date("2026-09-24T06:30:00")
    }
    const vehicle = memoryDb.find("vehicle", world.vehicleA)
    if (vehicle) {
      vehicle.brand = "Volvo"
      vehicle.model = "FH"
    }

    const { data } = await callDocuments(world.routeA, cookieA, "ttn,waybill")
    const ttn = data.documents.find((doc: any) => doc.kind === "ttn")
    const waybill = data.documents.find((doc: any) => doc.kind === "waybill")

    const carrierFields = Object.fromEntries(
      ttn.blocks
        .find((block: any) => block.title === "Перевозчик")
        .fields.map((field: any) => [field.label, field.value]),
    )
    expect(carrierFields["Наименование"]).toBe("ИП Фролов Иван Александрович")
    expect(carrierFields["ИНН"]).toBe("760100000000")

    // грузоотправитель — клиент из заказа, груз — из заказа
    const consignor = ttn.blocks.find((block: any) => block.title === "Грузоотправитель")
    expect(consignor.fields[0].value).toBe("ООО Ромашка")
    expect(ttn.tables[0].rows[0][2]).toBe("Бытовая техника")
    expect(ttn.tables[0].rows[0][5]).toBe("45 000 ₽")

    const crewFields = Object.fromEntries(
      waybill.blocks
        .find((block: any) => block.title === "Транспорт и водитель")
        .fields.map((field: any) => [field.label, field.value]),
    )
    expect(crewFields["Госномер"]).toBe("А001АА77")
    expect(crewFields["Марка, модель"]).toBe("Volvo FH")
    expect(crewFields["Водитель"]).toBe("Водитель А")

    const time = waybill.blocks.find((block: any) => block.title === "Время работы")
    expect(time.fields[0].value).toBe("24.09.2026 06:30")
  })

  it("реквизиты другой организации в документы не попадают", async () => {
    seedOrder("docNoLeak")

    const { data } = await callDocuments(world.routeA, cookieA)
    const payload = JSON.stringify(data)

    expect(payload).not.toContain("ООО Чужая Фирма")
    expect(payload).not.toContain("999999999999")
    expect(payload).not.toContain("г. Псков, ул. Чужая")
  })

  it("заказы другой организации в документы не попадают", async () => {
    seedOrder("docMine", { routeSequence: 1 })
    memoryDb.insert("order", {
      id: cid("docAlien"),
      organizationId: world.orgB,
      routeId: world.routeA,
      source: "manual",
      routeFrom: "Псков",
      routeTo: "Питер",
      distance: 300,
      weight: 1000,
      cargoType: "Чужой груз",
      clientName: "ООО Чужой Клиент",
      clientContact: "",
      price: 1,
      status: "in_route",
      deadline: new Date("2026-09-30T00:00:00"),
    })

    const { data } = await callDocuments(world.routeA, cookieA, "ttn")

    expect(data.documents).toHaveLength(1)
    expect(JSON.stringify(data)).not.toContain("Чужой груз")
    expect(data.route.ordersCount).toBe(1)
  })

  it("галочки: только путевой лист или только договор-заявки", async () => {
    seedOrder("docPick1", { routeSequence: 1 })
    seedOrder("docPick2", { routeSequence: 2 })

    const waybillOnly = await callDocuments(world.routeA, cookieA, "waybill")
    expect(waybillOnly.data.documents).toHaveLength(1)
    expect(waybillOnly.data.documents[0].kind).toBe("waybill")

    const contractsOnly = await callDocuments(world.routeA, cookieA, "contract")
    expect(contractsOnly.data.documents.map((doc: any) => doc.kind)).toEqual([
      "contract",
      "contract",
    ])
  })

  it("неизвестный вид документа — 400 со списком допустимых", async () => {
    seedOrder("docUnknown")

    const { response, data } = await callDocuments(world.routeA, cookieA, "ttn,накладная")

    expect(response.status).toBe(400)
    expect(data.allowed).toEqual(["ttn", "waybill", "contract"])
  })

  it("пустой рейс: печатается только путевой лист, без выдуманных заказов", async () => {
    const { data } = await callDocuments(world.routeA, cookieA)

    expect(data.route.ordersCount).toBe(0)
    expect(data.documents.map((doc: any) => doc.kind)).toEqual(["waybill"])
  })

  it("настройки другой организации читаются своей организацией", async () => {
    seedOrder("docSettingsB")

    // Организация Б видит свои реквизиты в своих документах
    const { data } = await callDocuments(world.routeB, cookieB)
    const payload = JSON.stringify(data)

    expect(payload).toContain("ООО Чужая Фирма")
    expect(payload).not.toContain("ИП Фролов Иван Александрович")
  })
})
