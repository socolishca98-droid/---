// __tests__/isolation/fuel-maintenance.test.ts
//
// Новые страницы «Топливо» и «Обслуживание» не должны показывать чужое:
// чеки и расход организации Б не видны из организации А и наоборот,
// сроки и журнал работ — только по машинам своей организации.
// (Журнал аудита /api/admin/audit уже покрыт в api-isolation.test.ts.)

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

import { GET as fuelGet } from "@/app/api/fuel/route"
import { GET as maintenanceGet } from "@/app/api/maintenance/route"

let world: World
let cookieA: string
let cookieB: string
let cookieLogistA: string

const DAY = 24 * 60 * 60 * 1000

/** Машина с паспортным расходом и сроками документов. */
function seedVehicle(slug: string, organizationId: string, opts: { expiredDocs?: boolean } = {}) {
  const id = cid(slug)
  const past = new Date(Date.now() - 10 * DAY)
  const future = new Date(Date.now() + 60 * DAY)
  memoryDb.insert("vehicle", {
    id,
    organizationId,
    plate: `Н${slug.toUpperCase()}Н76`,
    type: "truck",
    capacity: 20000,
    fuelTankL: 200,
    fuelConsumptionPer100: 25,
    fuelLevelL: 100,
    status: "available",
    mileage: 120000,
    lastMaintenanceDate: past,
    nextMaintenanceDate: opts.expiredDocs ? past : future,
    insuranceExpiry: opts.expiredDocs ? past : future,
    inspectionExpiry: future,
    createdAt: new Date(),
  })
  return id
}

function seedRoute(slug: string, organizationId: string, vehicleId: string) {
  const id = cid(slug)
  memoryDb.insert("route", {
    id,
    organizationId,
    name: `Рейс ${slug}`,
    status: "completed",
    vehicleId,
    driverId: null,
    totalDistance: 400,
    cargoWeight: 10000,
    createdAt: new Date(),
  })
  return id
}

function seedFuel(slug: string, organizationId: string, routeId: string, liters: number, amount: number) {
  const id = cid(slug)
  memoryDb.insert("routeExpense", {
    id,
    organizationId,
    routeId,
    type: "fuel",
    amount,
    liters,
    spentAt: new Date(),
    source: "manual",
    vendor: "АЗС Тест",
    createdAt: new Date(),
  })
  return id
}

function seedLog(slug: string, organizationId: string, vehicleId: string) {
  const id = cid(slug)
  memoryDb.insert("maintenanceLog", {
    id,
    organizationId,
    vehicleId,
    driverId: null,
    type: "repair",
    description: `Ремонт ${slug}`,
    mileage: 120000,
    cost: 7500,
    performer: "service",
    serviceName: "Сервис-76",
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
  })
  return id
}

let vehicleA: string
let vehicleB: string
let routeA: string
let routeB: string

beforeEach(async () => {
  world = seedWorld()
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  cookieB = await sessionCookie({ userId: world.adminB, role: "admin", kind: "staff" })
  cookieLogistA = await sessionCookie({ userId: world.logistA, role: "logist", kind: "staff" })

  vehicleA = seedVehicle("veh-fuel-a", world.orgA, { expiredDocs: true })
  vehicleB = seedVehicle("veh-fuel-b", world.orgB)
  routeA = seedRoute("rt-fuel-a", world.orgA, vehicleA)
  routeB = seedRoute("rt-fuel-b", world.orgB, vehicleB)

  // Чеки: у А — 100 л на 5600 ₽ (оценка рейса: 400 км × 25 л/100 × 1.125 = 112.5 л,
  // отклонение −11 % — в пределах допуска), у Б — 200 л на 11200 ₽
  seedFuel("fx-a", world.orgA, routeA, 100, 5600)
  seedFuel("fx-b", world.orgB, routeB, 200, 11200)

  seedLog("ml-a", world.orgA, vehicleA)
  seedLog("ml-b", world.orgB, vehicleB)
})

