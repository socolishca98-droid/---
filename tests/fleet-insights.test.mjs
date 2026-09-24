/**
 * Тесты сводки по автопарку (задача 4).
 *
 * Практика вместо «процента загрузки»: простой машин, ближайшие ТО/страховки,
 * открытые работы и история назначений водителей. Всё считается без базы —
 * логика чистая (lib/fleet/insights.ts).
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  SERVICE_WARNING_DAYS,
  buildFleetInsights,
  daysBetween,
  serviceStatus,
} = require("../.test-build/lib/fleet/insights.js")

const NOW = new Date("2026-09-24T10:00:00")

function daysAgo(days) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

function daysAhead(days) {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000)
}

const vehicle = (id, extra = {}) => ({
  id,
  plate: `А${id}АА76`,
  type: "truck",
  brand: "Volvo",
  model: "FH",
  status: "available",
  mileage: 100000,
  lastMaintenanceDate: null,
  nextMaintenanceDate: null,
  insuranceExpiry: null,
  inspectionExpiry: null,
  createdAt: daysAgo(365),
  ...extra,
})

const driver = (id, vehicleId, extra = {}) => ({
  id,
  name: `Водитель ${id}`,
  vehicleId,
  status: "available",
  ...extra,
})

function build(input) {
  return buildFleetInsights({
    vehicles: [],
    drivers: [],
    activeOrders: [],
    routes: [],
    maintenance: [],
    now: NOW,
    ...input,
  })
}

test("дни считаются по календарю, а не по часам", () => {
  assert.equal(daysBetween(new Date("2026-09-20T23:00:00"), new Date("2026-09-21T01:00:00")), 1)
  assert.equal(daysBetween(new Date("2026-09-24T00:30:00"), new Date("2026-09-24T23:30:00")), 0)
  assert.equal(daysBetween(new Date("2026-09-24T10:00:00"), new Date("2026-09-27T10:00:00")), 3)
})

test("состояние даты: просрочено / сегодня / скоро / не скоро", () => {
  assert.equal(serviceStatus(daysAgo(3), NOW), "overdue")
  assert.equal(serviceStatus(daysAhead(0), NOW), "today")
  assert.equal(serviceStatus(daysAhead(5), NOW), "soon")
  assert.equal(serviceStatus(daysAhead(SERVICE_WARNING_DAYS + 1), NOW), null)
  assert.equal(serviceStatus(daysAhead(0), NOW, 0), "today")
})

test("простой считается от последнего рейса, а без рейсов — от даты постановки на учёт", () => {
  const insights = build({
    vehicles: [
      vehicle("1", { createdAt: daysAgo(400) }),
      vehicle("2", { createdAt: daysAgo(200) }),
      vehicle("3", { createdAt: daysAgo(90) }),
    ],
    drivers: [driver("d1", "1"), driver("d2", "3")],
    routes: [
      {
        id: "r1",
        name: "Ярославль — Москва",
        vehicleId: "1",
        driverId: "d1",
        status: "completed",
        createdAt: daysAgo(12),
        startedAt: daysAgo(12),
        completedAt: daysAgo(12),
      },
    ],
  })

  assert.equal(insights.idle.length, 3)
  // дольше всех стоит машина, которая в системе дольше всего и не работала
  assert.equal(insights.idle[0].vehicleId, "2")
  assert.equal(insights.idle[0].idleDays, 200)
  assert.equal(insights.idle[1].vehicleId, "3")
  assert.equal(insights.idle[1].driverName, "Водитель d2")
  assert.equal(insights.idle[2].vehicleId, "1")
  assert.equal(insights.idle[2].idleDays, 12)

  assert.deepEqual(insights.summary.idle, 3)
  // 200, 90 и 12 дней — все три дольше недели
  assert.equal(insights.summary.idleOverWeek, 3)
  assert.equal(insights.summary.working, 0)
})

test("машина с активным заказом не считается простаивающей", () => {
  const insights = build({
    vehicles: [vehicle("1"), vehicle("2")],
    activeOrders: [
      {
        id: "o1",
        assignedVehicleId: "1",
        assignedDriverId: "d1",
        routeFrom: "Москва",
        routeTo: "Тверь",
        status: "control",
      },
    ],
  })

  assert.equal(insights.summary.working, 1)
  assert.equal(insights.summary.idle, 1)
  assert.deepEqual(
    insights.idle.map((item) => item.vehicleId),
    ["2"],
  )
})

test("машины на ТО не попадают в простой", () => {
  const insights = build({
    vehicles: [vehicle("1", { status: "maintenance" }), vehicle("2")],
  })

  assert.equal(insights.summary.idle, 1)
  assert.equal(insights.idle[0].vehicleId, "2")
})

test("предупреждения по ТО/страховке/техосмотру отсортированы по срочности", () => {
  const insights = build({
    vehicles: [
      vehicle("1", {
        nextMaintenanceDate: daysAhead(10),
        insuranceExpiry: daysAhead(400),
        inspectionExpiry: daysAgo(2),
      }),
      vehicle("2", { nextMaintenanceDate: daysAhead(3) }),
    ],
  })

  expectKinds(insights.service, [
    ["1", "inspection", "overdue"],
    ["2", "maintenance", "soon"],
    ["1", "maintenance", "soon"],
  ])

  assert.equal(insights.service[0].daysLeft, -2)
  assert.equal(insights.summary.serviceOverdue, 1)
  assert.equal(insights.summary.serviceSoon, 2)
  assert.equal(insights.summary.service, 3)

  function expectKinds(list, expected) {
    assert.deepEqual(
      list.map((item) => [item.vehicleId, item.kind, item.status]),
      expected,
    )
  }
})

test("просроченная страховка помечается как просроченная, а не «скоро»", () => {
  const insights = build({
    vehicles: [vehicle("1", { insuranceExpiry: daysAgo(30) })],
  })

  assert.equal(insights.service.length, 1)
  assert.equal(insights.service[0].status, "overdue")
  assert.equal(insights.service[0].title, "Страховка")
  assert.equal(insights.service[0].daysLeft, -30)
})

test("открытые работы: только незакрытые и с числом дней", () => {
  const insights = build({
    vehicles: [vehicle("1")],
    maintenance: [
      {
        id: "m1",
        vehicleId: "1",
        type: "repair",
        description: "Замена колодок",
        status: "in_progress",
        startedAt: daysAgo(4),
      },
      {
        id: "m2",
        vehicleId: "1",
        type: "maintenance",
        description: "Плановое ТО",
        status: "completed",
        startedAt: daysAgo(60),
        completedAt: daysAgo(59),
      },
    ],
  })

  assert.equal(insights.openMaintenance.length, 1)
  assert.equal(insights.openMaintenance[0].description, "Замена колодок")
  assert.equal(insights.openMaintenance[0].daysOpen, 4)
  assert.equal(insights.openMaintenance[0].plate, "А1АА76")
  assert.equal(insights.summary.openMaintenance, 1)
})

test("история назначений: свежие сверху, водитель по каждому рейсу, лимит соблюдён", () => {
  const routes = Array.from({ length: 12 }, (_, index) => ({
    id: `route-${index}`,
    name: `Рейс ${index}`,
    vehicleId: "1",
    driverId: index % 2 === 0 ? "d1" : "d2",
    status: "completed",
    createdAt: daysAgo(index + 1),
    startedAt: daysAgo(index + 1),
    completedAt: daysAgo(index),
  }))

  const insights = build({
    vehicles: [vehicle("1")],
    drivers: [driver("d1", "1"), driver("d2", null)],
    routes,
  })

  const history = insights.history["1"]
  assert.equal(history.length, 10)
  assert.equal(history[0].routeId, "route-0")
  assert.equal(history[0].driverName, "Водитель d1")
  assert.equal(history[1].driverName, "Водитель d2")

  // машина без рейсов истории не имеет
  assert.equal(insights.history["2"], undefined)
})

test("текущий рейс помечается как активный в истории", () => {
  const insights = build({
    vehicles: [vehicle("1", { status: "in_use" })],
    drivers: [driver("d1", "1")],
    routes: [
      {
        id: "route-active",
        name: "Рейс в работе",
        vehicleId: "1",
        driverId: "d1",
        status: "active",
        createdAt: daysAgo(1),
        startedAt: daysAgo(1),
        completedAt: null,
      },
    ],
  })

  assert.equal(insights.history["1"][0].isActive, true)
  assert.equal(insights.history["1"][0].completedAt, null)
})

test("рейс без водителя не приписывает машине чужое имя", () => {
  const insights = build({
    vehicles: [vehicle("1")],
    drivers: [driver("d1", "1")],
    routes: [
      {
        id: "route-nodriver",
        name: "Рейс без водителя",
        vehicleId: "1",
        driverId: null,
        status: "completed",
        createdAt: daysAgo(2),
        startedAt: daysAgo(2),
        completedAt: daysAgo(2),
      },
    ],
  })

  assert.equal(insights.history["1"][0].driverName, null)
  assert.equal(insights.history["1"][0].driverId, null)
})
