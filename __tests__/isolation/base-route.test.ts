// __tests__/isolation/base-route.test.ts
//
// «Возврат на базу» считал расстояние до одной захардкоженной точки для всех
// компаний: водитель из Рыбинска и водитель из Ярославля получали ответ про
// один и тот же адрес. Проверяем, что база берётся из настроек СВОЕЙ
// организации, а без указанных координат водитель получает понятный ответ,
// а не расстояние до чужого штаба.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import {
  expectNoForeignIds,
  jsonOf,
  makeRequest,
  rowOf,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

import { POST as baseRoutePost } from "@/app/api/m/base-route/route"

const RYBINSK = { lat: 58.0485, lng: 38.8584 }
const YAROSLAVL = { lat: 57.6261, lng: 39.8845 }

let world: World
let cookieDriverA: string
let cookieDriverB: string

beforeEach(async () => {
  world = seedWorld()
  cookieDriverA = await sessionCookie({
    userId: world.driverUserA,
    role: "driver",
    kind: "driver",
    driverId: world.driverA,
  })
  cookieDriverB = await sessionCookie({
    userId: world.driverUserB,
    role: "driver",
    kind: "driver",
    driverId: world.driverB,
  })
})

/** База организации: пишем координаты и адрес в её настройки автопарка. */
function setBase(settingsId: string, lat: number, lng: number, address: string) {
  const row = rowOf("fleetSettings", settingsId)
  row.baseLat = lat
  row.baseLng = lng
  row.baseAddress = address
}

function request(cookie: string, body: Record<string, unknown>) {
  return baseRoutePost(makeRequest("POST", "/api/m/base-route", { cookie, body }))
}

describe("POST /api/m/base-route", () => {
  it("водителю А считает расстояние до базы организации А", async () => {
    setBase(world.settingsA, RYBINSK.lat, RYBINSK.lng, "Рыбинск, база А")
    setBase(world.settingsB, YAROSLAVL.lat, YAROSLAVL.lng, "Ярославль, база Б")

    // водитель стоит в Ярославле: до базы Б — пара километров, до базы А — десятки
    const response = await request(cookieDriverA, {
      driverId: world.driverA,
      latitude: YAROSLAVL.lat,
      longitude: YAROSLAVL.lng,
    })

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.success).toBe(true)
    expect(payload.baseName).toBe("Автопарк А")
    expect(payload.baseAddress).toBe("Рыбинск, база А")
    expect(payload.baseLat).toBe(RYBINSK.lat)
    expect(payload.distanceKm).toBeGreaterThan(50)
    expect(payload.etaMinutes).toBeGreaterThan(30)
    expectNoForeignIds(payload, world)
  })

  it("водителю Б — до базы организации Б, даже если он рядом с базой А", async () => {
    setBase(world.settingsA, RYBINSK.lat, RYBINSK.lng, "Рыбинск, база А")
    setBase(world.settingsB, YAROSLAVL.lat, YAROSLAVL.lng, "Ярославль, база Б")

    const response = await request(cookieDriverB, {
      driverId: world.driverB,
      latitude: YAROSLAVL.lat,
      longitude: YAROSLAVL.lng,
    })

    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.baseName).toBe("Автопарк Б")
    expect(payload.baseAddress).toBe("Ярославль, база Б")
    expect(payload.distanceKm).toBeLessThan(10)
    expectNoForeignIds(payload, world)
  })

  it("driverId из тела запроса не подменяет организацию сессии", async () => {
    setBase(world.settingsA, RYBINSK.lat, RYBINSK.lng, "Рыбинск, база А")
    setBase(world.settingsB, YAROSLAVL.lat, YAROSLAVL.lng, "Ярославль, база Б")

    // водитель А передаёт чужой driverId — ответ всё равно про базу организации А
    const response = await request(cookieDriverA, {
      driverId: world.driverB,
      latitude: RYBINSK.lat,
      longitude: RYBINSK.lng,
    })

    const payload = await jsonOf(response)
    expect(payload.baseName).toBe("Автопарк А")
    expect(payload.distanceKm).toBeLessThan(10)
    expectNoForeignIds(payload, world)
  })

  it("без координат базы — понятный ответ, а не расстояние до чужой точки", async () => {
    // в настройках организации А базы нет (как после установки)
    setBase(world.settingsB, YAROSLAVL.lat, YAROSLAVL.lng, "Ярославль, база Б")

    const response = await request(cookieDriverA, {
      driverId: world.driverA,
      latitude: YAROSLAVL.lat,
      longitude: YAROSLAVL.lng,
    })

    expect(response.status).toBe(409)
    const payload = await jsonOf(response)
    expect(payload.success).toBe(false)
    expect(payload.configured).toBe(false)
    expect(payload.error).toContain("баз")
    expect(payload.error).toContain("Автопарк")
    expectNoForeignIds(payload, world)
  })

  it("без координат водителя — 400", async () => {
    setBase(world.settingsA, RYBINSK.lat, RYBINSK.lng, "Рыбинск, база А")

    const response = await request(cookieDriverA, { driverId: world.driverA })

    expect(response.status).toBe(400)
    expect((await jsonOf(response)).success).toBe(false)
  })

  it("без сессии водителя доступа нет", async () => {
    const response = await request("", { latitude: YAROSLAVL.lat, longitude: YAROSLAVL.lng })
    expect(response.status).toBe(401)
  })
})