describe("топливная ведомость изолирована по организациям", () => {
  it("организация А видит только свои чеки и машины", async () => {
    const data = await jsonOf(await fuelGet(makeRequest("GET", "/api/fuel", { cookie: cookieA })))
    expect(data.success).toBe(true)
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].liters).toBe(100)
    expect(data.entries[0].amountRub).toBe(5600)
    expect(data.entries[0].pricePerL).toBe(56)
    expect(data.entries[0].routeId).toBe(routeA)
    expect(data.totals.liters).toBe(100)
    expect(data.totals.amountRub).toBe(5600)
    // чужие 200 литров организации Б в итоги А не просочились
    expect(data.totals.liters).not.toBe(200)
    expect(data.vehicles.map((row: any) => row.vehicleId)).toEqual([vehicleA])
  })

  it("организация Б видит только свои чеки", async () => {
    const data = await jsonOf(await fuelGet(makeRequest("GET", "/api/fuel", { cookie: cookieB })))
    expect(data.success).toBe(true)
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].liters).toBe(200)
    expect(data.entries[0].routeId).toBe(routeB)
    expect(data.vehicles.map((row: any) => row.vehicleId)).toEqual([vehicleB])
  })

  it("логист организации А получает ту же ведомость своей организации", async () => {
    const data = await jsonOf(
      await fuelGet(makeRequest("GET", "/api/fuel", { cookie: cookieLogistA })),
    )
    expect(data.success).toBe(true)
    expect(data.entries.map((row: any) => row.routeId)).toEqual([routeA])
  })

  it("без сессии ведомость недоступна", async () => {
    const response = await fuelGet(makeRequest("GET", "/api/fuel"))
    expect(response.status).toBe(401)
  })
})

describe("обслуживание изолировано по организациям", () => {
  it("организация А видит только свои машины, сроки и журнал", async () => {
    const data = await jsonOf(
      await maintenanceGet(makeRequest("GET", "/api/maintenance", { cookie: cookieA })),
    )
    expect(data.success).toBe(true)

    // Свои машины: seedWorld даёт ещё две машины А — Б-шных среди них нет
    const ids = data.vehicles.map((row: any) => row.id)
    expect(ids).toContain(vehicleA)
    expect(ids).not.toContain(vehicleB)

    // Просроченные документы машины А видны, и она поднялась наверх списка
    const carA = data.vehicles.find((row: any) => row.id === vehicleA)
    expect(carA.deadlines.worst).toBe("expired")
    expect(data.totals.expiredCount).toBeGreaterThan(0)

    // Журнал работ — только свой (seedWorld тоже добавляет записи организации А)
    const logVehicles = data.logs.map((row: any) => row.vehicleId)
    expect(logVehicles).toContain(vehicleA)
    expect(logVehicles).not.toContain(vehicleB)
    expect(data.logs.some((row: any) => row.costRub === 7500)).toBe(true)
  })

  it("у организации Б свои сроки: её машина без просрочки", async () => {
    const data = await jsonOf(
      await maintenanceGet(makeRequest("GET", "/api/maintenance", { cookie: cookieB })),
    )
    expect(data.success).toBe(true)
    const ids = data.vehicles.map((row: any) => row.id)
    expect(ids).toContain(vehicleB)
    expect(ids).not.toContain(vehicleA)
    const carB = data.vehicles.find((row: any) => row.id === vehicleB)
    expect(carB.deadlines.worst).toBe("ok")
    // Просрочка машины А не уехала в итоги Б
    expect(data.totals.expiredCount).toBe(0)
    const logVehicles = data.logs.map((row: any) => row.vehicleId)
    expect(logVehicles).toContain(vehicleB)
    expect(logVehicles).not.toContain(vehicleA)
  })

  it("без сессии обслуживание недоступно", async () => {
    const response = await maintenanceGet(makeRequest("GET", "/api/maintenance"))
    expect(response.status).toBe(401)
  })
})
