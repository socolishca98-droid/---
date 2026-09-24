// __tests__/isolation/api-isolation.test.ts
//
// Функциональная проверка задачи «Организации»: две организации живут в одной
// базе, и ни один API-роут не отдаёт и не меняет данные чужой организации.
//
// Как это работает:
//   * "@/lib/prisma" подменён in-memory клиентом (vitest.isolation.config.ts);
//   * обработчики роутов импортируются и вызываются напрямую, как их вызывает
//     Next.js (NextRequest + { params });
//   * сессии — настоящие подписанные cookie (helpers.sessionCookie), поэтому
//     организация попадает в роут из проверенного токена, а не из параметров;
//   * утечки ищем «грубо»: ни один идентификатор организации Б не должен
//     встретиться в сериализованном ответе.

import { beforeEach, describe, expect, it } from "vitest"

import { memoryDb } from "../__mocks__/prisma-memory"
import {
  expectNoForeignIds,
  jsonOf,
  makeRequest,
  rowOf,
  routeContext,
  seedWorld,
  sessionCookie,
  type World,
} from "./helpers"

// — штабные роуты —
import { GET as ordersGet, POST as ordersPost } from "@/app/api/orders/route"
import {
  GET as orderGet,
  PATCH as orderPatch,
  DELETE as orderDelete,
} from "@/app/api/orders/[id]/route"
import { GET as driversGet, POST as driversPost } from "@/app/api/drivers/route"
import {
  GET as driverGet,
  PATCH as driverPatch,
  DELETE as driverDelete,
} from "@/app/api/drivers/[id]/route"
import { GET as driverActiveOrderGet } from "@/app/api/drivers/[id]/active-order/route"
import { POST as driverLocationPost } from "@/app/api/drivers/[id]/location/route"
import { GET as driversLocationsGet } from "@/app/api/drivers/locations/route"
import { GET as vehiclesGet, POST as vehiclesPost } from "@/app/api/vehicles/route"
import {
  GET as vehicleGet,
  PATCH as vehiclePatch,
  DELETE as vehicleDelete,
} from "@/app/api/vehicles/[id]/route"
import { GET as routesGet } from "@/app/api/routes/route"
import {
  GET as routeGet,
  PATCH as routePatch,
  DELETE as routeDelete,
} from "@/app/api/routes/[routeId]/route"
import { GET as routeEventsGet } from "@/app/api/routes/[routeId]/events/route"
import { POST as routeCompletePost } from "@/app/api/routes/[routeId]/complete/route"
import { POST as routeAddLoadPost } from "@/app/api/routes/[routeId]/add-load/route"
import { GET as dashboardStatsGet } from "@/app/api/dashboard/stats/route"
import { GET as dashboardRoutesGet } from "@/app/api/dashboard/routes/route"
import { GET as fleetGet } from "@/app/api/fleet/route"
import { GET as fleetDriversGet } from "@/app/api/fleet/drivers/route"
import { GET as fleetVehiclesGet } from "@/app/api/fleet/vehicles/route"
import { GET as fleetStatsGet } from "@/app/api/fleet/stats/route"
import { GET as fleetSettingsGet, POST as fleetSettingsPost } from "@/app/api/fleet/settings/route"
import { POST as fleetAssignPost, DELETE as fleetAssignDelete } from "@/app/api/fleet/assign/route"
import { GET as chatGet, POST as chatPost, PATCH as chatPatch } from "@/app/api/chat/route"
import { GET as sosGet, PATCH as sosPatch } from "@/app/api/sos/route"
import { GET as paymentsGet, PATCH as paymentsPatch, POST as paymentsPost } from "@/app/api/payments/route"
import { GET as photosGet, POST as photosPost } from "@/app/api/photos/route"
import { GET as usersGet } from "@/app/api/auth/users/route"
import { PATCH as userPatch } from "@/app/api/auth/users/[id]/route"
import { GET as auditGet } from "@/app/api/admin/audit/route"
import { GET as organizationGet } from "@/app/api/organization/route"
import {
  GET as invitesGet,
  POST as invitesPost,
} from "@/app/api/organization/invites/route"
import { DELETE as inviteDelete } from "@/app/api/organization/invites/[id]/route"

// — водительские роуты —
import { GET as mMeGet } from "@/app/api/m/me/route"
import { GET as mOrdersGet } from "@/app/api/m/orders/route"
import { GET as mVehicleGet, POST as mVehiclePost } from "@/app/api/m/vehicle/route"
import { POST as mLocationPost } from "@/app/api/m/location/route"
import { POST as mSosPost } from "@/app/api/m/sos/route"
import { GET as mShiftGet } from "@/app/api/m/shift/route"
import { GET as mMaintenanceGet } from "@/app/api/m/maintenance/route"
import { GET as mPhotosGet } from "@/app/api/m/photos/route"
import { POST as mMaintenancePost } from "@/app/api/m/maintenance/route"
import { POST as mAcceptLoadPost } from "@/app/api/m/route/accept-load/route"
import { POST as mRouteEventsPost } from "@/app/m/route/events/route"

