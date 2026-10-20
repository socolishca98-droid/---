// Приёмка ремонтов (этап 3, A4) — живой HTTP.
//
// Проверяет: запись ремонта через POST /api/maintenance (машина своей
// организации, номер заказ-наряда), сводку «Потрачено на ремонты» с периодом
// (по всей базе, а не по странице журнала), PATCH (закрытие работы), отказ на
// архивную машину (409) и валидацию полей.
//
// Вход — существующий админ песочницы (MAINT_ADMIN_EMAIL / MAINT_ADMIN_PASSWORD
// из .env). Регистрация не используется: на неё стоит rate limit.
// Тестовые данные (работы и машины) удаляются в конце прогона.
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

async function main() {
  const email = (process.env.MAINT_ADMIN_EMAIL || "admin@loginex.local").trim()
  const password = (process.env.MAINT_ADMIN_PASSWORD || "").trim()
  let orgId = null
  let vehicleIds = []

  const csrf = await api("GET", "/api/auth/csrf")
  const token = csrf.json?.csrfToken || csrf.json?.token
  const cookie0 = csrf.raw.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
  const login = await api("POST", "/api/auth/login", { cookie: cookie0, token, body: { email, password } })
  const cookie = cookie0 + "; " + login.raw.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
  step("вход админом песочницы", login.status === 200, login.json?.error || String(login.status))
  if (login.status !== 200) {
    print()
    await p.$disconnect()
    process.exit(1)
  }

  const u = await p.user.findFirst({ where: { email }, select: { organizationId: true } })
  orgId = u?.organizationId
  await p.maintenanceLog.deleteMany({ where: { organizationId: orgId } })

  const veh = await api("POST", "/api/vehicles", {
    cookie, token,
    body: { plate: "R666RR750", brand: "Volvo", model: "FH", type: "fura", capacity: 20000 },
  })
  const vehicleId = veh.json?.vehicle?.id || veh.json?.id
  vehicleIds.push(vehicleId)
  step("создание машины", Boolean(vehicleId), veh.json?.error || "")

  // POST /api/maintenance — работа с номером заказ-наряда и стоимостью
  const post = await api("POST", "/api/maintenance", {
    cookie, token,
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
    cookie, token,
    body: { id: logId, status: "completed" },
  })
  step("PATCH /api/maintenance — закрытие работы", patch.status === 200, patch.json?.error || "")
  const closed = logId ? await p.maintenanceLog.findUnique({ where: { id: logId } }) : null
  step("completedAt проставлен", Boolean(closed?.completedAt), "")

  // Валидация
  const badType = await api("POST", "/api/maintenance", {
    cookie, token, body: { vehicleId, type: "кофе", description: "Тест типа" },
  })
  step("некорректный вид — 400", badType.status === 400, String(badType.status))

  const badField = await api("POST", "/api/maintenance", {
    cookie, token, body: { vehicleId, type: "repair", description: "Тест", hack: true },
  })
  step("неизвестное поле — 400", badField.status === 400, String(badField.status))

  const shortDesc = await api("POST", "/api/maintenance", {
    cookie, token, body: { vehicleId, type: "repair", description: "не" },
  })
  step("слишком короткое описание — 400", shortDesc.status === 400, String(shortDesc.status))

  // Ещё одна работа — для сводки по двум записям
  const post2 = await api("POST", "/api/maintenance", {
    cookie, token, body: { vehicleId, type: "tires", description: "Шины на ведущую ось", cost: 8000 },
  })
  step("вторая запись ремонта", post2.status === 200, post2.json?.error || "")

  // Сводка «Потрачено на ремонты» за период
  const today = new Date()
  const from = new Date(today.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const to = today.toISOString().slice(0, 10)
  const spend = await api("GET", `/api/maintenance?from=${from}&to=${to}`, { cookie })
  step("GET spend.costRub = 20000", spend.json?.spend?.costRub === 20000, String(spend.json?.spend?.costRub))
  step("GET spend.count = 2", spend.json?.spend?.count === 2, String(spend.json?.spend?.count))
  step("GET spend.byVehicle по машине", (spend.json?.spend?.byVehicle?.length ?? 0) === 1 && spend.json.spend.byVehicle[0].costRub === 20000, "")

  const spendEmpty = await api("GET", "/api/maintenance?from=2020-01-01&to=2020-01-02", { cookie })
  step("период без работ — нули", spendEmpty.json?.spend?.costRub === 0, String(spendEmpty.json?.spend?.costRub))

  // Вторая машина — разбивка по парку
  const veh2 = await api("POST", "/api/vehicles", {
    cookie, token, body: { plate: "R777RR750", brand: "Volvo", model: "FH", type: "fura", capacity: 20000 },
  })
  const vehicle2Id = veh2.json?.vehicle?.id || veh2.json?.id
  vehicleIds.push(vehicle2Id)
  const post3 = await api("POST", "/api/maintenance", {
    cookie, token, body: { vehicleId: vehicle2Id, type: "repair", description: "Ремонт второй машины", cost: 3000 },
  })
  step("работа по второй машине", post3.status === 200, post3.json?.error || "")
  const spend2 = await api("GET", `/api/maintenance?from=${from}&to=${to}`, { cookie })
  step("spend по двум машинам = 23000", spend2.json?.spend?.costRub === 23000 && (spend2.json?.spend?.byVehicle?.length ?? 0) === 2, String(spend2.json?.spend?.costRub))
  step("сортировка byVehicle по убыванию", spend2.json?.spend?.byVehicle?.[0]?.costRub === 20000, "")

  // Архивная машина — 409
  await p.vehicle.update({ where: { id: vehicleId }, data: { archivedAt: new Date() } })
  const archived = await api("POST", "/api/maintenance", {
    cookie, token, body: { vehicleId, type: "repair", description: "Ещё ремонт" },
  })
  step("архивная машина — 409", archived.status === 409, String(archived.status))

  // Уборка тестовых данных
  if (orgId) await p.maintenanceLog.deleteMany({ where: { organizationId: orgId } })
  await p.vehicle.deleteMany({ where: { id: { in: vehicleIds.filter(Boolean) } } })

  print()
  await p.$disconnect()
  process.exit(out.steps.every((s) => s.ok) ? 0 : 1)
}

function print() {
  const passed = out.steps.filter((s) => s.ok).length
  console.log(`\nПриёмка A4 (ремонты): ${passed}/${out.steps.length}`)
  for (const s of out.steps) console.log(` ${s.ok ? "OK" : "FAIL"} ${s.name}${s.detail && !s.ok ? ` — ${s.detail}` : ""}`)
}

main()
