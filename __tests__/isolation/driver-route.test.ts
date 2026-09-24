// __tests__/isolation/driver-route.test.ts
//
// Передача рейса водителю (задача 3, пункт 3).
//
// Проверяем три вещи, которых раньше не было:
//   1) водитель получает СВОЙ рейс из водительского эндпоинта
//      (GET /api/m/route) — раньше мобильный экран звал штабные роуты и получал 401;
//   2) при назначении и переназначении водителя ему создаётся уведомление
//      (POST /api/routes, PATCH /api/routes/[routeId]) и оно не дублируется;
//   3) смена статуса своего заказа доступна только водителю этого заказа и
//      только в этап «Контроль» (PATCH /api/m/orders/[id]).
//
// Всё — через настоящие роуты с настоящими сессиями: единственная заглушка —
// in-memory хранилище вместо Prisma (__tests__/__mocks__/prisma-memory.ts).
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

import { GET as mobileRouteGet } from "@/app/api/m/route/route"
import { GET as mobileNotificationsGet, POST as mobileNotificationsPost } from "@/app/api/m/notifications/route"
import { PATCH as mobileOrderPatch } from "@/app/api/m/orders/[id]/route"
import { POST as routesPost } from "@/app/api/routes/route"
import { PATCH as routePatch } from "@/app/api/routes/[routeId]/route"

let world: World
let cookieA: string
let cookieB: string
let cookieDriverA: string
let cookieDriverB: string

/** Точка рейса: заказ, привязанный к рейсу и водителю. */
function seedPoint(
  slug: string,
  overrides: Record<string, unknown> = {},
): string {
  const id = cid(slug)
  memoryDb.insert("order", {
    id,
    organizationId: world.orgA,
    routeId: world.routeA,
    assignedDriverId: world.driverA,
    assignedVehicleId: world.vehicleA,
    source: "manual",
    routeFrom: "Москва",
    routeTo: "Казань",
    distance: 800,
    weight: 10,
    price: 45000,
    cargoType: "Груз",
    clientContact: "",
    clientName: "Клиент А",
    status: "in_route",
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    routeSequence: 1,
    ...overrides,
  })
  return id
}

/** Уведомления водителя А (как их видит мобильное приложение). */
async function driverNotifications(cookie = cookieDriverA) {
  const response = await mobileNotificationsGet(
    makeRequest("GET", "/api/m/notifications", { cookie }),
  )
  const data = await jsonOf(response)
  return { response, data }
}

function notificationsOf(userId: string) {
  return memoryDb.rows("notification").filter((row) => row.userId === userId)
}

beforeEach(async () => {
  world = seedWorld()

  // Заказы seedWorld сразу привязаны к рейсам — тесты сами решают, что в рейсе
  for (const id of [world.orderA, world.orderB]) {
    const row = memoryDb.find("order", id)
    if (row) {
      row.routeId = null
      row.routeSequence = null
    }
  }

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
})

