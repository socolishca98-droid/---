// Приёмка ремонтов (этап 3, A4) — живой HTTP.
//
// Проверяет: запись ремонта через POST /api/maintenance (машина своей
// организации, номер заказ-наряда), сводку «Потрачено на ремонты» с периодом
// (по всей базе, а не по странице журнала), PATCH (закрытие работы), отказ на
// архивную машину (409) и изоляцию по организации.
// Все данные — изолированная тестовая организация, удаляется в конце.
const BASE = "http://localhost:3000"
const { PrismaClient } = require("@prisma/client")
const p = new PrismaClient()
const out = { steps: [] }

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

async function purgeOrganization(organizationId) {
  const orders = await p.order.findMany({ where: { organizationId }, select: { id: true } })
  for (const o of orders) {
    await p.orderNegotiation.deleteMany({ where: { orderId: o.id } })
  }
  await p.order.deleteMany({ where: { organizationId } })
  await p.routeExpense.deleteMany({ where: { organizationId } })
  await p.routeStage.deleteMany({ where: { organizationId } })
  await p.route.deleteMany({ where: { organizationId } })
  const shifts = await p.driverShift.findMany({ where: { organizationId }, select: { id: true } })
  for (const s of shifts) await p.shiftEvent.deleteMany({ where: { shiftId: s.id } }).catch(() => {})
  await p.driverShift.deleteMany({ where: { organizationId } })
  await p.driver.deleteMany({ where: { organizationId } })
  await p.maintenanceLog.deleteMany({ where: { organizationId } })
  await p.vehicle.deleteMany({ where: { organizationId } })
  await p.auditLog.deleteMany({ where: { organizationId } })
  await p.user.deleteMany({ where: { organizationId } })
  await p.organization.delete({ where: { id: organizationId } })
}

async function makeOrg() {
  const pw = "Maint-Test-2026x!"
  const email = `maint-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.test`
  const csrf = await api("GET", "/api/auth/csrf")
  const token = csrf.json?.csrfToken || csrf.json?.token
  const cookie0 = csrf.raw.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
  const reg = await api("POST", "/api/auth/register", {
    cookie: cookie0, token,
    body: { name: "Аудит Ремонты", email, password: pw, organizationName: `АУДИТ-РЕМОНТЫ-${Date.now()}`, acceptedTerms: true },
  })
  const login = await api("POST", "/api/auth/login", { cookie: cookie0, token, body: { email, password: pw } })
  const cookie = cookie0 + "; " + login.raw.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
  if (process.env.DEBUG_MAINT) console.log("DEBUG reg:", reg.status, JSON.stringify(reg.json).slice(0, 200), "login:", login.status, JSON.stringify(login.json).slice(0, 200))
  return { cookie, token, organizationId: reg.json?.organization?.id || login.json?.organization?.id }
}

