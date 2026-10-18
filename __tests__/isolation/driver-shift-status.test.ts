// __tests__/isolation/driver-shift-status.test.ts
//
// Кнопки состояний водителя должны доходить до сервера и считаться.
//
// Раньше главный экран водителя отправлял { action: "status" }, а роут знал
// только «начать смену»: кнопка «Погрузка» отвечала success и ничего не
// меняла. Здесь проверяется обратное — каждое нажатие пишет событие в журнал
// смены, итоги по группам растут, отдых попадает в рейс, а чужая организация
// не получает ни одного события.
//
// Запуск: npm run test:isolation

import { beforeEach, describe, expect, it } from "vitest"

import { GET as shiftGet, POST as shiftPost } from "@/app/api/m/shift/route"

import { memoryDb } from "../__mocks__/prisma-memory"
import { jsonOf, makeRequest, seedWorld, sessionCookie, type World } from "./helpers"

let world: World
let cookieDriverA: string
let cookieDriverB: string

/** Своя смена для водителя А: управляем временем последней смены статуса. */
function seedShift(minutesAgo: number, status = "driving") {
  const startedAt = new Date(Date.now() - minutesAgo * 60 * 1000)
  memoryDb.remove("driverShift", world.shiftA)
  memoryDb.insert("driverShift", {
    id: world.shiftA,
    organizationId: world.orgA,
    driverId: world.driverA,
    status,
    startedAt,
    endedAt: null,
    lastStatusChangeAt: startedAt,
    drivingSinceRestSeconds: 0,
  })
  // Журнал начинается вместе со сменой — как это делает настоящий старт
  memoryDb.remove("shiftEvent", (row: any) => row.shiftId === world.shiftA)
  memoryDb.insert("shiftEvent", {
    id: `${world.shiftA}-start`,
    organizationId: world.orgA,
    shiftId: world.shiftA,
    type: "status",
    createdAt: startedAt,
    metadata: JSON.stringify({ from: null, to: status, seconds: 0, reason: "shift_start" }),
  })
  return startedAt
}

/** Отодвинуть момент последней смены статуса: иначе шаги цепочки нулевые. */
function backdateStatus(minutesAgo: number) {
  const shift = memoryDb.find("driverShift", world.shiftA)
  memoryDb.remove("driverShift", world.shiftA)
  memoryDb.insert("driverShift", {
    ...shift,
    lastStatusChangeAt: new Date(Date.now() - minutesAgo * 60 * 1000),
  })
}

/** Заказ водителя А в статусе «контроль» — значит, рейс активен. */
function makeOrderActive() {
  memoryDb.remove("order", world.orderA)
  memoryDb.insert("order", {
    id: world.orderA,
    organizationId: world.orgA,
    source: "manual",
    routeFrom: "Москва",
    routeTo: "Казань",
    distance: 800,
    weight: 10,
    cargoType: "Груз",
    clientContact: "",
    clientName: "Клиент",
    deadline: new Date(Date.now() + 86_400_000),
    status: "control",
    price: 100000,
    routeId: world.routeA,
    assignedDriverId: world.driverA,
    assignedVehicleId: world.vehicleA,
  })
}

async function changeStatus(cookie: string, status: string) {
  const response = await shiftPost(
    makeRequest("POST", "/api/m/shift", {
      cookie,
      body: { action: "status", status },
    }),
  )
  return { response, payload: await jsonOf(response) }
}

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