describe("рейс водителя в мобильном приложении (GET /api/m/route)", () => {
  it("без сессии — 401, со штабной сессией — тоже 401", async () => {
    const anonymous = await mobileRouteGet(makeRequest("GET", "/api/m/route"))
    expect(anonymous.status).toBe(401)

    // водительский роут читает только водительскую cookie
    const staff = await mobileRouteGet(
      makeRequest("GET", "/api/m/route", { cookie: cookieA }),
    )
    expect(staff.status).toBe(401)
  })

  it("отдаёт рейс водителя: точки по порядку объезда и итоги", async () => {
    seedPoint("mob1", { routeSequence: 1 })
    seedPoint("mob2", {
      routeSequence: 2,
      routeFrom: "Казань",
      routeTo: "Тула",
      status: "delivered",
      distance: 400,
      price: 20000,
    })

    const response = await mobileRouteGet(
      makeRequest("GET", "/api/m/route", { cookie: cookieDriverA }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.route.id).toBe(world.routeA)
    expect(data.route.ordersCount).toBe(2)
    expect(data.route.completedCount).toBe(1)
    expect(data.route.totalDistance).toBe(1200)
    expect(data.route.totalPrice).toBe(65000)
    expect(data.route.vehiclePlate).toBe("А001АА77")

    // порядок объезда — по routeSequence, а не по времени создания
    expect(data.route.points.map((p: any) => p.sequence)).toEqual([1, 2])
    expect(data.route.points[0].statusLabel).toBe("В рейсе")
    expect(data.route.points[0].isClosed).toBe(false)
    expect(data.route.points[1].isDone).toBe(true)

    // «в работе» — канон lib/orders/stages.ts
    expect(data.activeStatuses).toContain("control")
  })

  it("водитель Б не видит ни рейс, ни точки организации А", async () => {
    seedPoint("mobForeign1")

    const response = await mobileRouteGet(
      makeRequest("GET", "/api/m/route", { cookie: cookieDriverB }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    // у водителя Б свой рейс (из seedWorld), и в нём нет заказов А
    expect(data.route.id).toBe(world.routeB)
    expect(data.route.points).toHaveLength(0)
  })

  it("отдаёт только догрузы, предложенные этому водителю", async () => {
    memoryDb.insert("order", {
      id: cid("proposedA"),
      organizationId: world.orgA,
      assignedDriverId: world.driverA,
      proposedToDriver: true,
      routeFrom: "Тула",
      routeTo: "Орёл",
      status: "agreed",
      distance: 300,
      weight: 3000,
      price: 15000,
      cargoType: "Догруз",
      clientContact: "",
    })
    memoryDb.insert("order", {
      id: cid("proposedB"),
      organizationId: world.orgB,
      assignedDriverId: world.driverB,
      proposedToDriver: true,
      routeFrom: "Псков",
      routeTo: "Питер",
      status: "agreed",
      distance: 300,
      weight: 3000,
      price: 15000,
      cargoType: "Чужой догруз",
      clientContact: "",
    })

    const response = await mobileRouteGet(
      makeRequest("GET", "/api/m/route", { cookie: cookieDriverA }),
    )
    const data = await jsonOf(response)

    expect(data.proposedLoads).toHaveLength(1)
    expect(data.proposedLoads[0].cargoType).toBe("Догруз")
    expect(JSON.stringify(data)).not.toContain(world.driverB)
  })
})

describe("уведомление водителю о назначенном рейсе", () => {
  it("при сборке рейса с водителем — уведомление в его учётной записи", async () => {
    const orderId = seedPoint("assign1")
    const row = memoryDb.find("order", orderId)
    if (row) {
      row.routeId = null
      row.status = "agreed"
    }

    const response = await routesPost(
      makeRequest("POST", "/api/routes", {
        cookie: cookieA,
        body: { orderIds: [orderId], driverId: world.driverA, vehicleId: world.vehicleA },
      }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    const created = notificationsOf(world.driverUserA)
    expect(created).toHaveLength(1)
    expect(created[0].type).toBe("route_assigned")
    expect(created[0].routeId).toBe(data.route.id)
    expect(created[0].organizationId).toBe(world.orgA)
    expect(created[0].priority).toBe("high")
    expect(String(created[0].message)).toContain("Назначил: Админ А")

    // водителю из другой организации уведомление не создаётся
    expect(notificationsOf(world.driverUserB)).toHaveLength(0)
  })

  it("рейс без водителя уведомлений не создаёт", async () => {
    const orderId = seedPoint("assign2")
    const row = memoryDb.find("order", orderId)
    if (row) {
      row.routeId = null
      row.status = "agreed"
    }

    const response = await routesPost(
      makeRequest("POST", "/api/routes", {
        cookie: cookieA,
        body: { orderIds: [orderId] },
      }),
    )

    expect(response.status).toBe(200)
    expect(notificationsOf(world.driverUserA)).toHaveLength(0)
  })

  it("чужой водитель не назначается: 404 и без уведомлений", async () => {
    const orderId = seedPoint("assign3")
    const row = memoryDb.find("order", orderId)
    if (row) {
      row.routeId = null
      row.status = "agreed"
    }

    const response = await routesPost(
      makeRequest("POST", "/api/routes", {
        cookie: cookieA,
        body: { orderIds: [orderId], driverId: world.driverB },
      }),
    )

    expect(response.status).toBe(404)
    expect(notificationsOf(world.driverUserB)).toHaveLength(0)
    expect(notificationsOf(world.driverUserA)).toHaveLength(0)
  })

  it("переназначение водителя уведомляет нового и не дублирует при повторном сохранении", async () => {
    const orderId = seedPoint("reassign1")

    // первый раз: рейс переходит с водителя Б (чужой организации быть не может —
    // рейс А, поэтому сначала снимаем водителя) на водителя А
    const cleared = memoryDb.find("route", world.routeA)
    if (cleared) {
      cleared.driverId = null
    }

    const first = await routePatch(
      makeRequest("PATCH", `/api/routes/${world.routeA}`, {
        cookie: cookieA,
        body: { driverId: world.driverA },
      }),
      routeContext({ routeId: world.routeA }),
    )
    expect(first.status).toBe(200)

    const afterFirst = notificationsOf(world.driverUserA)
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0].routeId).toBe(world.routeA)

    // повторное сохранение того же водителя — без нового уведомления
    const second = await routePatch(
      makeRequest("PATCH", `/api/routes/${world.routeA}`, {
        cookie: cookieA,
        body: { driverId: world.driverA },
      }),
      routeContext({ routeId: world.routeA }),
    )
    expect(second.status).toBe(200)
    expect(notificationsOf(world.driverUserA)).toHaveLength(1)

    // переназначение на другого водителя организации — новое уведомление
    const another = cid("drivera2")
    memoryDb.insert("driver", {
      id: another,
      organizationId: world.orgA,
      name: "Второй водитель А",
      phone: "+79000000009",
      vehicleType: "truck",
      status: "available",
    })
    const anotherUser = cid("userdrivera2")
    memoryDb.insert("user", {
      id: anotherUser,
      organizationId: world.orgA,
      name: "Второй водитель А",
      phone: "+79000000009",
      passwordHash: "x",
      passwordSalt: "x",
      role: "driver",
      status: "active",
      driverId: another,
    })

    // машина рейса закреплена за прежним водителем: сначала освобождаем её
    // (иначе PATCH честно отвечает 409 «машина уже закреплена»), затем назначаем
    const third = await routePatch(
      makeRequest("PATCH", `/api/routes/${world.routeA}`, {
        cookie: cookieA,
        body: { driverId: another, vehicleId: null },
      }),
      routeContext({ routeId: world.routeA }),
    )
    expect(third.status).toBe(200)
    expect(notificationsOf(anotherUser)).toHaveLength(1)
    // прежний водитель больше ничего не получает
    expect(notificationsOf(world.driverUserA)).toHaveLength(1)

    const assigned = memoryDb.find("order", orderId)
    expect(assigned?.assignedDriverId).toBe(another)
  })

  it("у водителя без учётной записи уведомление не выдумывается", async () => {
    const noAccountDriver = cid("drivernoacc")
    memoryDb.insert("driver", {
      id: noAccountDriver,
      organizationId: world.orgA,
      name: "Водитель без приложения",
      phone: "+79000000055",
      vehicleType: "truck",
      status: "available",
    })

    const before = memoryDb.rows("notification").length

    // машину освобождаем: она закреплена за водителем А, и PATCH честно
    // отказал бы 409 — проверяем именно уведомление, а не конфликт машины
    const response = await routePatch(
      makeRequest("PATCH", `/api/routes/${world.routeA}`, {
        cookie: cookieA,
        body: { driverId: noAccountDriver, vehicleId: null },
      }),
      routeContext({ routeId: world.routeA }),
    )

    expect(response.status).toBe(200)
    // никому не создали уведомление: получателя нет
    expect(memoryDb.rows("notification")).toHaveLength(before)
    expect(memoryDb.rows("notification").filter((row) => row.driverId === noAccountDriver)).toHaveLength(0)
  })
})

describe("уведомления водителя (GET/POST /api/m/notifications)", () => {
  function seedNotification(slug: string, userId: string, extra: Record<string, unknown> = {}) {
    const id = cid(slug)
    memoryDb.insert("notification", {
      id,
      organizationId: world.orgA,
      userId,
      type: "route_assigned",
      title: "Назначен рейс",
      message: "Вам назначен рейс",
      priority: "high",
      isRead: false,
      routeId: world.routeA,
      createdAt: new Date(),
      ...extra,
    })
    return id
  }

  it("отдаёт только свои уведомления", async () => {
    seedNotification("notifyMine", world.driverUserA)
    seedNotification("notifyOther", world.driverUserB, {
      organizationId: world.orgB,
      routeId: world.routeB,
      message: "Чужое уведомление",
    })
    seedNotification("notifyColleague", world.adminA, {
      title: "Штабное",
    })

    const { response, data } = await driverNotifications()

    expect(response.status).toBe(200)
    expect(data.notifications).toHaveLength(1)
    expect(data.notifications[0].message).toBe("Вам назначен рейс")
    expect(JSON.stringify(data)).not.toContain("Чужое уведомление")
    expect(JSON.stringify(data)).not.toContain("Штабное")
  })

  it("read / readAll / remove / clear меняют только свои уведомления", async () => {
    const mine = seedNotification("notifyRead", world.driverUserA)
    const foreign = seedNotification("notifyForeign", world.driverUserB, {
      organizationId: world.orgB,
      routeId: world.routeB,
    })

    // чужим id пометить прочитанным нельзя
    await mobileNotificationsPost(
      makeRequest("POST", "/api/m/notifications", {
        cookie: cookieDriverA,
        body: { action: "read", id: foreign },
      }),
    )
    expect(memoryDb.find("notification", foreign)?.isRead).toBe(false)

    // свой — можно
    const marked = await mobileNotificationsPost(
      makeRequest("POST", "/api/m/notifications", {
        cookie: cookieDriverA,
        body: { action: "read", id: mine },
      }),
    )
    expect(await jsonOf(marked)).toEqual({ success: true })
    expect(memoryDb.find("notification", mine)?.isRead).toBe(true)

    // удалить чужое нельзя
    await mobileNotificationsPost(
      makeRequest("POST", "/api/m/notifications", {
        cookie: cookieDriverA,
        body: { action: "remove", id: foreign },
      }),
    )
    expect(memoryDb.find("notification", foreign)).toBeTruthy()

    // clear удаляет только свои
    seedNotification("notifyExtraRead", world.driverUserA)
    await mobileNotificationsPost(
      makeRequest("POST", "/api/m/notifications", {
        cookie: cookieDriverA,
        body: { action: "clear" },
      }),
    )
    expect(notificationsOf(world.driverUserA)).toHaveLength(0)
    expect(memoryDb.find("notification", foreign)).toBeTruthy()
  })

  it("readAll отмечает прочитанными только свои", async () => {
    seedNotification("notifyAllMine", world.driverUserA)
    const foreign = seedNotification("notifyAllForeign", world.driverUserB, {
      organizationId: world.orgB,
      routeId: world.routeB,
    })

    await mobileNotificationsPost(
      makeRequest("POST", "/api/m/notifications", {
        cookie: cookieDriverA,
        body: { action: "readAll" },
      }),
    )

    expect(notificationsOf(world.driverUserA).every((row) => row.isRead === true)).toBe(true)
    expect(memoryDb.find("notification", foreign)?.isRead).toBe(false)
  })

  it("без сессии — 401, неизвестное действие — 400", async () => {
    const anonymous = await mobileNotificationsGet(makeRequest("GET", "/api/m/notifications"))
    expect(anonymous.status).toBe(401)

    const unknown = await mobileNotificationsPost(
      makeRequest("POST", "/api/m/notifications", {
        cookie: cookieDriverA,
        body: { action: "launch" },
      }),
    )
    expect(unknown.status).toBe(400)

    const withoutId = await mobileNotificationsPost(
      makeRequest("POST", "/api/m/notifications", {
        cookie: cookieDriverA,
        body: { action: "read" },
      }),
    )
    expect(withoutId.status).toBe(400)
  })
})

describe("смена статуса своего заказа водителем (PATCH /api/m/orders/[id])", () => {
  it("без сессии — 401, со штабной — тоже 401", async () => {
    const orderId = seedPoint("driverStatusAuth")

    const anonymous = await mobileOrderPatch(
      makeRequest("PATCH", `/api/m/orders/${orderId}`, { body: { status: "control" } }),
      routeContext({ id: orderId }),
    )
    expect(anonymous.status).toBe(401)

    // штабная cookie водительский роут не открывает
    const staff = await mobileOrderPatch(
      makeRequest("PATCH", `/api/m/orders/${orderId}`, {
        cookie: cookieA,
        body: { status: "control" },
      }),
      routeContext({ id: orderId }),
    )
    expect(staff.status).toBe(401)
  })

  it("чужой заказ — 404, закрытый — 400", async () => {
    const orderId = seedPoint("driverStatusOwn")

    const foreign = await mobileOrderPatch(
      makeRequest("PATCH", `/api/m/orders/${orderId}`, {
        cookie: cookieDriverB,
        body: { status: "control" },
      }),
      routeContext({ id: orderId }),
    )
    expect(foreign.status).toBe(404)

    const delivered = memoryDb.find("order", orderId)
    if (delivered) {
      delivered.status = "delivered"
    }

    const closed = await mobileOrderPatch(
      makeRequest("PATCH", `/api/m/orders/${orderId}`, {
        cookie: cookieDriverA,
        body: { status: "control" },
      }),
      routeContext({ id: orderId }),
    )
    expect(closed.status).toBe(400)
  })

  it("водитель может только начать исполнение: иной этап — 403", async () => {
    const orderId = seedPoint("driverStatusForbidden")

    const response = await mobileOrderPatch(
      makeRequest("PATCH", `/api/m/orders/${orderId}`, {
        cookie: cookieDriverA,
        body: { status: "delivered" },
      }),
      routeContext({ id: orderId }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(403)
    expect(data.allowed).toEqual(["control"])
    expect(memoryDb.find("order", orderId)?.status).toBe("in_route")
  })

  it("начало рейса: статус, лента заказа и событие рейса; повтор — без дублей", async () => {
    const orderId = seedPoint("driverStatusStart")

    const response = await mobileOrderPatch(
      makeRequest("PATCH", `/api/m/orders/${orderId}`, {
        cookie: cookieDriverA,
        body: { status: "control" },
      }),
      routeContext({ id: orderId }),
    )
    const data = await jsonOf(response)

    expect(response.status).toBe(200)
    expect(data).toMatchObject({ success: true, status: "control", changed: true })
    expect(memoryDb.find("order", orderId)?.status).toBe("control")

    // история заказа: переход виден логисту
    const notes = memoryDb.rows("orderNegotiation")
    expect(notes).toHaveLength(1)
    expect(notes[0].orderId).toBe(orderId)
    expect(notes[0].organizationId).toBe(world.orgA)

    // таймлайн рейса: событие от водителя по этому заказу
    const events = memoryDb.rows("routeEvent").filter((row) => row.orderId === orderId)
    expect(events).toHaveLength(1)
    expect(events[0].routeId).toBe(world.routeA)
    expect(events[0].driverId).toBe(world.driverA)

    // повторная отправка того же этапа (экран водителя опрашивает состояние)
    const repeat = await mobileOrderPatch(
      makeRequest("PATCH", `/api/m/orders/${orderId}`, {
        cookie: cookieDriverA,
        body: { status: "control" },
      }),
      routeContext({ id: orderId }),
    )
    const repeatData = await jsonOf(repeat)

    expect(repeatData).toMatchObject({ success: true, status: "control", changed: false })
    expect(memoryDb.rows("orderNegotiation")).toHaveLength(1)
    expect(memoryDb.rows("routeEvent").filter((row) => row.orderId === orderId)).toHaveLength(1)
  })
})