async function main() {
  let orgId = null
  try {
    const auth = await makeOrg()
    orgId = auth.organizationId
    step("регистрация тестовой организации", Boolean(auth.cookie), "")

    const veh = await api("POST", "/api/vehicles", {
      cookie: auth.cookie, token: auth.token,
      body: { plate: `A${Date.now() % 100000}AA750`, brand: "Volvo", model: "FH", type: "fura", capacity: 20000, fuelTankL: 500, fuelConsumptionPer100: 30, fuelLevelL: 400 },
    })
    const vehicleId = veh.json?.vehicle?.id || veh.json?.id
    if (!vehicleId) console.log("DEBUG vehicle:", veh.status, JSON.stringify(veh.json).slice(0, 300))
    step("создание машины", Boolean(vehicleId), veh.json?.error || JSON.stringify(veh.json).slice(0, 200))
    if (!vehicleId) throw new Error("машина не создана")

    // POST /api/maintenance — работа с номером заказ-наряда и стоимостью
    const post = await api("POST", "/api/maintenance", {
      cookie: auth.cookie, token: auth.token,
      body: {
        vehicleId, type: "repair", description: "Замена масла и фильтра",
        cost: 12000, mileage: 250000, serviceName: "СТО Вёдра",
        workOrderNumber: "ZN-2026-0001",
      },
    })
    const logId = post.json?.id
    step("POST /api/maintenance — запись ремонта", post.status === 200 && Boolean(logId), post.json?.error || "")

    const row = logId ? await p.maintenanceLog.findUnique({ where: { id: logId } }) : null
    step("workOrderNumber сохранился в БД", row?.workOrderNumber === "ZN-2026-0001", String(row?.workOrderNumber ?? null))
    step("organizationId взят из сессии", row?.organizationId === orgId, String(row?.organizationId === orgId))

    // PATCH — закрыть работу
    const patch = await api("PATCH", "/api/maintenance", {
      cookie: auth.cookie, token: auth.token,
      body: { id: logId, status: "completed" },
    })
    step("PATCH /api/maintenance — закрытие работы", patch.status === 200, patch.json?.error || "")
    const closed = logId ? await p.maintenanceLog.findUnique({ where: { id: logId } }) : null
    step("completedAt проставлен", Boolean(closed?.completedAt), "")

    // Ещё одна работа — для сводки по двум записям
    const post2 = await api("POST", "/api/maintenance", {
      cookie: auth.cookie, token: auth.token,
      body: { vehicleId, type: "tires", description: "Шины на ведущую ось", cost: 8000 },
    })
    step("вторая запись ремонта", post2.status === 200, post2.json?.error || "")

    // Сводка «Потрачено на ремонты» за период
    const today = new Date()
    const from = new Date(today.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    const to = today.toISOString().slice(0, 10)
    const spend = await api("GET", `/api/maintenance?from=${from}&to=${to}`, { cookie: auth.cookie })
    step("GET spend.costRub = 20000", spend.json?.spend?.costRub === 20000, String(spend.json?.spend?.costRub))
    step("GET spend.count = 2", spend.json?.spend?.count === 2, String(spend.json?.spend?.count))
    step("GET spend.byVehicle по машине", (spend.json?.spend?.byVehicle?.length ?? 0) === 1 && spend.json.spend.byVehicle[0].costRub === 20000, String(spend.json?.spend?.byVehicle?.[0]?.costRub ?? null))

    // Период без записей — нули
    const spendEmpty = await api("GET", "/api/maintenance?from=2020-01-01&to=2020-01-02", { cookie: auth.cookie })
    step("период без работ — нули", spendEmpty.json?.spend?.costRub === 0, String(spendEmpty.json?.spend?.costRub))

    // Архивная машина — 409
    await p.vehicle.update({ where: { id: vehicleId }, data: { archivedAt: new Date() } })
    const archivedPost = await api("POST", "/api/maintenance", {
      cookie: auth.cookie, token: auth.token,
      body: { vehicleId, type: "repair", description: "Ещё ремонт" },
    })
    step("архивная машина — 409", archivedPost.status === 409, String(archivedPost.status))

    // Чужая организация — 404
    const other = await makeOrg()
    const foreign = await api("POST", "/api/maintenance", {
      cookie: other.cookie, token: other.token,
      body: { vehicleId, type: "repair", description: "Ремонт чужой машины" },
    })
    step("машина чужой организации — 404", foreign.status === 404, String(foreign.status))
    await purgeOrganization(other.organizationId)

    // Неизвестное поле — 400
    const bad = await api("POST", "/api/maintenance", {
      cookie: auth.cookie, token: auth.token,
      body: { vehicleId, type: "repair", description: "Тест", hack: true },
    })
    step("неизвестное поле — 400", bad.status === 400, String(bad.status))
  } finally {
    if (orgId) await purgeOrganization(orgId).catch(() => {})
  }

  const passed = out.steps.filter((s) => s.ok).length
  console.log(`\nПриёмка A4 (ремонты): ${passed}/${out.steps.length}`)
  for (const s of out.steps) console.log(` ${s.ok ? "OK" : "FAIL"} ${s.name}${s.detail && !s.ok ? ` — ${s.detail}` : ""}`)
  await p.$disconnect()
  process.exit(passed === out.steps.length ? 0 : 1)
}

main()
