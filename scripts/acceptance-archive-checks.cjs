// Приёмка «архив не выбирается и не назначается» (живой HTTP, ветка fix/archive-checks).
//
// Проверяет:
//   1. DELETE заказа, привязанного к рейсу (RouteStage.orderId) — архив, не удаление;
//   2. POST /api/routes с архивным водителем / архивной машиной → 409;
//   3. POST /api/fleet/assign с архивной машиной / водителем → 409;
//   4. add-load на рейс с заархивированной машиной → 409;
//   5. /api/fleet/insights — архивные машина и водитель отсутствуют в сводке.
// Все данные — изолированная тестовая организация, удаляются в конце.

const BASE = "http://localhost:3000"
const { PrismaClient } = require("@prisma/client")
const p = new PrismaClient()
const out = { steps: [] }

function step(name, ok, detail) {
  out.steps.push({ name, ok, detail })
}

async function api(method, path, { cookie, token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(token ? { "x-csrf-token": token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch {}
  res.rawCookie = res.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ")
  return { status: res.status, json, rawCookie: res.rawCookie }
}

async function purgeOrganization(organizationId) {
  const orders = await p.order.findMany({ where: { organizationId }, select: { id: true } })
  for (const o of orders) {
    await p.orderNegotiation.deleteMany({ where: { orderId: o.id } })
    await p.photo.deleteMany({ where: { orderId: o.id } }).catch(() => {})
  }
  await p.order.deleteMany({ where: { organizationId } })
  await p.routeExpense.deleteMany({ where: { organizationId } })
  await p.routeEvent.deleteMany({ where: { organizationId } })
  await p.routeStage.deleteMany({ where: { organizationId } })
  await p.route.deleteMany({ where: { organizationId } })
  const shifts = await p.driverShift.findMany({ where: { organizationId }, select: { id: true } })
  for (const s of shifts) await p.shiftEvent.deleteMany({ where: { shiftId: s.id } }).catch(() => {})
  await p.driverShift.deleteMany({ where: { organizationId } })
  await p.driver.deleteMany({ where: { organizationId } })
  await p.maintenanceLog.deleteMany({ where: { organizationId } }).catch(() => {})
  await p.vehicle.deleteMany({ where: { organizationId } })
  await p.notification.deleteMany({ where: { organizationId } }).catch(() => {})
  await p.auditLog.deleteMany({ where: { organizationId } }).catch(() => {})
  await p.user.deleteMany({ where: { organizationId } })
  await p.organization.delete({ where: { id: organizationId } })
}

async function main() {
  const pw = "Audit-Checks-2026x!"
  const email = `audit-checks-${Date.now()}@example.test`
  try {
    const csrf = await api("GET", "/api/auth/csrf")
    const cookie0 = csrf.rawCookie
    const token = csrf.json.csrfToken
    const reg = await api("POST", "/api/auth/register", {
      cookie: cookie0, token,
      body: { name: "Аудит Архив Проверки", email, password: pw, organizationName: "АУДИТ-ПРОВЕРКИ-АРХИВА", acceptedTerms: true },
    })
    const orgId = reg.json.organization.id
    const login = await api("POST", "/api/auth/login", { cookie: cookie0, token, body: { email, password: pw } })
    const cookie = cookie0 + "; " + login.rawCookie
    step("регистрация и вход", reg.status === 200 && login.status === 200, `reg=${reg.status} login=${login.status}`)

    // ─── создаём водителя, машину, заказы ───
    const drv = await api("POST", "/api/drivers", { cookie, token, body: { name: "Водитель Проверки", phone: "+79163334455", licenseNumber: "78 78 000404" } })
    const drvId = drv.json.driver.id
    const veh = await api("POST", "/api/vehicles", { cookie, token, body: { plate: "П777ПП750", brand: "MAN", model: "TGX", type: "fura", capacity: 20000, fuelTankL: 500, fuelConsumptionPer100: 30, fuelLevelL: 400 } })
    const vehId = veh.json.vehicle.id
    const drv2 = await api("POST", "/api/drivers", { cookie, token, body: { name: "Водитель Архив", phone: "+79163334456", licenseNumber: "78 78 000405" } })
    const drv2Id = drv2.json.driver.id
    const veh2 = await api("POST", "/api/vehicles", { cookie, token, body: { plate: "А777АА750", brand: "DAF", model: "XF", type: "fura", capacity: 20000, fuelTankL: 500, fuelConsumptionPer100: 30, fuelLevelL: 400 } })
    const veh2Id = veh2.json.vehicle.id
    step("водители и машины созданы", !!drvId && !!vehId && !!drv2Id && !!veh2Id, "")

    const mkOrder = async (sid) =>
      (await api("POST", "/api/orders", { cookie, token, body: {
        clientName: "Клиент Проверки " + sid, routeFrom: "Тула", routeTo: "Калуга", weight: 10,
        cargoType: "general", price: 10000, agreedPrice: 10000, clientContact: "+79007778899",
        source: "manual", sourceId: sid, deadline: "2026-12-31",
      } })).json.order

    // ─── ПРОВЕРКА 1: DELETE заказа в рейсе → архив ───
    const o1 = await mkOrder("CHK-ROUTE-1")
    await api("PATCH", "/api/orders/" + o1.id, { cookie, token, body: { status: "agreed" } })
    const route = await api("POST", "/api/routes", { cookie, token, body: { name: "Рейс Проверки", orderIds: [o1.id], driverId: drvId, vehicleId: vehId } })
    const routeId = route.json.route.id
    // создаём этап рейса, ссылающийся на заказ (как это делает add-load/rebuild)
    const stage = await p.routeStage.create({
      data: { organizationId: orgId, routeId, orderId: o1.id, driverId: drvId, vehicleId: vehId, type: "loading", status: "planned", sequence: 1 },
    })
    const delInRoute = await api("DELETE", "/api/orders/" + o1.id, { cookie, token })
    step("заказ в рейсе: DELETE → архив, не удаление",
      delInRoute.status === 200 && delInRoute.json.archived === true,
      `status=${delInRoute.status} archived=${delInRoute.json.archived}`)
    const stageAfter = await p.routeStage.findUnique({ where: { id: stage.id }, select: { orderId: true } })
    const orderAlive = await p.order.findUnique({ where: { id: o1.id }, select: { id: true, archivedAt: true } })
    step("заказ в рейсе остался в БД, этап рейса не потерял заказ",
      !!orderAlive && stageAfter && stageAfter.orderId === o1.id,
      `order=${!!orderAlive} stageOrderId=${stageAfter && stageAfter.orderId}`)
    // повторное удаление архивного заказа в рейсе — снова архив (не ошибка)
    const delAgain = await api("DELETE", "/api/orders/" + o1.id, { cookie, token })
    step("повторное удаление заказа в рейсе — снова архив (идемпотентно)",
      delAgain.status === 200 && delAgain.json.archived === true, `status=${delAgain.status}`)

    // ─── ПРОВЕРКА 2: POST /api/routes с архивным водителем/машиной ───
    // Готовим состояние «в архиве» так, как его создаёт продакшн-поток
    // (архивирование объекта с историей): archivedAt + статус + отвязка.
    await p.driver.update({ where: { id: drv2Id }, data: { archivedAt: new Date(), status: "offline", vehicleId: null } })
    await p.vehicle.update({ where: { id: veh2Id }, data: { archivedAt: new Date(), status: "maintenance" } })
    const drv2Row = await p.driver.findUnique({ where: { id: drv2Id }, select: { archivedAt: true } })
    const veh2Row = await p.vehicle.findUnique({ where: { id: veh2Id }, select: { archivedAt: true } })
    step("водитель 2 в архиве (подготовка)", !!drv2Row.archivedAt, "")
    step("машина 2 в архиве (подготовка)", !!veh2Row.archivedAt, "")

    const o2 = await mkOrder("CHK-ROUTE-2")
    await api("PATCH", "/api/orders/" + o2.id, { cookie, token, body: { status: "agreed" } })
    const routeArchDrv = await api("POST", "/api/routes", { cookie, token, body: { name: "Рейс с архивным водителем", orderIds: [o2.id], driverId: drv2Id } })
    step("POST /api/routes с архивным водителем → 409",
      routeArchDrv.status === 409 && /архиве/i.test(routeArchDrv.json.error || ""),
      `status=${routeArchDrv.status} err=${(routeArchDrv.json.error || "").slice(0, 60)}`)

    const routeArchVeh = await api("POST", "/api/routes", { cookie, token, body: { name: "Рейс с архивной машиной", orderIds: [o2.id], vehicleId: veh2Id } })
    step("POST /api/routes с архивной машиной → 409",
      routeArchVeh.status === 409 && /архиве/i.test(routeArchVeh.json.error || ""),
      `status=${routeArchVeh.status} err=${(routeArchVeh.json.error || "").slice(0, 60)}`)

    // контроль: с активными водителем/машиной рейс создаётся
    const routeOk = await api("POST", "/api/routes", { cookie, token, body: { name: "Рейс нормальный", orderIds: [o2.id], driverId: drvId, vehicleId: vehId } })
    step("контроль: рейс с активной машиной создаётся", routeOk.status === 200, `status=${routeOk.status}`)
    const route2Id = routeOk.json.route.id

    // ─── ПРОВЕРКА 3: fleet/assign с архивными ───
    const assignArchDrv = await api("POST", "/api/fleet/assign", { cookie, token, body: { driverId: drv2Id, vehicleId: vehId } })
    step("fleet/assign с архивным водителем → 409",
      assignArchDrv.status === 409 && /архиве/i.test(assignArchDrv.json.error || ""),
      `status=${assignArchDrv.status}`)
    const assignArchVeh = await api("POST", "/api/fleet/assign", { cookie, token, body: { driverId: drvId, vehicleId: veh2Id } })
    step("fleet/assign с архивной машиной → 409",
      assignArchVeh.status === 409 && /архиве/i.test(assignArchVeh.json.error || ""),
      `status=${assignArchVeh.status}`)
    const assignOk = await api("POST", "/api/fleet/assign", { cookie, token, body: { driverId: drvId, vehicleId: vehId } })
    step("контроль: fleet/assign с активной парой работает", assignOk.status === 200, `status=${assignOk.status}`)

    // ─── ПРОВЕРКА 4: add-load на рейс с заархивированной машиной ───
    // архивируем машину рейса route2 (с историей → архив), затем add-load
    await p.routeEvent.create({ data: { organizationId: orgId, routeId: route2Id, driverId: drvId, vehicleId: vehId, type: "note", status: "done", address: "проверка архива" } })
    const archRouteVeh = await api("DELETE", "/api/vehicles/" + vehId, { cookie, token })
    step("машина рейса заархивирована", archRouteVeh.status === 200 && archRouteVeh.json.archived === true, `status=${archRouteVeh.status}`)
    const o3 = await mkOrder("CHK-ADDLOAD-1")
    const addLoad = await api("POST", `/api/routes/${route2Id}/add-load`, { cookie, token, body: { orderId: o3.id } })
    step("add-load на рейс с архивной машиной → 409",
      addLoad.status === 409 && /архиве/i.test(addLoad.json.error || ""),
      `status=${addLoad.status} err=${(addLoad.json.error || "").slice(0, 60)}`)

    // ─── ПРОВЕРКА 5: fleet/insights — архивные не в сводке ───
    const insights = await api("GET", "/api/fleet/insights", { cookie })
    // Сводка отдаёт { idle, service, openMaintenance, history, summary } — без «сырых» списков.
    const idleIds = ((insights.json.idle || []).map((v) => v.id))
    const serviceIds = ((insights.json.service || []).map((v) => v.id))
    // history — это Record<vehicleId, назначения[]>
    const historyMap = insights.json.history || {}
    const historyKeys = Object.keys(historyMap)
    const historyDriverIds = []
    for (const key of historyKeys) {
      for (const item of historyMap[key] || []) {
        if (item && item.driverId) historyDriverIds.push(item.driverId)
      }
    }
    const summaryVehicles = insights.json.summary ? insights.json.summary.vehicles : null
    step("fleet/insights: архивные машины не в простое/ТО",
      !idleIds.includes(veh2Id) && !idleIds.includes(vehId) && !serviceIds.includes(veh2Id) && !serviceIds.includes(vehId),
      `idle=${idleIds.length} service=${serviceIds.length}`)
    step("fleet/insights: архивные машины не в ключах истории назначений",
      !historyKeys.includes(veh2Id) && !historyKeys.includes(vehId), `ключей=${historyKeys.length}`)
    step("fleet/insights: архивный водитель не в истории назначений",
      !historyDriverIds.includes(drv2Id), `назначений=${historyDriverIds.length}`)
    step("fleet/insights: счётчик машин считает только активные",
      summaryVehicles === 0, `summary.vehicles=${summaryVehicles}`)

    await purgeOrganization(orgId)
    out.cleanup = { leftover: (await p.organization.findMany({ where: { nameKey: "аудит-проверки-архива" }, select: { id: true } })).length }
  } catch (e) {
    out.fatal = String(e.message).slice(0, 300)
    try {
      const orgs = await p.organization.findMany({ where: { nameKey: "аудит-проверки-архива" }, select: { id: true } })
      for (const o of orgs) await purgeOrganization(o.id)
    } catch {}
  } finally {
    await p.$disconnect()
    const failed = out.steps.filter((s) => !s.ok)
    console.log(JSON.stringify({ passed: out.steps.length - failed.length, total: out.steps.length, failures: failed, cleanup: out.cleanup, fatal: out.fatal }, null, 1))
  }
}

main()
