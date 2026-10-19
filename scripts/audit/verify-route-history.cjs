// scripts/audit/verify-route-history.cjs
//
// Приёмочная проверка истории рейсов (/lm/history).
//
// Проверяем по существу — вопрос за вопросом из постановки:
//   1. «Чем машина ехала неделю назад и по какому маршруту?» — период «Неделя»
//      показывает рейс, маршрут по точкам, машину и водителя;
//   2. «В том рейсе был заказ от организации» — рейс раскрывается и виден
//      весь состав с номерами точек;
//   3. «Оплата не поступила — нужна информация об организации» — по заказу
//      видно клиента, ИНН, телефон и срок оплаты, состояние оплаты честное:
//      оплачен / ждём / просрочка N дн. / без условий оплаты;
//   4. «Или месяц назад» — период «Месяц» берёт более старые рейсы;
//   5. «Другие функции» — фильтр по машине, по водителю, «только с
//      непоступившей оплатой», сводка по деньгам периода.
//
// Временные данные (клиенты, заказы, рейсы) снимаются сценарием (уборка).
//
// Запуск: node scripts/audit/verify-route-history.cjs
// Скриншоты: docs/audit-screens/taskI-*.png

const fs = require("fs")

const { chromium } = require("/home/user/audit-browser/node_modules/playwright-core")