let world: World
/** Cookie админа организации А */
let cookieA: string
/** Cookie админа организации Б */
let cookieB: string
/** Cookie водителя организации А */
let cookieDriverA: string
/** Cookie водителя организации Б */
let cookieDriverB: string
/** Cookie логиста организации А */
let cookieLogistA: string
/** Cookie сотрудника без организации */
let cookieNoOrg: string

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
  cookieDriverB = await sessionCookie({
    userId: world.driverUserB,
    role: "driver",
    kind: "driver",
    driverId: world.driverB,
  })
  cookieLogistA = await sessionCookie({
    userId: world.logistA,
    role: "logist",
    kind: "staff",
  })
  cookieNoOrg = await sessionCookie({
    userId: world.logistNoOrg,
    role: "logist",
    kind: "staff",
  })

  // Журнал аудита: по записи в каждой организации — проверяем /api/admin/audit
  memoryDb.insert("auditLog", {
    id: "audit_a",
    organizationId: world.orgA,
    actorId: world.adminA,
    action: "test",
    targetType: "user",
    metadata: null,
  })
  memoryDb.insert("auditLog", {
    id: "audit_b",
    organizationId: world.orgB,
    actorId: world.adminB,
    action: "test",
    targetType: "user",
    metadata: null,
  })
})

/**
 * GET-список не должен содержать ни одного идентификатора чужой организации.
 * По умолчанию — сессия админа организации А.
 */
async function expectScopedGet(
  path: string,
  handler: (req: any, ctx?: any) => Promise<Response>,
  options: { cookie?: string; ctx?: any } = {},
) {
  const response = await handler(
    makeRequest("GET", path, { cookie: options.cookie ?? cookieA }),
    options.ctx,
  )
  const payload = await jsonOf(response)
  expect(response.status, `${path} → статус`).toBe(200)
  expectNoForeignIds(payload, world)
  return payload
}

describe("доступ к API: организация берётся из проверенной сессии", () => {
  it("без cookie штабной роут отвечает 401", async () => {
    const response = await ordersGet(makeRequest("GET", "/api/orders"))
    expect(response.status).toBe(401)
  })

  it("сотрудник без организации получает 403 и никаких данных", async () => {
    const response = await ordersGet(makeRequest("GET", "/api/orders", { cookie: cookieNoOrg }))
    expect(response.status).toBe(403)
    expectNoForeignIds(await jsonOf(response), world)
  })

  it("водительский cookie не открывает штабной роут", async () => {
    const response = await ordersGet(makeRequest("GET", "/api/orders", { cookie: cookieDriverA }))
    expect(response.status).toBe(401)
  })

  it("organizationId нельзя подменить телом запроса", async () => {
    // Тело с чужой организацией игнорируется: заказ создаётся в организации А
    const response = await ordersPost(
      makeRequest("POST", "/api/orders", {
        cookie: cookieA,
        body: {
          routeFrom: "Тверь",
          routeTo: "Рязань",
          distance: 400,
          weight: 5,
          cargoType: "Груз",
          clientContact: "",
          deadline: new Date(Date.now() + 86400000).toISOString(),
          organizationId: world.orgB,
        },
      }),
    )
    expect(response.status).toBeLessThan(300)
    const created = memoryDb
      .rows("order")
      .filter((row) => row.routeFrom === "Тверь")
    expect(created).toHaveLength(1)
    expect(created[0].organizationId).toBe(world.orgA)
  })
})

