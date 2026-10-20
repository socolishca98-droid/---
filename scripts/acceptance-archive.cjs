// Приёмка этапа «сохранность данных и идемпотентность» (живой HTTP).
//
// Проверяет: удаление/архивирование заказа (чистый, с переговорами, оплаченный,
// доставленный), архивирование водителя и машины с историей, скрытие архивных
// из списков и выбора, наличие архивных в платёжном экспорте, повторное и
// параллельное завершение рейса, записи AuditLog.
// Все данные — изолированная тестовая организация, удаляется в конце.
const BASE = "http://localhost:3000"
const { PrismaClient } = require("@prisma/client")
const p = new PrismaClient()
const out = { steps: [], cleanup: {} }

async function api(method, path, { cookie, token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...(token ? { "x-csrf-token": token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json, raw: res }
}

function step(name, ok, detail) {
  out.steps.push({ name, ok, detail })
}

// Полная уборка тестовой организации (данные изолированы и удаляются)
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
  const pw = "Audit-Integrity-2026x!"
  const email = `audit-integrity-${Date.now()}@example.test`
  try {
  const csrf = await api("GET", "/api/auth/csrf")
  const cookie0 = csrf.raw.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
  const token = csrf.json.csrfToken
  const reg = await api("POST", "/api/auth/register", { cookie: cookie0, token, body: { name: "Аудит Целостность", email, password: pw, organizationName: "АУДИТ-ЦЕЛОСТНОСТЬ", acceptedTerms: true } })
  step("регистрация компании", reg.status === 200 && reg.json.success, `status=${reg.status}`)
  const orgId = reg.json.organization.id
  const login = await api("POST", "/api/auth/login", { cookie: cookie0, token, body: { email, password: pw } })
  step("вход админа", login.status === 200, `status=${login.status}`)
  const cookie = cookie0 + "; " + login.raw.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")

  // водитель + машина
  const drv = await api("POST", "/api/drivers", { cookie, token, body: { name: "Водитель Цел", phone: "+79164444444", licenseNumber: "99 99 000004" } })
  const drvId = drv.json.driver.id
  const veh = await api("POST", "/api/vehicles", { cookie, token, body: { plate: "Ц777ЦЦ750", brand: "Volvo", model: "FH", type: "fura", capacity: 20000, fuelTankL: 500, fuelConsumptionPer100: 30, fuelLevelL: 400 } })
  const vehId = veh.json.vehicle.id
  step("водитель и машина созданы", !!drvId && !!vehId, `driver=${drvId} vehicle=${vehId}`)

  const mkOrder = async (sid, extra = {}) => {
    const r = await api("POST", "/api/orders", { cookie, token, body: {
      clientName: "Клиент Цел " + sid, routeFrom: "Тула", routeTo: "Калуга", weight: 10, cargoType: "general",
      price: 50000, agreedPrice: 55000, clientContact: "+79005556677", source: "manual", sourceId: sid, deadline: "2026-12-31",
      ...extra,
    } })
    return r
  }

  // ── A. Чистый заказ → физическое удаление ──
  const clean = await mkOrder("CLEAN-1")
  const cleanId = clean.json.order.id
  const delClean = await api("DELETE", "/api/orders/" + cleanId, { cookie, token })
  step("чистый заказ удалён физически", delClean.status === 200 && !delClean.json.archived, `status=${delClean.status}`)
  const gone = await api("GET", "/api/orders/" + cleanId, { cookie })
  step("удалённый заказ не найден", gone.status === 404, `status=${gone.status}`)

  // ── B. Заказ с переговорами → архив ──
  const hist = await mkOrder("HIST-1")
  const histId = hist.json.order.id
  await api("POST", "/api/orders/" + histId + "/negotiation", { cookie, token, body: { kind: "note", text: "Аудит: переговоры" } })
  const delHist = await api("DELETE", "/api/orders/" + histId, { cookie, token })
  step("заказ с переговорами архивирован", delHist.status === 200 && delHist.json.archived === true, `status=${delHist.status}`)
  const stillThere = await p.order.findUnique({ where: { id: histId }, select: { archivedAt: true } })
  step("архивный заказ остался в базе с archivedAt", !!stillThere && !!stillThere.archivedAt, `archivedAt=${stillThere && stillThere.archivedAt}`)
  const negotiationsKept = await p.orderNegotiation.count({ where: { orderId: histId } })
  step("переговоры архивного заказа на месте", negotiationsKept > 0, `записей=${negotiationsKept}`)
  const listAfter = await api("GET", "/api/orders?limit=200", { cookie })
  const listIds = ((listAfter.json.orders || []).map((o) => o.id))
  step("архивный заказ скрыт из рабочего списка", !listIds.includes(histId), `в списке=${listIds.includes(histId)}`)

  // ── C. Оплаченный заказ → 409 ──
  const paid = await mkOrder("PAID-1")
  const paidId = paid.json.order.id
  await api("PATCH", "/api/payments", { cookie, token, body: { orderId: paidId, isPaid: true } })
  const delPaid = await api("DELETE", "/api/orders/" + paidId, { cookie, token })
  step("оплаченный заказ: 409 с текстом", delPaid.status === 409 && /оплачен/i.test(delPaid.json.error || ""), `status=${delPaid.status} err=${(delPaid.json.error || "").slice(0, 60)}`)
  const paidAlive = await p.order.findUnique({ where: { id: paidId }, select: { id: true, isPaid: true } })
  step("оплаченный заказ не удалён", !!paidAlive && paidAlive.isPaid, "")

  // ── D. Доставленный заказ → 409 ──
  const delivered = await mkOrder("DELIV-1")
  const deliveredId = delivered.json.order.id
  await api("PATCH", "/api/orders/" + deliveredId, { cookie, token, body: { status: "agreed" } })
  await api("PATCH", "/api/orders/" + deliveredId, { cookie, token, body: { status: "in_route" } })
  await api("PATCH", "/api/orders/" + deliveredId, { cookie, token, body: { status: "control" } })
  await api("PATCH", "/api/orders/" + deliveredId, { cookie, token, body: { status: "delivered" } })
  const delDelivered = await api("DELETE", "/api/orders/" + deliveredId, { cookie, token })
  step("доставленный заказ: 409 с текстом", delDelivered.status === 409 && /доставлен/i.test(delDelivered.json.error || ""), `status=${delDelivered.status}`)
  // и его можно архивировать вручную
  const archDelivered = await api("PATCH", "/api/orders/" + deliveredId, { cookie, token, body: { archivedAt: new Date().toISOString() } })
  step("доставленный заказ архивируется вручную", archDelivered.status === 200 && !!archDelivered.json.order.archivedAt, `status=${archDelivered.status}`)

  // ── E. Платёжный экспорт учитывает архивные ──
  const payRes = await fetch(BASE + "/api/payments/export", { headers: { cookie } })
  const exportText = await payRes.text()
  step("платёжный экспорт включает архивный оплаченный заказ", payRes.status === 200 && exportText.includes("Клиент Цел PAID-1"), `status=${payRes.status} len=${exportText.length}`)
  const archDeliveredInExport = exportText.includes("Клиент Цел DELIV-1")
  step("платёжный экспорт включает заархивированный доставленный заказ", archDeliveredInExport, "")

  // ── F. Рейс: повторное и параллельное завершение ──
  const routeOrder = await mkOrder("ROUTE-1")
  const routeOrderId = routeOrder.json.order.id
  await api("PATCH", "/api/orders/" + routeOrderId, { cookie, token, body: { status: "agreed" } })
  const route = await api("POST", "/api/routes", { cookie, token, body: { name: "Рейс Цел", orderIds: [routeOrderId], driverId: drvId, vehicleId: vehId } })
  const routeId = route.json.route.id
  await api("PATCH", "/api/routes/" + routeId, { cookie, token, body: { status: "in_transit", startedAt: new Date().toISOString() } })
  await api("PATCH", "/api/orders/" + routeOrderId, { cookie, token, body: { status: "control" } })
  await api("PATCH", "/api/orders/" + routeOrderId, { cookie, token, body: { status: "delivered" } })

  const complete1 = await api("POST", "/api/routes/" + routeId + "/complete", { cookie, token, body: {} })
  step("рейс завершён", complete1.status === 200 && !complete1.json.noop, `status=${complete1.status}`)

  const routeAfter1b = await api("GET", "/api/routes/" + routeId, { cookie })
  const completedAtFirst = (routeAfter1b.json.route || routeAfter1b.json).completedAt
  const fuelAfter1 = await p.vehicle.findUnique({ where: { id: vehId }, select: { fuelLevelL: true } })

  await new Promise((r) => setTimeout(r, 1200))
  const complete2 = await api("POST", "/api/routes/" + routeId + "/complete", { cookie, token, body: {} })
  step("повторное завершение — no-op", complete2.status === 200 && complete2.json.noop === true, `status=${complete2.status} noop=${complete2.json.noop}`)
  const routeAfter2 = await api("GET", "/api/routes/" + routeId, { cookie })
  const completedAtSecond = (routeAfter2.json.route || routeAfter2.json).completedAt
  step("completedAt не изменился", String(completedAtFirst) === String(completedAtSecond), `${completedAtFirst} vs ${completedAtSecond}`)
  const fuelAfter2 = await p.vehicle.findUnique({ where: { id: vehId }, select: { fuelLevelL: true } })
  step("топливо повторно не списано", fuelAfter1 && fuelAfter2 && Number(fuelAfter1.fuelLevelL) === Number(fuelAfter2.fuelLevelL), `${fuelAfter1 && fuelAfter1.fuelLevelL} vs ${fuelAfter2 && fuelAfter2.fuelLevelL}`)

  // ── G. Параллельное завершение ──
  const routeOrder2 = await mkOrder("ROUTE-2")
  const ro2 = routeOrder2.json.order.id
  await api("PATCH", "/api/orders/" + ro2, { cookie, token, body: { status: "agreed" } })
  const route2 = await api("POST", "/api/routes", { cookie, token, body: { name: "Рейс Параллель", orderIds: [ro2], driverId: drvId, vehicleId: vehId } })
  const route2Id = route2.json.route.id
  await api("PATCH", "/api/routes/" + route2Id, { cookie, token, body: { status: "in_transit", startedAt: new Date().toISOString() } })
  await api("PATCH", "/api/orders/" + ro2, { cookie, token, body: { status: "control" } })
  await api("PATCH", "/api/orders/" + ro2, { cookie, token, body: { status: "delivered" } })
  const [parA, parB] = await Promise.all([
    api("POST", "/api/routes/" + route2Id + "/complete", { cookie, token, body: {} }),
    api("POST", "/api/routes/" + route2Id + "/complete", { cookie, token, body: {} }),
  ])
  const noops = [parA.json.noop, parB.json.noop].filter(Boolean).length
  step("параллельное завершение: оба 200, один no-op", parA.status === 200 && parB.status === 200 && noops === 1, `A=${parA.status}/${parA.json.noop}/${(parA.json.error||"").slice(0,40)} B=${parB.status}/${parB.json.noop}/${(parB.json.error||"").slice(0,40)}`)

  // ── H. Архив водителя и машины с историей (рейсы, события, ТО) ──
  const delDriver = await api("DELETE", "/api/drivers/" + drvId, { cookie, token })
  step("водитель с историей архивирован", delDriver.status === 200 && delDriver.json.archived === true, `status=${delDriver.status}`)
  const driversList = await api("GET", "/api/drivers?limit=200", { cookie })
  const driverIds = ((driversList.json.drivers || driversList.json.items || []).map((d) => d.id))
  step("архивный водитель скрыт из списка", !driverIds.includes(drvId), `в списке=${driverIds.includes(drvId)}`)
  const drvRow = await p.driver.findUnique({ where: { id: drvId }, select: { archivedAt: true, status: true } })
  step("карточка водителя на месте с архивом", !!drvRow && !!drvRow.archivedAt, `status=${drvRow && drvRow.status}`)
  const routesKept = await p.route.count({ where: { driverId: drvId } })
  step("рейсы архивированного водителя сохранены", routesKept >= 2, `рейсов=${routesKept}`)

  const delVehicle = await api("DELETE", "/api/vehicles/" + vehId, { cookie, token })
  step("машина с историей архивирована", delVehicle.status === 200 && delVehicle.json.archived === true, `status=${delVehicle.status}`)
  const vehiclesList = await api("GET", "/api/vehicles?limit=200", { cookie })
  const vehicleIds = ((vehiclesList.json.vehicles || vehiclesList.json.items || []).map((v) => v.id))
  step("архивная машина скрыта из списка", !vehicleIds.includes(vehId), `в списке=${vehicleIds.includes(vehId)}`)

  // ── I. AuditLog ──
  const audit = await api("GET", "/api/admin/audit?limit=100", { cookie })
  const auditActions = ((audit.json.logs || []).map((e) => e.action))
  const want = ["order_archived", "order_delete_rejected", "order_deleted", "driver_archived", "vehicle_archived"]
  const found = want.filter((a) => auditActions.includes(a))
  step("AuditLog содержит архивирование и отказы удаления", found.length >= 4, `найдено=${found.join(",")}`)

  // ── уборка ──
  await purgeOrganization(orgId)
  out.cleanup.leftover = (await p.organization.findMany({ where: { nameKey: "аудит-целостность" }, select: { id: true } })).length
  } catch (e) {
  out.fatal = String(e.message).slice(0, 300)
  try {
    const orgs = await p.organization.findMany({ where: { nameKey: "аудит-целостность" }, select: { id: true } })
    for (const o of orgs) await purgeOrganization(o.id)
  } catch {}
} finally {
  await p.$disconnect()
  const failed = out.steps.filter((s) => !s.ok)
  console.log(JSON.stringify({ passed: out.steps.length - failed.length, total: out.steps.length, failures: failed, cleanup: out.cleanup, fatal: out.fatal }, null, 1))
}

}
main()