describe("смена водителя: состояния и время", () => {
  it("начало смены пишет первое событие журнала", async () => {
    memoryDb.remove("driverShift", world.shiftA)
    makeOrderActive()

    const payload = await jsonOf(
      await shiftPost(
        makeRequest("POST", "/api/m/shift", { cookie: cookieDriverA, body: { action: "start" } }),
      ),
    )

    expect(payload.success).toBe(true)
    expect(payload.shift.status).toBe("driving")
    expect(payload.statuses.length).toBeGreaterThan(0)

    const shifts = memoryDb.rows("driverShift").filter((row) => row.driverId === world.driverA)
    const events = memoryDb
      .rows("shiftEvent")
      .filter((row) => row.shiftId === shifts[shifts.length - 1].id && row.type === "status")
    expect(events).toHaveLength(1)
    const meta = JSON.parse(events[0].metadata)
    expect(meta.to).toBe("driving")
    expect(meta.reason).toBe("shift_start")
  })

  it("кнопка «Погрузка» учитывает время предыдущего статуса", async () => {
    seedShift(30)
    makeOrderActive()

    const { payload } = await changeStatus(cookieDriverA, "loading")

    expect(payload.success).toBe(true)
    expect(payload.shift.status).toBe("loading")
    // Полчаса в пути — и это время ушло в группу «в пути»
    expect(payload.totals.driving).toBeGreaterThanOrEqual(1790)
    expect(payload.totals.driving).toBeLessThanOrEqual(1810)

    const events = memoryDb.rows("shiftEvent").filter((row) => row.shiftId === world.shiftA)
    const last = JSON.parse(events[events.length - 1].metadata)
    expect(last.from).toBe("driving")
    expect(last.to).toBe("loading")
    expect(last.seconds).toBeGreaterThanOrEqual(1790)
  })

  it("цепочка рейса копится в итогах по группам", async () => {
    seedShift(10)
    makeOrderActive()

    // Полчаса в пути, потом погрузка, снова путь, выгрузка и ожидание на точке
    await changeStatus(cookieDriverA, "loading")
    backdateStatus(20)
    const driving = await changeStatus(cookieDriverA, "driving")
    backdateStatus(35)
    const unloading = await changeStatus(cookieDriverA, "unloading")
    backdateStatus(10)
    const waiting = await changeStatus(cookieDriverA, "waiting_point")

    // Длительность каждого законченного статуса приходит в ответе
    expect(driving.payload.seconds).toBeGreaterThanOrEqual(1190) // погрузка ~20 мин
    expect(unloading.payload.seconds).toBeGreaterThanOrEqual(2090) // путь ~35 мин
    expect(waiting.payload.seconds).toBeGreaterThanOrEqual(590) // выгрузка ~10 мин

    const shiftRow = memoryDb.find("driverShift", world.shiftA)
    expect(Number(shiftRow?.totalLoadingSeconds)).toBeGreaterThanOrEqual(1190)
    expect(Number(shiftRow?.totalDrivingSeconds)).toBeGreaterThanOrEqual(600)

    // Порядок отрезков в журнале = порядок работы рейса
    const snapshot = await jsonOf(
      await shiftGet(makeRequest("GET", "/api/m/shift", { cookie: cookieDriverA })),
    )
    expect(snapshot.shift.status).toBe("waiting_point")
    expect(snapshot.segments.map((segment: any) => segment.status)).toEqual([
      "driving",
      "loading",
      "driving",
      "unloading",
      "waiting_point",
    ])
  })

  it("отдых пишется в рейс и возвращается прежним статусом", async () => {
    seedShift(20)
    makeOrderActive()

    const rest = await changeStatus(cookieDriverA, "resting")
    expect(rest.payload.success).toBe(true)
    expect(rest.payload.rest.resting).toBe(true)

    const routeEvents = memoryDb.rows("routeEvent").filter((row) => row.driverId === world.driverA)
    expect(routeEvents.map((row) => row.status)).toContain("rest_start")

    const back = await changeStatus(cookieDriverA, "driving")
    expect(back.payload.rest.resting).toBe(false)
    const after = memoryDb.rows("routeEvent").filter((row) => row.driverId === world.driverA)
    expect(after.map((row) => row.status)).toContain("rest_end")
  })

  it("неизвестный статус отклоняется", async () => {
    seedShift(5)
    const { response, payload } = await changeStatus(cookieDriverA, "телепортация")
    expect(response.status).toBe(400)
    expect(payload.success).toBe(false)
  })

  it("повторное нажатие того же статуса не удваивает время", async () => {
    seedShift(15)
    makeOrderActive()

    await changeStatus(cookieDriverA, "loading")
    backdateStatus(15)
    const before = memoryDb.rows("shiftEvent").filter((row) => row.shiftId === world.shiftA).length

    const repeat = await changeStatus(cookieDriverA, "loading")
    expect(repeat.payload.success).toBe(true)
    expect(repeat.payload.seconds).toBe(0)

    const after = memoryDb.rows("shiftEvent").filter((row) => row.shiftId === world.shiftA).length
    expect(after).toBe(before)
  })

  it("завершение смены закрывает её и не теряет время", async () => {
    seedShift(40)
    makeOrderActive()

    await changeStatus(cookieDriverA, "loading")
    const payload = await jsonOf(
      await shiftPost(
        makeRequest("POST", "/api/m/shift", { cookie: cookieDriverA, body: { action: "end" } }),
      ),
    )

    expect(payload.success).toBe(true)
    const shift = memoryDb.find("driverShift", world.shiftA)
    expect(shift?.endedAt).toBeInstanceOf(Date)
    // Время, которое смена была «в пути», попало в итоги
    expect(Number(shift?.totalDrivingSeconds)).toBeGreaterThan(0)

    // После закрытия статусы менять нельзя
    const after = await changeStatus(cookieDriverA, "driving")
    expect(after.response.status).toBe(400)
  })
})

describe("изоляция организаций", () => {
  it("чужая смена не трогается, а своих событий у неё нет", async () => {
    seedShift(25)
    makeOrderActive()

    const shiftBBefore = memoryDb.find("driverShift", world.shiftB)

    await changeStatus(cookieDriverA, "loading")
    await changeStatus(cookieDriverA, "resting")

    const shiftBAfter = memoryDb.find("driverShift", world.shiftB)
    expect(shiftBAfter?.status).toBe(shiftBBefore?.status)
    expect(shiftBAfter?.lastStatusChangeAt).toEqual(shiftBBefore?.lastStatusChangeAt)

    // Ни одного события смены в чужой организации
    const foreignEvents = memoryDb.rows("shiftEvent").filter((row) => row.organizationId === world.orgB)
    expect(foreignEvents).toHaveLength(0)

    // И отдых чужого водителя не записан
    const foreignRest = memoryDb
      .rows("routeEvent")
      .filter((row) => row.organizationId === world.orgB && row.status === "rest_start")
    expect(foreignRest).toHaveLength(0)
  })

  it("водитель без своей смены не может выставить статус", async () => {
    memoryDb.remove("driverShift", world.shiftB)
    const { response, payload } = await changeStatus(cookieDriverB, "loading")
    expect(response.status).toBe(400)
    expect(payload.error).toMatch(/Смена не начата/)
  })
})