describe("заказы /api/orders", () => {
  it("список: только свои заказы", async () => {
    const payload = await expectScopedGet("/api/orders", ordersGet)
    expect(JSON.stringify(payload)).toContain(world.orderA)
  })

  it("фильтр по чужому водителю не отдаёт чужие заказы", async () => {
    const response = await ordersGet(
      makeRequest("GET", `/api/orders?assignedDriverId=${world.driverB}`, { cookie: cookieA }),
    )
    expect(response.status).toBe(200)
    expectNoForeignIds(await jsonOf(response), world)
  })

  it("чужой заказ по id: 404 на GET/PATCH/DELETE, данные целы", async () => {
    const get = await orderGet(
      makeRequest("GET", `/api/orders/${world.orderB}`, { cookie: cookieA }),
      routeContext({ id: world.orderB }),
    )
    expect(get.status).toBe(404)

    const patch = await orderPatch(
      makeRequest("PATCH", `/api/orders/${world.orderB}`, {
        cookie: cookieA,
        body: { status: "completed", price: 1 },
      }),
      routeContext({ id: world.orderB }),
    )
    expect(patch.status).toBe(404)

    const del = await orderDelete(
      makeRequest("DELETE", `/api/orders/${world.orderB}`, { cookie: cookieA }),
      routeContext({ id: world.orderB }),
    )
    expect(del.status).toBe(404)

    const foreign = rowOf("order", world.orderB)
    expect(foreign).toBeTruthy()
    expect(foreign.status).toBe("confirmed")
    expect(foreign.price).toBe(100000)
  })

  it("свой заказ по id доступен организации А и недоступен организации Б", async () => {
    const own = await orderGet(
      makeRequest("GET", `/api/orders/${world.orderA}`, { cookie: cookieA }),
      routeContext({ id: world.orderA }),
    )
    expect(own.status).toBe(200)

    const foreign = await orderGet(
      makeRequest("GET", `/api/orders/${world.orderA}`, { cookie: cookieB }),
      routeContext({ id: world.orderA }),
    )
    expect(foreign.status).toBe(404)
  })

  it("создание заказа с чужим водителем или машиной: 404, заказ не создан", async () => {
    const before = memoryDb.count("order")

    const driverResponse = await ordersPost(
      makeRequest("POST", "/api/orders", {
        cookie: cookieA,
        body: {
          routeFrom: "Москва",
          routeTo: "Орёл",
          distance: 300,
          weight: 3,
          cargoType: "Груз",
          clientContact: "",
          deadline: new Date(Date.now() + 86400000).toISOString(),
          assignedDriverId: world.driverB,
        },
      }),
    )
    expect(driverResponse.status).toBe(404)

    const vehicleResponse = await ordersPost(
      makeRequest("POST", "/api/orders", {
        cookie: cookieA,
        body: {
          routeFrom: "Москва",
          routeTo: "Орёл",
          distance: 300,
          weight: 3,
          cargoType: "Груз",
          clientContact: "",
          deadline: new Date(Date.now() + 86400000).toISOString(),
          assignedVehicleId: world.vehicleB,
        },
      }),
    )
    expect(vehicleResponse.status).toBe(404)

    expect(memoryDb.count("order")).toBe(before)
  })

  it("PATCH своего заказа не позволяет перенести его в чужую организацию", async () => {
    const response = await orderPatch(
      makeRequest("PATCH", `/api/orders/${world.orderA}`, {
        cookie: cookieA,
        body: { organizationId: world.orgB },
      }),
      routeContext({ id: world.orderA }),
    )
    expect(response.status).toBe(400)
    expect(rowOf("order", world.orderA).organizationId).toBe(world.orgA)
  })

  it("PATCH своего заказа отклоняет неизвестные и служебные поля", async () => {
    for (const body of [
      { id: "podmen" },
      { createdAt: new Date(0).toISOString() },
      { isPaid: true },
      { kakoeToPole: 1 },
    ]) {
      const response = await orderPatch(
        makeRequest("PATCH", `/api/orders/${world.orderA}`, { cookie: cookieA, body }),
        routeContext({ id: world.orderA }),
      )
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
    expect(rowOf("order", world.orderA).organizationId).toBe(world.orgA)
    expect(rowOf("order", world.orderA).isPaid ?? false).toBe(false)
  })

  it("PATCH своего заказа с чужим рейсом: 404, со своим рейсом и полями — применяется", async () => {
    const foreign = await orderPatch(
      makeRequest("PATCH", `/api/orders/${world.orderA}`, {
        cookie: cookieA,
        body: { routeId: world.routeB },
      }),
      routeContext({ id: world.orderA }),
    )
    expect(foreign.status).toBe(404)
    expect(rowOf("order", world.orderA).routeId).toBe(world.routeA)

    const own = await orderPatch(
      makeRequest("PATCH", `/api/orders/${world.orderA}`, {
        cookie: cookieA,
        body: { routeId: world.routeA, price: 55000, clientName: "Новый клиент" },
      }),
      routeContext({ id: world.orderA }),
    )
    expect(own.status).toBeLessThan(300)
    expect(rowOf("order", world.orderA).price).toBe(55000)
    expect(rowOf("order", world.orderA).clientName).toBe("Новый клиент")
    expectNoForeignIds(await jsonOf(own), world)
  })

  it("создание заказа с чужим рейсом: 404", async () => {
    const before = memoryDb.count("order")
    const response = await ordersPost(
      makeRequest("POST", "/api/orders", {
        cookie: cookieA,
        body: {
          routeFrom: "Москва",
          routeTo: "Калуга",
          distance: 190,
          weight: 2,
          cargoType: "Груз",
          clientContact: "",
          deadline: new Date(Date.now() + 86400000).toISOString(),
          routeId: world.routeB,
        },
      }),
    )
    expect(response.status).toBe(404)
    expect(memoryDb.count("order")).toBe(before)
  })

  it("созданный заказ принадлежит организации вызывающего", async () => {
    const response = await ordersPost(
      makeRequest("POST", "/api/orders", {
        cookie: cookieA,
        body: {
          routeFrom: "Москва",
          routeTo: "Тула",
          distance: 200,
          weight: 2,
          cargoType: "Груз",
          clientContact: "",
          deadline: new Date(Date.now() + 86400000).toISOString(),
          assignedDriverId: world.driverA,
          assignedVehicleId: world.vehicleA,
        },
      }),
    )
    expect(response.status).toBeLessThan(300)
    const payload = await jsonOf(response)
    expectNoForeignIds(payload, world)
    expect(rowOf("order", payload.order.id).organizationId).toBe(world.orgA)
  })
})

describe("водители /api/drivers", () => {
  it("список: только свои водители", async () => {
    const payload = await expectScopedGet("/api/drivers", driversGet)
    expect(payload.drivers).toHaveLength(1)
    expect(payload.drivers[0].id).toBe(world.driverA)
  })

  it("bulk-выборка по чужим id возвращает пустой список", async () => {
    const response = await driversGet(
      makeRequest("GET", `/api/drivers?ids=${world.driverB},${world.driverA}`, { cookie: cookieA }),
    )
    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(payload.drivers.map((d: any) => d.id)).toEqual([world.driverA])
    expectNoForeignIds(payload, world)
  })

  it("чужой водитель: 404 на GET/PATCH/DELETE, карточка и учётка целы", async () => {
    const get = await driverGet(
      makeRequest("GET", `/api/drivers/${world.driverB}`, { cookie: cookieA }),
      routeContext({ id: world.driverB }),
    )
    expect(get.status).toBe(404)

    const patch = await driverPatch(
      makeRequest("PATCH", `/api/drivers/${world.driverB}`, {
        cookie: cookieA,
        body: { name: "переименован чужой водитель" },
      }),
      routeContext({ id: world.driverB }),
    )
    expect(patch.status).toBe(404)

    const del = await driverDelete(
      makeRequest("DELETE", `/api/drivers/${world.driverB}`, { cookie: cookieA }),
      routeContext({ id: world.driverB }),
    )
    expect(del.status).toBe(404)

    expect(rowOf("driver", world.driverB).name).toBe("Водитель Б")
    expect(rowOf("user", world.driverUserB).status).toBe("active")
  })

  it("активный заказ и локация чужого водителя недоступны", async () => {
    const activeOrder = await driverActiveOrderGet(
      makeRequest("GET", `/api/drivers/${world.driverB}/active-order`, { cookie: cookieA }),
      routeContext({ id: world.driverB }),
    )
    expect(activeOrder.status).toBe(404)

    const location = await driverLocationPost(
      makeRequest("POST", `/api/drivers/${world.driverB}/location`, {
        cookie: cookieA,
        body: { latitude: 1, longitude: 1 },
      }),
      routeContext({ id: world.driverB }),
    )
    expect(location.status).toBe(404)
    expect(rowOf("driver", world.driverB).latitude ?? null).toBeNull()
  })

  it("созданный водитель и его учётка получают организацию вызывающего", async () => {
    const response = await driversPost(
      makeRequest("POST", "/api/drivers", {
        cookie: cookieA,
        body: { name: "Новый Водитель", phone: "+79001112233" },
      }),
    )
    expect(response.status).toBeLessThan(300)
    const payload = await jsonOf(response)
    expect(rowOf("driver", payload.driver.id).organizationId).toBe(world.orgA)

    const account = memoryDb
      .rows("user")
      .find((row) => row.driverId === payload.driver.id)
    expect(account?.organizationId).toBe(world.orgA)
    expectNoForeignIds(payload, world)
  })

  it("локации водителей: только свои", async () => {
    await expectScopedGet("/api/drivers/locations", driversLocationsGet)
  })
})

describe("машины /api/vehicles", () => {
  it("список: только свои машины", async () => {
    const payload = await expectScopedGet("/api/vehicles", vehiclesGet)
    expect(payload.vehicles).toHaveLength(1)
  })

  it("чужая машина: 404 на GET/PATCH/DELETE, запись цела", async () => {
    const get = await vehicleGet(
      makeRequest("GET", `/api/vehicles/${world.vehicleB}`, { cookie: cookieA }),
      routeContext({ id: world.vehicleB }),
    )
    expect(get.status).toBe(404)

    const patch = await vehiclePatch(
      makeRequest("PATCH", `/api/vehicles/${world.vehicleB}`, {
        cookie: cookieA,
        body: { plate: "Х999ХХ99" },
      }),
      routeContext({ id: world.vehicleB }),
    )
    expect(patch.status).toBe(404)

    const del = await vehicleDelete(
      makeRequest("DELETE", `/api/vehicles/${world.vehicleB}`, { cookie: cookieA }),
      routeContext({ id: world.vehicleB }),
    )
    expect(del.status).toBe(404)
    expect(memoryDb.find("vehicle", world.vehicleB)).toBeTruthy()
  })

  it("госномер уникален в рамках организации, а не глобально", async () => {
    // Тот же номер уже есть в организации Б → в организации А создать можно
    const response = await vehiclesPost(
      makeRequest("POST", "/api/vehicles", {
        cookie: cookieA,
        body: { plate: "В777ВВ77", type: "truck", capacity: 10 },
      }),
    )
    expect(response.status).toBeLessThan(300)
    const payload = await jsonOf(response)
    expect(rowOf("vehicle", payload.vehicle.id).organizationId).toBe(world.orgA)

    // Повтор номера внутри своей организации — ошибка
    const duplicate = await vehiclesPost(
      makeRequest("POST", "/api/vehicles", {
        cookie: cookieA,
        body: { plate: "В777ВВ77", type: "truck", capacity: 10 },
      }),
    )
    expect(duplicate.status).toBeGreaterThanOrEqual(400)

    // Тот же номер в другой организации — снова можно
    const otherOrg = await vehiclesPost(
      makeRequest("POST", "/api/vehicles", {
        cookie: cookieB,
        body: { plate: "В777ВВ77", type: "truck", capacity: 10 },
      }),
    )
    expect(otherOrg.status).toBeLessThan(300)
  })
})

describe("рейсы /api/routes", () => {
  it("список: только свои рейсы", async () => {
    const payload = await expectScopedGet("/api/routes", routesGet)
    expect(JSON.stringify(payload)).toContain(world.routeA)
  })

  it("чужой рейс: 404 на GET/PATCH/DELETE, события и завершение недоступны", async () => {
    const get = await routeGet(
      makeRequest("GET", `/api/routes/${world.routeB}`, { cookie: cookieA }),
      routeContext({ routeId: world.routeB }),
    )
    expect(get.status).toBe(404)

    const patch = await routePatch(
      makeRequest("PATCH", `/api/routes/${world.routeB}`, {
        cookie: cookieA,
        body: { status: "completed" },
      }),
      routeContext({ routeId: world.routeB }),
    )
    expect(patch.status).toBe(404)

    const del = await routeDelete(
      makeRequest("DELETE", `/api/routes/${world.routeB}`, { cookie: cookieA }),
      routeContext({ routeId: world.routeB }),
    )
    expect(del.status).toBe(404)

    // События отдаются пустым списком: запрос скоуплен организацией вызывающего
    const events = await routeEventsGet(
      makeRequest("GET", `/api/routes/${world.routeB}/events`, { cookie: cookieA }),
      routeContext({ routeId: world.routeB }),
    )
    expect([200, 403, 404]).toContain(events.status)
    const eventsPayload = await jsonOf(events)
    expect(eventsPayload.events ?? []).toHaveLength(0)

    const complete = await routeCompletePost(
      makeRequest("POST", `/api/routes/${world.routeB}/complete`, { cookie: cookieA }),
      routeContext({ routeId: world.routeB }),
    )
    expect([403, 404]).toContain(complete.status)

    const addLoad = await routeAddLoadPost(
      makeRequest("POST", `/api/routes/${world.routeB}/add-load`, {
        cookie: cookieA,
        body: { routeFrom: "Москва", routeTo: "Псков" },
      }),
      routeContext({ routeId: world.routeB }),
    )
    expect([400, 403, 404]).toContain(addLoad.status)

    expect(rowOf("route", world.routeB).status).toBe("active")
    expectNoForeignIds(eventsPayload, world)
  })
})

describe("дашборд и автопарк", () => {
  it("статистика и маршруты дашборда: только свои данные", async () => {
    await expectScopedGet("/api/dashboard/stats", dashboardStatsGet)
    await expectScopedGet("/api/dashboard/routes", dashboardRoutesGet)
  })

  it("автопарк: сводка, водители, машины, статистика — только свои", async () => {
    const fleet = await expectScopedGet("/api/fleet", fleetGet)
    expect(fleet.drivers).toHaveLength(1)
    expect(fleet.vehicles).toHaveLength(1)
    await expectScopedGet("/api/fleet/drivers", fleetDriversGet)
    await expectScopedGet("/api/fleet/vehicles", fleetVehiclesGet)
    await expectScopedGet("/api/fleet/stats", fleetStatsGet)
  })

  it("настройки автопарка читаются и пишутся только в своей организации", async () => {
    const get = await expectScopedGet("/api/fleet/settings", fleetSettingsGet)
    expect(JSON.stringify(get)).toContain("Автопарк А")

    const post = await fleetSettingsPost(
      makeRequest("POST", "/api/fleet/settings", {
        cookie: cookieA,
        body: { parkName: "Автопарк А обновлён" },
      }),
    )
    expect(post.status).toBeLessThan(300)
    expect(rowOf("fleetSettings", world.settingsA).parkName).toBe("Автопарк А обновлён")
    expect(rowOf("fleetSettings", world.settingsB).parkName).toBe("Автопарк Б")
  })

  it("назначение чужого водителя или машины: 404", async () => {
    const foreignDriver = await fleetAssignPost(
      makeRequest("POST", "/api/fleet/assign", {
        cookie: cookieA,
        body: { driverId: world.driverB, vehicleId: world.vehicleA },
      }),
    )
    expect(foreignDriver.status).toBe(404)

    const foreignVehicle = await fleetAssignPost(
      makeRequest("POST", "/api/fleet/assign", {
        cookie: cookieA,
        body: { driverId: world.driverA, vehicleId: world.vehicleB },
      }),
    )
    expect(foreignVehicle.status).toBe(404)

    expect(rowOf("driver", world.driverB).vehicleId).toBe(world.vehicleB)

    const unassign = await fleetAssignDelete(
      makeRequest("DELETE", "/api/fleet/assign", {
        cookie: cookieA,
        body: { driverId: world.driverB },
      }),
    )
    expect([400, 403, 404]).toContain(unassign.status)
    expect(rowOf("driver", world.driverB).vehicleId).toBe(world.vehicleB)
  })
})

describe("чат, SOS, платежи, фотографии", () => {
  it("чат: чужие сообщения не видны, отправка чужому водителю — 404", async () => {
    const payload = await expectScopedGet("/api/chat", chatGet)
    expect(JSON.stringify(payload)).toContain("сообщение организации А")

    const foreign = await chatPost(
      makeRequest("POST", "/api/chat", {
        cookie: cookieA,
        body: { content: "привет чужому водителю", recipientId: world.driverB },
      }),
    )
    expect(foreign.status).toBe(404)

    const own = await chatPost(
      makeRequest("POST", "/api/chat", {
        cookie: cookieA,
        body: { content: "привет своему водителю", recipientId: world.driverA },
      }),
    )
    expect(own.status).toBeLessThan(300)
    const body = await jsonOf(own)
    expect(rowOf("chatMessage", body.message.id).organizationId).toBe(world.orgA)
  })

  it("пометка прочитанным не трогает чужие сообщения", async () => {
    const response = await chatPatch(
      makeRequest("PATCH", "/api/chat", {
        cookie: cookieA,
        body: { messageIds: [world.chatB, world.chatA] },
      }),
    )
    expect(response.status).toBeLessThan(300)
    expect(rowOf("chatMessage", world.chatB).readAt ?? null).toBeNull()
    expect(rowOf("chatMessage", world.chatA).readAt).toBeTruthy()
  })

  it("SOS: чужие сигналы не видны и не закрываются", async () => {
    const payload = await expectScopedGet("/api/sos", sosGet)
    expect(JSON.stringify(payload)).toContain(world.sosA)

    const response = await sosPatch(
      makeRequest("PATCH", "/api/sos", {
        cookie: cookieA,
        body: { sosId: world.sosB, status: "resolved", resolution: "чужой сигнал" },
      }),
    )
    expect(response.status).toBe(404)
    expect(rowOf("sosAlert", world.sosB).status).toBe("active")
    expect(rowOf("sosAlert", world.sosB).resolution ?? null).toBeNull()
  })

  it("платежи: чужие заказы не видны и не меняются", async () => {
    const payload = await expectScopedGet("/api/payments", paymentsGet)
    expect(JSON.stringify(payload)).toContain(world.orderA)

    const patch = await paymentsPatch(
      makeRequest("PATCH", "/api/payments", {
        cookie: cookieA,
        body: { orderId: world.orderB, isPaid: true },
      }),
    )
    expect(patch.status).toBe(404)

    const post = await paymentsPost(
      makeRequest("POST", "/api/payments", {
        cookie: cookieA,
        body: { orderId: world.orderB },
      }),
    )
    expect(post.status).toBe(404)

    expect(rowOf("order", world.orderB).isPaid ?? false).toBe(false)
  })

  it("фотографии: чужие не видны, привязка к чужому водителю — 404", async () => {
    const payload = await expectScopedGet("/api/photos", photosGet)
    expect(JSON.stringify(payload)).toContain(world.photoA)

    const foreignDriver = await photosPost(
      makeRequest("POST", "/api/photos", {
        cookie: cookieA,
        body: { url: "https://test.local/x.jpg", type: "doc", driverId: world.driverB },
      }),
    )
    expect(foreignDriver.status).toBe(404)

    const foreignOrder = await photosPost(
      makeRequest("POST", "/api/photos", {
        cookie: cookieA,
        body: {
          url: "https://test.local/x.jpg",
          type: "doc",
          driverId: world.driverA,
          orderId: world.orderB,
        },
      }),
    )
    expect(foreignOrder.status).toBe(404)

    const own = await photosPost(
      makeRequest("POST", "/api/photos", {
        cookie: cookieA,
        body: { url: "https://test.local/y.jpg", type: "doc", driverId: world.driverA },
      }),
    )
    expect(own.status).toBeLessThan(300)
    const body = await jsonOf(own)
    expect(rowOf("photo", body.photo.id).organizationId).toBe(world.orgA)
  })
})

describe("сотрудники, организация, приглашения, журнал аудита", () => {
  it("список сотрудников: только своя организация", async () => {
    const payload = await expectScopedGet("/api/auth/users", usersGet)
    expect(JSON.stringify(payload)).toContain(world.adminA)
    expect(JSON.stringify(payload)).not.toContain(world.driverUserB)
  })

  it("управление чужой учёткой: 404 и никаких изменений", async () => {
    const response = await userPatch(
      makeRequest("PATCH", `/api/auth/users/${world.adminB}`, {
        cookie: cookieA,
        body: { action: "suspend" },
      }),
      routeContext({ id: world.adminB }),
    )
    expect(response.status).toBe(404)
    expect(rowOf("user", world.adminB).status).toBe("active")
  })

  it("карточка организации: своя", async () => {
    const payload = await expectScopedGet("/api/organization", organizationGet)
    expect(JSON.stringify(payload)).toContain("Организация А")
  })

  it("приглашения: список, создание и отзыв — только в своей организации", async () => {
    const payload = await expectScopedGet("/api/organization/invites", invitesGet)
    expect(JSON.stringify(payload)).toContain("AAAA-AAAA-AAAA")

    const created = await invitesPost(
      makeRequest("POST", "/api/organization/invites", {
        cookie: cookieA,
        body: { role: "logist", expiresInDays: 7, maxUses: 5 },
      }),
    )
    expect(created.status).toBeLessThan(300)
    const inviteBody = await jsonOf(created)
    const inviteRow = rowOf("inviteCode", inviteBody.invite.id)
    expect(inviteRow?.organizationId).toBe(world.orgA)
    expect(inviteRow?.createdById).toBe(world.adminA)

    // Отзыв чужого кода — 404, код организации Б остаётся живым
    const foreign = await inviteDelete(
      makeRequest("DELETE", `/api/organization/invites/${world.inviteB}`, { cookie: cookieA }),
      routeContext({ id: world.inviteB }),
    )
    expect(foreign.status).toBe(404)
    expect(rowOf("inviteCode", world.inviteB).revokedAt ?? null).toBeNull()
  })

  it("журнал аудита: только записи своей организации", async () => {
    const response = await auditGet(makeRequest("GET", "/api/admin/audit", { cookie: cookieA }))
    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(JSON.stringify(payload)).toContain("audit_a")
    expect(JSON.stringify(payload)).not.toContain("audit_b")
    expectNoForeignIds(payload, world)
  })
})

describe("заявки на присоединение: одобряет и логист, и администратор", () => {
  it("логист организации одобряет заявку своей организации", async () => {
    const response = await userPatch(
      makeRequest("PATCH", `/api/auth/users/${world.pendingA}`, {
        cookie: cookieLogistA,
        body: { action: "approve" },
      }),
      routeContext({ id: world.pendingA }),
    )
    expect(response.status).toBe(200)
    const body = await jsonOf(response)
    expect(body.user.status).toBe("active")
    expect(rowOf("user", world.pendingA).status).toBe("active")
    expect(rowOf("user", world.pendingA).organizationId).toBe(world.orgA)
  })

  it("логист отклоняет заявку: запись удалена, использование кода возвращено", async () => {
    expect(rowOf("inviteCode", world.inviteA).usedCount).toBe(1)

    const response = await userPatch(
      makeRequest("PATCH", `/api/auth/users/${world.pendingA}`, {
        cookie: cookieLogistA,
        body: { action: "reject" },
      }),
      routeContext({ id: world.pendingA }),
    )
    expect(response.status).toBe(200)
    expect(memoryDb.find("user", world.pendingA), "заявка удалена").toBeUndefined()
    expect(rowOf("inviteCode", world.inviteA).usedCount).toBe(0)
  })

  it("логист организации А не одобряет заявку организации Б: 404, заявка цела", async () => {
    const response = await userPatch(
      makeRequest("PATCH", `/api/auth/users/${world.pendingB}`, {
        cookie: cookieLogistA,
        body: { action: "approve" },
      }),
      routeContext({ id: world.pendingB }),
    )
    expect(response.status).toBe(404)
    expect(rowOf("user", world.pendingB).status).toBe("pending")
  })

  it("сотрудник без организации заявки не обрабатывает", async () => {
    const response = await userPatch(
      makeRequest("PATCH", `/api/auth/users/${world.pendingA}`, {
        cookie: cookieNoOrg,
        body: { action: "approve" },
      }),
      routeContext({ id: world.pendingA }),
    )
    expect(response.status).toBe(403)
    expect(rowOf("user", world.pendingA).status).toBe("pending")
  })

  it("логист не управляет доступом: suspend, restore, setRole, resetPassword, unlock — 403", async () => {
    for (const action of ["suspend", "restore", "setRole", "resetPassword", "unlock"]) {
      const response = await userPatch(
        makeRequest("PATCH", `/api/auth/users/${world.logistA}`, {
          cookie: cookieLogistA,
          body: { action, role: "admin", reason: "тест", password: "Passw0rd!2345" },
        }),
        routeContext({ id: world.logistA }),
      )
      expect(response.status, `${action} → 403 для логиста`).toBe(403)
    }
    expect(rowOf("user", world.logistA).status).toBe("active")
  })

  it("администратор закрывает доступ сотруднику и восстанавливает его (запись не удаляется)", async () => {
    const suspended = await userPatch(
      makeRequest("PATCH", `/api/auth/users/${world.logistA}`, {
        cookie: cookieA,
        body: { action: "suspend", reason: "Уволен" },
      }),
      routeContext({ id: world.logistA }),
    )
    expect(suspended.status).toBe(200)
    expect(rowOf("user", world.logistA).status).toBe("suspended")
    expect(rowOf("user", world.logistA).suspendReason).toBe("Уволен")

    const restored = await userPatch(
      makeRequest("PATCH", `/api/auth/users/${world.logistA}`, {
        cookie: cookieA,
        body: { action: "restore" },
      }),
      routeContext({ id: world.logistA }),
    )
    expect(restored.status).toBe(200)
    expect(rowOf("user", world.logistA).status).toBe("active")
    expect(rowOf("user", world.logistA).suspendReason ?? null).toBeNull()
  })
})

describe("водительское приложение /api/m", () => {
  it("профиль, заказы, машина, смена, ТО и фото: только свои", async () => {
    const driverCookie = { cookie: cookieDriverA }
    const me = await expectScopedGet("/api/m/me", mMeGet, driverCookie)
    expect(JSON.stringify(me)).toContain(world.driverA)

    const orders = await expectScopedGet("/api/m/orders", mOrdersGet, driverCookie)
    expect(JSON.stringify(orders)).toContain(world.orderA)

    await expectScopedGet("/api/m/vehicle", mVehicleGet, driverCookie)
    await expectScopedGet("/api/m/shift", mShiftGet, driverCookie)
    await expectScopedGet("/api/m/maintenance", mMaintenanceGet, driverCookie)
    await expectScopedGet("/api/m/photos", mPhotosGet, driverCookie)
  })

  it("штабная сессия не открывает водительские роуты и наоборот", async () => {
    const staffInMobile = await mOrdersGet(makeRequest("GET", "/api/m/orders", { cookie: cookieA }))
    expect(staffInMobile.status).toBe(401)

    const driverInStaff = await driversGet(makeRequest("GET", "/api/drivers", { cookie: cookieDriverA }))
    expect(driverInStaff.status).toBe(401)
  })

  it("заказы водителя: у водителя Б нет заказа организации А", async () => {
    const response = await mOrdersGet(makeRequest("GET", "/api/m/orders", { cookie: cookieDriverB }))
    expect(response.status).toBe(200)
    const payload = await jsonOf(response)
    expect(JSON.stringify(payload)).not.toContain(world.orderA)
  })

  it("ТО с чужим исполнителем не создаётся, со своим — создаётся в организации водителя", async () => {
    const foreign = await mMaintenancePost(
      makeRequest("POST", "/api/m/maintenance", {
        cookie: cookieA,
        body: {
          vehicleId: world.vehicleA,
          driverId: world.driverB,
          type: "oil",
          description: "замена масла",
        },
      }),
    )
    expect(foreign.status).toBe(404)

    const own = await mMaintenancePost(
      makeRequest("POST", "/api/m/maintenance", {
        cookie: cookieA,
        body: {
          vehicleId: world.vehicleA,
          driverId: world.driverA,
          type: "oil",
          description: "замена масла",
          status: "planned",
        },
      }),
    )
    expect(own.status).toBeLessThan(300)
    const payload = await jsonOf(own)
    expect(rowOf("maintenanceLog", payload.maintenance.id).organizationId).toBe(world.orgA)
    expectNoForeignIds(payload, world)
  })

  it("принять чужой заказ нельзя", async () => {
    const response = await mAcceptLoadPost(
      makeRequest("POST", "/api/m/route/accept-load", {
        cookie: cookieDriverA,
        body: { orderId: world.orderB, accept: true },
      }),
    )
    expect([403, 404]).toContain(response.status)
    expect(rowOf("order", world.orderB).status).toBe("confirmed")
  })

  it("событие по чужому рейсу не создаётся", async () => {
    const before = memoryDb.count("routeEvent")
    const response = await mRouteEventsPost(
      makeRequest("POST", "/m/route/events", {
        cookie: cookieDriverA,
        body: { routeId: world.routeB, type: "status", status: "arrived" },
      }),
    )
    expect([403, 404]).toContain(response.status)
    expect(memoryDb.count("routeEvent")).toBe(before)
  })

  it("событие своего рейса с чужими ссылками не создаётся, со своими — создаётся", async () => {
    const before = memoryDb.count("routeEvent")

    const foreign = await mRouteEventsPost(
      makeRequest("POST", "/m/route/events", {
        cookie: cookieDriverA,
        body: { routeId: world.routeA, type: "status", status: "arrived", orderId: world.orderB },
      }),
    )
    expect(foreign.status).toBe(404)

    const foreignVehicle = await mRouteEventsPost(
      makeRequest("POST", "/m/route/events", {
        cookie: cookieDriverA,
        body: { routeId: world.routeA, type: "status", status: "arrived", vehicleId: world.vehicleB },
      }),
    )
    expect(foreignVehicle.status).toBe(404)
    expect(memoryDb.count("routeEvent")).toBe(before)

    const own = await mRouteEventsPost(
      makeRequest("POST", "/m/route/events", {
        cookie: cookieDriverA,
        body: {
          routeId: world.routeA,
          type: "status",
          status: "arrived",
          orderId: world.orderA,
          vehicleId: world.vehicleA,
        },
      }),
    )
    expect(own.status).toBeLessThan(300)
    expectNoForeignIds(await jsonOf(own), world)
    const created = memoryDb.rows("routeEvent").at(-1)
    expect(created?.organizationId).toBe(world.orgA)
    expect(created?.orderId).toBe(world.orderA)
  })

  it("сменить машину на чужую нельзя, на свою — можно", async () => {
    const foreign = await mVehiclePost(
      makeRequest("POST", "/api/m/vehicle", {
        cookie: cookieDriverA,
        body: { vehicleId: world.vehicleB },
      }),
    )
    expect(foreign.status).toBe(404)
    expect(rowOf("driver", world.driverA).vehicleId).toBe(world.vehicleA)

    const own = await mVehiclePost(
      makeRequest("POST", "/api/m/vehicle", {
        cookie: cookieDriverA,
        body: { vehicleId: world.vehicleA },
      }),
    )
    expect(own.status).toBeLessThan(300)
  })

  it("геолокация обновляет только своего водителя", async () => {
    const response = await mLocationPost(
      makeRequest("POST", "/api/m/location", {
        cookie: cookieDriverA,
        body: { lat: 55.5, lng: 37.5 },
      }),
    )
    expect(response.status).toBeLessThan(300)
    expect(rowOf("driver", world.driverA).latitude).toBe(55.5)
    expect(rowOf("driver", world.driverA).longitude).toBe(37.5)
    expect(rowOf("driver", world.driverB).latitude ?? null).toBeNull()
  })

  it("SOS водителя создаётся в его организации, чужой заказ не принимается", async () => {
    const response = await mSosPost(
      makeRequest("POST", "/api/m/sos", {
        cookie: cookieDriverA,
        body: { type: "breakdown", latitude: 55.5, longitude: 37.5, message: "сломался" },
      }),
    )
    expect(response.status).toBeLessThan(300)
    const payload = await jsonOf(response)
    const created = memoryDb
      .rows("sosAlert")
      .find((row) => row.id === payload.sos?.id || row.message === "сломался")
    expect(created?.organizationId).toBe(world.orgA)

    const foreignOrder = await mSosPost(
      makeRequest("POST", "/api/m/sos", {
        cookie: cookieDriverA,
        body: {
          type: "breakdown",
          latitude: 55.5,
          longitude: 37.5,
          orderId: world.orderB,
        },
      }),
    )
    expect([403, 404]).toContain(foreignOrder.status)
  })
})

describe("симметрия: организация Б не видит данные организации А", () => {
  it("списки организации Б содержат только её данные", async () => {
    const endpoints: Array<[string, (req: any, ctx?: any) => Promise<Response>]> = [
      ["/api/orders", ordersGet],
      ["/api/drivers", driversGet],
      ["/api/vehicles", vehiclesGet],
      ["/api/routes", routesGet],
      ["/api/fleet", fleetGet],
      ["/api/dashboard/stats", dashboardStatsGet],
      ["/api/chat", chatGet],
      ["/api/sos", sosGet],
      ["/api/payments", paymentsGet],
      ["/api/photos", photosGet],
      ["/api/auth/users", usersGet],
      ["/api/admin/audit", auditGet],
    ]
    const foreignOfB = world.ownIds
    for (const [path, handler] of endpoints) {
      const response = await handler(makeRequest("GET", path, { cookie: cookieB }))
      expect(response.status, `${path} → статус`).toBe(200)
      const serialized = JSON.stringify(await jsonOf(response))
      for (const id of foreignOfB) {
        expect(serialized.includes(id), `${path} не должен содержать ${id}`).toBe(false)
      }
    }
  })
})