const BASE = process.env.AUDIT_BASE || "http://localhost:3000"
const EMAIL = process.env.STAFF_EMAIL || "admin@loginex.local"
const PASSWORD = process.env.STAFF_PASSWORD || "Sandbox-d0f763fc597545af76b446a"
const OUT_DIR = "/home/user/loginex/docs/audit-screens"
const MARK = "audit-history-"

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1
    console.log(`  OK   ${name}`)
  } else {
    fail += 1
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

/** innerText браузера: нормализуем неразрывные пробелы, чтобы искать подстроки. */
function norm(text) {
  return String(text || "").replace(/[\u00a0\u202f]/g, " ")
}

function isoDaysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

/** Клиенты: у одного — оплата в срок, у второго — должник. */
const CLIENTS = [
  { name: `${MARK}Ромашка`, inn: "7712345678", phone: "+79161112233", email: "romashka-history@example.com", paymentType: "bank", deferredDays: 0 },
  { name: `${MARK}Должник`, inn: "7798765432", phone: "+79161112244", email: "debtor-history@example.com", paymentType: "bank", deferredDays: 0 },
]

/** Заказы: A и B — в одном рейсе неделю назад, C — месяц назад отдельным рейсом. */
const ORDERS = [
  { key: "A", client: 0, from: "Тула, улица Советская, 1", to: "Калуга, улица Московская, 10", distance: 180, weight: 4000, price: 70000 },
  { key: "B", client: 1, from: "Калуга, улица Гагарина, 3", to: "Обнинск, проспект Маркса, 5", distance: 90, weight: 3000, price: 55000 },
  { key: "C", client: 0, from: "Воронеж, улица Ленина, 7", to: "Липецк, улица Кирова, 2", distance: 260, weight: 5000, price: 40000 },
]

;(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({
    executablePath: "/home/user/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
  const context = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    locale: "ru-RU",
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))

  const csrf = () =>
    page.evaluate(() => {
      const raw = document.cookie.split("; ").find((c) => c.startsWith("loginex_csrf="))
      return raw ? decodeURIComponent(raw.split("=")[1]) : ""
    })

  /** Удобный вызов API из контекста страницы (cookie и CSRF уже с нами). */
  const api = async (path, { method = "GET", body } = {}) =>
    page.evaluate(
      async ({ path: p, method: m, body: b, token }) => {
        const headers = { "Content-Type": "application/json" }
        if (token) headers["x-csrf-token"] = token
        const r = await fetch(p, {
          method: m,
          headers,
          body: b ? JSON.stringify(b) : undefined,
        })
        const d = await r.json().catch(() => ({}))
        return { status: r.status, data: d }
      },
      { path, method, body, token: method === "GET" ? "" : await csrf() },
    )

  // ── вход ──
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.waitForTimeout(600)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(4000)

  // ── клиенты ──
  const clientIds = []
  for (const client of CLIENTS) {
    const res = await api("/api/clients", { method: "POST", body: client })
    if (res.status === 200 || res.status === 201) clientIds.push(res.data.client?.id ?? null)
    else if (res.status === 409) {
      // клиент с таким именем уже есть (прошлый незавершённый прогон) — находим его
      const list = await api("/api/clients?limit=100")
      const found = (list.data.clients || []).find((c) => c.name === client.name)
      clientIds.push(found?.id ?? null)
    } else clientIds.push(null)
  }
  check("Два клиента заведены", clientIds.filter(Boolean).length === 2, JSON.stringify(clientIds))

  // ── машины: берём две разные, чтобы фильтр по машине был различим ──
  const vehiclesRes = await api("/api/vehicles?limit=50")
  const vehicles = vehiclesRes.data.vehicles || []
  const vehicle1 = vehicles[0]?.id ?? null
  const vehicle2 = (vehicles[1] ?? vehicles[0])?.id ?? null
  const plate1 = vehicles[0]?.plate ?? ""
  const plate2 = (vehicles[1] ?? vehicles[0])?.plate ?? ""
  check("В песочнице есть машины", Boolean(vehicle1), `машин: ${vehicles.length}`)

  // ── заказы ──
  const orderIds = {}
  for (const spec of ORDERS) {
    const res = await api("/api/orders", {
      method: "POST",
      body: {
        routeFrom: spec.from,
        routeTo: spec.to,
        distance: spec.distance,
        weight: spec.weight,
        volume: 10,
        cargoType: "Паллеты",
        price: spec.price,
        clientName: CLIENTS[spec.client].name,
        clientContact: CLIENTS[spec.client].phone,
      },
    })
    const id = res.data.order?.id ?? null
    if (id) {
      await api(`/api/orders/${id}`, { method: "PATCH", body: { status: "agreed" } })
      orderIds[spec.key] = id
    }
  }
  check("Три согласованных заказа созданы", Object.keys(orderIds).length === 3, JSON.stringify(Object.keys(orderIds)))

  // ── условия оплаты: A оплачен, B — просрочка 3 дня, C — без условий ──
  await api("/api/payments", { method: "PATCH", body: { orderId: orderIds.A, isPaid: true, paymentType: "bank" } })
  await api("/api/payments", { method: "PATCH", body: { orderId: orderIds.B, dueDate: isoDaysAgo(3), paymentType: "bank" } })

  // ── рейсы: A+B неделю назад (машина 1), C — 25 дней назад (машина 2) ──
  const route1Res = await api("/api/routes", {
    method: "POST",
    body: { orderIds: [orderIds.A, orderIds.B], vehicleId: vehicle1, name: `${MARK}Тула — Обнинск` },
  })
  const route1 = route1Res.data.route?.id ?? null
  if (route1) {
    await api(`/api/routes/${route1}`, {
      method: "PATCH",
      body: { status: "completed", startedAt: isoDaysAgo(5), completedAt: isoDaysAgo(4) },
    })
  }

  const route2Res = await api("/api/routes", {
    method: "POST",
    body: { orderIds: [orderIds.C], vehicleId: vehicle2, name: `${MARK}Воронеж — Липецк` },
  })
  const route2 = route2Res.data.route?.id ?? null
  if (route2) {
    await api(`/api/routes/${route2}`, {
      method: "PATCH",
      body: { status: "completed", startedAt: isoDaysAgo(25), completedAt: isoDaysAgo(24) },
    })
  }
  check("Два рейса собраны и закрыты", Boolean(route1 && route2), `route1=${route1} route2=${route2}`)

  // ── API: период «Неделя» ──
  const week = await api("/api/routes/history?days=7")
  const weekIds = (week.data.routes || []).map((r) => r.id)
  check("API истории отвечает", week.status === 200 && week.data.success === true, `status ${week.status}`)
  check("За неделю виден рейс с двумя заказами", weekIds.includes(route1), JSON.stringify(weekIds))
  check("Рейс месяца назад в «неделе» не виден", !weekIds.includes(route2))

  const weekRoute = (week.data.routes || []).find((r) => r.id === route1)
  check(
    "Заказы рейса отданы по порядку точек",
    Boolean(weekRoute) && weekRoute.orders.length === 2 && weekRoute.orders[0].id === orderIds.A && weekRoute.orders[1].id === orderIds.B,
    weekRoute ? `заказов ${weekRoute.orders.length}` : "рейс не найден",
  )
  const payA = weekRoute?.orders.find((o) => o.id === orderIds.A)?.payment
  const payB = weekRoute?.orders.find((o) => o.id === orderIds.B)?.payment
  check("Оплаченный заказ показан оплаченным", payA?.tone === "paid" && payA.label === "Оплачен", JSON.stringify(payA))
  check(
    "Просрочка честно названа днями",
    payB?.tone === "overdue" && /Просрочка \d+ дн\./.test(payB.label) && payB.overdueDays >= 3,
    JSON.stringify(payB),
  )
  check(
    "Клиент оплаченного заказа — с ИНН и телефоном",
    weekRoute?.orders[0]?.client?.inn === "7712345678" && weekRoute?.orders[0]?.client?.phone === "+79161112233",
    JSON.stringify(weekRoute?.orders[0]?.client),
  )
  check(
    "Машина рейса указана",
    weekRoute?.vehicle?.id === vehicle1 && Boolean(weekRoute.vehicle?.plate),
    JSON.stringify(weekRoute?.vehicle),
  )

  // ── API: период «Месяц» и фильтры ──
  const month = await api("/api/routes/history?days=30")
  const monthIds = (month.data.routes || []).map((r) => r.id)
  check("За месяц видны оба рейса", monthIds.includes(route1) && monthIds.includes(route2), JSON.stringify(monthIds))

  const byVehicle = await api(`/api/routes/history?days=30&vehicleId=${vehicle2}`)
  const byVehicleIds = (byVehicle.data.routes || []).map((r) => r.id)
  check(
    "Фильтр по машине оставляет только её рейсы",
    byVehicleIds.includes(route2) && !byVehicleIds.includes(route1),
    JSON.stringify(byVehicleIds),
  )

  const overdueOnly = await api("/api/routes/history?days=30&onlyOverdue=1")
  const overdueIds = (overdueOnly.data.routes || []).map((r) => r.id)
  check("«Только с неоплатой» оставляет рейс с должником", overdueIds.includes(route1) && !overdueIds.includes(route2), JSON.stringify(overdueIds))

  const monthSummary = month.data.summary
  check(
    "Сводка периода считает деньги и должников",
    // В песочнице есть и другие рейсы за месяц — проверяем свои суммы,
    // а не то, что период состоит ровно из трёх заказов.
    Boolean(monthSummary) &&
      monthSummary.orders >= 3 &&
      monthSummary.overdueCount === 1 &&
      monthSummary.overdueAmount === 55000 &&
      monthSummary.debtorClients === 1 &&
      monthSummary.paidAmount >= 70000,
    JSON.stringify(monthSummary),
  )

  const noPaymentOrder = (month.data.routes || []).find((r) => r.id === route2)?.orders[0]
  check(
    "Заказ без условий оплаты не выдаётся за долг",
    noPaymentOrder?.payment.tone === "unknown" && noPaymentOrder.payment.label === "Без условий оплаты",
    JSON.stringify(noPaymentOrder?.payment),
  )

  // ── экран ──
  await page.goto(`${BASE}/lm/history`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(7000)

  let text = norm(await page.evaluate(() => document.body.innerText || ""))
  check("Экран истории открывается", text.includes("История рейсов"), text.slice(0, 160))
  check(
    "Пустые рейсы в историю не попадают",
    !text.includes("Точки не указаны") && !text.includes("0 заказов"),
    text.slice(0, 200),
  )
  check(
    "Периоды выбираются кнопками",
    ["Неделя", "Месяц", "3 месяца", "Всё время"].every((label) => text.includes(label)),
    text.slice(0, 200),
  )
  check("Фильтры машины и водителя на месте", text.includes("Любая машина") && text.includes("Любой водитель"), text.slice(0, 200))
  check("Сводка по деньгам периода", text.includes("Деньги по заказам") && text.includes("Просрочено") && text.includes("Оплачено"), text.slice(0, 300))
  check(
    "Свежий рейс виден в списке маршрутом по точкам",
    text.includes("Тула — Калуга — Обнинск"),
    text.slice(0, 300),
  )
  check("Рейс с долгом помечен", text.includes("долг 55 000 ₽"), text.slice(0, 300))
  await page.screenshot({ path: `${OUT_DIR}/taskI-history.png`, fullPage: false })

  // ── раскрытие рейса: состав и клиент для взыскания ──
  const routeCard = page
    .locator("button[aria-expanded]")
    .filter({ hasText: "Калуга" })
    .filter({ hasText: "долг 55 000 ₽" })
    .first()
  check("Карточка рейса с должником найдена", (await routeCard.count()) > 0)
  if (await routeCard.count()) {
    await routeCard.click()
    await page.waitForTimeout(1200)
  }
  text = norm(await page.evaluate(() => document.body.innerText || ""))
  check("Состав рейса раскрывается", text.includes("Что везли"), text.slice(0, 300))
  check("Заказ с просрочкой назван просрочкой", /Просрочка \d+ дн\./.test(text), text.slice(0, 400))
  check("Оплаченный заказ назван оплаченным", text.includes("Оплачен"), text.slice(0, 400))
  check("Клиент-должник с ИНН и телефоном", text.includes("ИНН 7798765432") && text.includes("+79161112244"), text.slice(0, 500))
  check("Телефон клиента — ссылка для звонка", (await page.locator('a[href^="tel:+79161112244"]').count()) > 0)
  check("Из заказа виден переход в карточку", text.includes("Карточка заказа"), text.slice(0, 400))
  check("Рейс открывается целиком", text.includes("Открыть рейс"), text.slice(0, 400))
  await page.screenshot({ path: `${OUT_DIR}/taskI-history-open.png`, fullPage: false })

  // ── период «Всё время»: виден и старый рейс, и честное «без условий оплаты» ──
  const allBtn = page.locator('button:has-text("Всё время")')
  if (await allBtn.count()) {
    await allBtn.first().click()
    await page.waitForTimeout(2500)
  }
  text = norm(await page.evaluate(() => document.body.innerText || ""))
  check("За всё время виден рейс месяца назад", text.includes("Воронеж — Липецк"), text.slice(0, 400))

  const oldCard = page
    .locator("button[aria-expanded]")
    .filter({ hasText: "Липецк" })
    .filter({ hasText: "40 000 ₽" })
    .first()
  check("Карточка рейса месяца назад найдена", (await oldCard.count()) > 0)
  if (await oldCard.count()) {
    await oldCard.click()
    await page.waitForTimeout(1200)
  }
  text = norm(await page.evaluate(() => document.body.innerText || ""))
  check("Заказ без условий оплаты не назван долгом", text.includes("Без условий оплаты"), text.slice(0, 500))
  await page.screenshot({ path: `${OUT_DIR}/taskI-history-all.png`, fullPage: false })

  // ── фильтр «только с непоступившей оплатой» ──
  const overdueBtn = page.locator('button:has-text("Только с непоступившей оплатой")')
  if (await overdueBtn.count()) {
    await overdueBtn.first().click()
    await page.waitForTimeout(2500)
  }
  text = norm(await page.evaluate(() => document.body.innerText || ""))
  check(
    "Переключатель оставляет только рейс с должником",
    text.includes("Тула") && !text.includes("Липецк"),
    text.slice(0, 400),
  )
  await page.screenshot({ path: `${OUT_DIR}/taskI-history-overdue.png`, fullPage: false })

  check("Нет ошибок страницы", errors.length === 0, errors.slice(0, 2).join(" | "))

  // ── уборка: временные заказы, рейсы и клиенты ──
  for (const id of Object.values(orderIds)) {
    if (id) await api(`/api/orders/${id}`, { method: "DELETE" })
  }
  for (const id of [route1, route2]) {
    if (id) await api(`/api/routes/${id}`, { method: "DELETE" })
  }
  for (const id of clientIds) {
    if (id) await api(`/api/clients/${id}`, { method: "DELETE" })
  }

  console.log(`\nИтог: ${pass} ок / ${fail} сбоя`)
  if (failures.length) console.log("Сбои:\n - " + failures.join("\n - "))
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error("ПРОВАЛ СЦЕНАРИЯ:", e.message)
  process.exit(1)
})
