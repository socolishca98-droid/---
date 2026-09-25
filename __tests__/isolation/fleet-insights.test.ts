// __tests__/isolation/fleet-insights.test.ts
//
// Сводка по автопарку (задача 4): GET /api/fleet/insights.
//
// Проверяем главное: простой, обслуживание и история назначений считаются
// ТОЛЬКО по машинам, водителям и рейсам своей организации. Чужие номера,
// водители и названия рейсов не должны попасть в ответ даже в виде счётчиков.

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

import { GET as insightsGet } from "@/app/api/fleet/insights/route"

let world: World
let cookieA: string
let cookieB: string
let cookieDriverA: string

/** Машина организации с заданными сроками. */
function seedVehicle(slug: string, organizationId: string, extra: Record<string, unknown> = {}) {
  const id = cid(slug)
  memoryDb.insert("vehicle", {
    id,
    organizationId,
    plate: `Х${slug.toUpperCase()}Х76`,
    type: "truck",
    brand: "Volvo",
    model: "FH",
    capacity: 20000,
    status: "available",
    createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
    ...extra,
  })
  return id
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function daysAhead(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

async function callInsights(cookie?: string, query = "") {
  const response = await insightsGet(
    makeRequest("GET", `/api/fleet/insights${query}`, { cookie }),
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

  // Машины seedWorld убираем из расчёта: сводка считает ВСЕ машины организации,
  // и каждый тест задаёт свои. Заказы отвязываем от машин, чтобы не занимали их.
  for (const id of [world.vehicleA, world.vehicleB]) memoryDb.remove("vehicle", id)
  for (const id of [world.routeA, world.routeB]) {
    const row = memoryDb.find("route", id)
    if (row) {
      row.vehicleId = null
      row.driverId = null
    }
  }
  for (const id of [world.orderA, world.orderB]) {
    const row = memoryDb.find("order", id)
    if (row) {
      row.routeId = null
      row.assignedVehicleId = null
    }
  }
})

describe("сводка по автопарку (GET /api/fleet/insights)", () => {
  it("без сессии — 401, водительская сессия штабной роут не открывает", async () => {
    const anonymous = await callInsights()
    expect(anonymous.response.status).toBe(401)

    const driver = await callInsights(cookieDriverA)
    expect(driver.response.status).toBe(401)
  })

  it("простой и обслуживание считаются по своим машинам", async () => {
    const idle = seedVehicle("idleA", world.orgA, {
      nextMaintenanceDate: daysAhead(5),
    })
    const working = seedVehicle("workA", world.orgA)
    const insured = seedVehicle("insuranceA", world.orgA, { insuranceExpiry: daysAgo(3) })

    memoryDb.insert("order", {
      id: cid("orderWorkA"),
      organizationId: world.orgA,
      assignedVehicleId: working,
      assignedDriverId: world.driverA,
      routeFrom: "Москва",
      routeTo: "Тверь",
      status: "control",
      source: "manual",
      cargoType: "Груз",
      clientContact: "",
      distance: 100,
      weight: 1000,
      deadline: daysAhead(3),
    })

    const { response, data } = await callInsights(cookieA)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.summary.working).toBe(1)
    expect(data.summary.idle).toBe(2)
    expect(data.idle.map((item: any) => item.vehicleId).sort()).toEqual([idle, insured].sort())

    // 5 дней до ТО — «скоро»; страховка просрочена на 3 дня
    const kinds = data.service.map((item: any) => [item.kind, item.status])
    expect(kinds).toContainEqual(["insurance", "overdue"])
    expect(kinds).toContainEqual(["maintenance", "soon"])
    expect(data.summary.serviceOverdue).toBe(1)
  })

  it("история назначений: свои рейсы, имена своих водителей", async () => {
    const vehicle = seedVehicle("historyA", world.orgA)

    memoryDb.insert("route", {
      id: cid("routeHistoryA"),
      organizationId: world.orgA,
      name: "Рейс А: Москва — Тверь",
      status: "completed",
      vehicleId: vehicle,
      driverId: world.driverA,
      createdAt: daysAgo(5),
      startedAt: daysAgo(5),
      completedAt: daysAgo(4),
    })

    const { data } = await callInsights(cookieA)

    const history = data.history[vehicle]
    expect(history).toHaveLength(1)
    expect(history[0].driverName).toBe("Водитель А")
    expect(history[0].routeName).toBe("Рейс А: Москва — Тверь")
    expect(history[0].isActive).toBe(false)
  })

  it("данные чужой организации в сводку не попадают", async () => {
    const mine = seedVehicle("mineA", world.orgA)
    const alien = seedVehicle("alienB", world.orgB, {
      nextMaintenanceDate: daysAhead(2),
      insuranceExpiry: daysAgo(10),
    })

    // у своей машины рейс есть — история должна содержать только его
    memoryDb.insert("route", {
      id: cid("routeMineA"),
      organizationId: world.orgA,
      name: "Рейс А: Москва — Казань",
      status: "completed",
      vehicleId: mine,
      driverId: world.driverA,
      createdAt: daysAgo(6),
      startedAt: daysAgo(6),
      completedAt: daysAgo(5),
    })

    memoryDb.insert("route", {
      id: cid("routeAlienB"),
      organizationId: world.orgB,
      name: "Рейс Б: Псков — Питер",
      status: "completed",
      vehicleId: alien,
      driverId: world.driverB,
      createdAt: daysAgo(9),
      startedAt: daysAgo(9),
      completedAt: daysAgo(8),
    })
    memoryDb.insert("maintenanceLog", {
      id: cid("maintAlienB"),
      organizationId: world.orgB,
      vehicleId: alien,
      type: "repair",
      description: "Чужой ремонт",
      status: "in_progress",
      startedAt: daysAgo(2),
    })

    const { data } = await callInsights(cookieA)
    const payload = JSON.stringify(data)

    expect(Object.keys(data.history)).toEqual([mine])
    expect(payload).not.toContain(cid("alienB"))
    expect(payload).not.toContain("Рейс Б")
    expect(payload).not.toContain("Чужой ремонт")
    expect(payload).not.toContain(world.driverB)
    expect(data.openMaintenance).toHaveLength(0)
  })

  it("организация Б видит свои данные, не видя данных А", async () => {
    seedVehicle("onlyA", world.orgA)
    const bVehicle = seedVehicle("onlyB", world.orgB)

    const { data } = await callInsights(cookieB)

    expect(data.summary.vehicles).toBe(1)
    expect(data.idle.map((item: any) => item.vehicleId)).toEqual([bVehicle])
    expect(JSON.stringify(data)).not.toContain(cid("onlyA"))
  })

  it("открытые работы по своей машине видны с числом дней", async () => {
    const vehicle = seedVehicle("maintenanceA", world.orgA, { status: "maintenance" })

    memoryDb.insert("maintenanceLog", {
      id: cid("maintA"),
      organizationId: world.orgA,
      vehicleId: vehicle,
      type: "repair",
      description: "Замена колодок",
      status: "in_progress",
      startedAt: daysAgo(3),
    })

    const { data } = await callInsights(cookieA)

    expect(data.openMaintenance).toHaveLength(1)
    expect(data.openMaintenance[0].description).toBe("Замена колодок")
    expect(data.openMaintenance[0].daysOpen).toBe(3)
    // машина на ТО не считается простаивающей
    expect(data.idle).toHaveLength(0)
  })

  it("окно предупреждения задаётся параметром и ограничено", async () => {
    seedVehicle("warnA", world.orgA, { nextMaintenanceDate: daysAhead(60) })

    const wide = await callInsights(cookieA, "?warningDays=90")
    expect(wide.data.warningDays).toBe(90)
    expect(wide.data.service).toHaveLength(1)

    const narrow = await callInsights(cookieA, "?warningDays=7")
    expect(narrow.data.service).toHaveLength(0)

    // мусор в параметре не ломает запрос — берётся значение по умолчанию
    const broken = await callInsights(cookieA, "?warningDays=abc")
    expect(broken.data.warningDays).toBe(30)
  })
})
