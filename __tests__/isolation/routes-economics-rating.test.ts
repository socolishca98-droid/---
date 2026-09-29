// __tests__/isolation/routes-economics-rating.test.ts
//
// Экономика рейса, сверка топлива и рейтинг водителя считаются ТОЛЬКО по
// данным своей организации: чеки рейса организации B не влияют на экономику
// рейса организации A, доставки и документы чужих водителей не попадают в
// рейтинг, а списки рейсов и водителей не пересекаются между компаниями.

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

import { GET as routesGet } from "@/app/api/routes/route"
import { GET as driversGet } from "@/app/api/drivers/route"

let world: World
let cookieA: string
let cookieB: string
let routeAId: string
let routeBId: string

const HOUR = 60 * 60 * 1000

/** Машина с паспортным расходом: без него оценка топлива (и сверка) не считается. */
function seedVehicleWithFuel(slug: string, organizationId: string) {
  const id = cid(slug)
  memoryDb.insert("vehicle", {
    id,
    organizationId,
    plate: `Т${slug.toUpperCase()}Т76`,
    type: "truck",
    capacity: 20000,
    fuelTankL: 200,
    fuelConsumptionPer100: 25,
    fuelLevelL: 100,
    status: "available",
    createdAt: new Date(),
  })
  return id
}

function seedRoute(slug: string, organizationId: string, vehicleId: string | null) {
  const id = cid(slug)
  memoryDb.insert("route", {
    id,
    organizationId,
    status: "in_route",
    vehicleId,
    driverId: null,
    totalDistance: 300,
    createdAt: new Date(),
  })
  return id
}

function seedDeliveredOrder(
  slug: string,
  organizationId: string,
  routeId: string,
  driverId: string,
  opts: { onTime: boolean; withDocs: boolean },
) {
  const id = cid(slug)
  const deadline = new Date(Date.now() - 2 * HOUR)
  memoryDb.insert("order", {
    id,
    organizationId,
    routeId,
    assignedDriverId: driverId,
    assignedVehicleId: null,
    routeFrom: "Ярославль",
    routeTo: "Москва",
    distance: 300,
    weight: 5000,
    cargoType: "Тент",
    price: 40000,
    clientContact: "",
    status: "delivered",
    deadline,
    deliveredAt: new Date(deadline.getTime() + (opts.onTime ? -HOUR : HOUR)),
    createdAt: new Date(),
  })
  if (opts.withDocs) {
    memoryDb.insert("photo", {
      id: cid(`${slug}-doc`),
      organizationId,
      url: `/uploads/${slug}-ttn.jpg`,
      type: "document",
      driverId,
      orderId: id,
      createdAt: new Date(),
    })
  }
  return id
}

function seedFuelExpense(slug: string, organizationId: string, routeId: string, liters: number, amount: number) {
  memoryDb.insert("routeExpense", {
    id: cid(slug),
    organizationId,
    routeId,
    type: "fuel",
    amount,
    liters,
    createdAt: new Date(),
  })
}

beforeEach(async () => {
  world = seedWorld()
  cookieA = await sessionCookie({ userId: world.adminA, role: "admin", kind: "staff" })
  cookieB = await sessionCookie({ userId: world.adminB, role: "admin", kind: "staff" })

  // Рейс организации A: две доставки (одна в срок, одна с документами) и чек
  routeAId = seedRoute("route-econ-a", world.orgA, seedVehicleWithFuel("veh-econ-a", world.orgA))
  const routeA = routeAId
  seedDeliveredOrder("order-econ-a1", world.orgA, routeA, world.driverA, {
    onTime: true,
    withDocs: true,
  })
  seedDeliveredOrder("order-econ-a2", world.orgA, routeA, world.driverA, {
    onTime: false,
    withDocs: false,
  })
  seedFuelExpense("expense-a1", world.orgA, routeA, 100, 5600)

  // Рейс организации B: свои цифры — вдвое больше литров и другая доставка
  routeBId = seedRoute("route-econ-b", world.orgB, seedVehicleWithFuel("veh-econ-b", world.orgB))
  const routeB = routeBId
  seedDeliveredOrder("order-econ-b1", world.orgB, routeB, world.driverB, {
    onTime: true,
    withDocs: true,
  })
  seedFuelExpense("expense-b1", world.orgB, routeB, 200, 11200)
})

async function callRoutes(cookie: string) {
  const response = await routesGet(makeRequest("GET", "/api/routes", { cookie }))
  return { response, data: await jsonOf(response) }
}

async function callDrivers(cookie: string) {
  const response = await driversGet(makeRequest("GET", "/api/drivers", { cookie }))
  return { response, data: await jsonOf(response) }
}

describe("экономика и сверка топлива изолированы по организациям", () => {
  it("рейс организации A считает факт по своим чекам", async () => {
    const { data } = await callRoutes(cookieA)
    expect(data.success).toBe(true)
    const ids = (data.routes as any[]).map((route) => route.id)
    expect(ids).toContain(routeAId)
    expect(ids).not.toContain(routeBId)

    const routeA = (data.routes as any[]).find((route) => route.id === routeAId)
    expect(routeA.economics.factCostRub).toBe(5600)
    expect(routeA.fuelAudit.factL).toBe(100)
    // чужие 200 литров организации B не просочились в сверку
    expect(routeA.fuelAudit.factL).not.toBe(200)
  })

  it("организация B видит только свои чеки", async () => {
    const { data } = await callRoutes(cookieB)
    const routeB = (data.routes as any[]).find((route) => route.id === routeBId)
    expect(routeB).toBeTruthy()
    expect(routeB.economics.factCostRub).toBe(11200)
    expect(routeB.fuelAudit.factL).toBe(200)
    expect((data.routes as any[]).map((route) => route.id)).not.toContain(routeAId)
  })
})

describe("рейтинг водителя изолирован по организациям", () => {
  it("рейтинг водителя A считает только его доставки и документы", async () => {
    const { data } = await callDrivers(cookieA)
    expect(data.success).toBe(true)
    const ids = (data.drivers as any[]).map((driver) => driver.id)
    expect(ids).toContain(world.driverA)
    expect(ids).not.toContain(world.driverB)

    const driverA = (data.drivers as any[]).find((driver) => driver.id === world.driverA)
    expect(driverA.rating).toBeTruthy()
    expect(driverA.rating.deliveredTotal).toBe(2)
    expect(driverA.rating.onTime).toBe(0.5)
    expect(driverA.rating.docs).toBe(0.5)
  })

  it("водитель B не наследует punctuality водителя A", async () => {
    const { data } = await callDrivers(cookieB)
    const driverB = (data.drivers as any[]).find((driver) => driver.id === world.driverB)
    expect(driverB).toBeTruthy()
    expect(driverB.rating.deliveredTotal).toBe(1)
    expect(driverB.rating.onTime).toBe(1)
    expect(driverB.rating.docs).toBe(1)
  })
})
