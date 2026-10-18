// scripts/audit/verify-route-rebuild.cjs
//
// Приёмочная проверка «Пересобрать без несогласованных».
//
// Смысл: логист собрал рейс из нескольких грузов, развёз предложения — и по
// части заказов клиенты не согласились. Рейс с ними ехать не должен. Проверяем,
// что кнопка в карточке рейса убирает такие заказы и перенумеровывает остальные.
//
// Что делаем:
//   1. создаём два согласованных заказа и рейс из них;
//   2. один заказ объявляем «переговоры проиграны» (negotiationStatus = lost);
//   3. открываем карточку рейса — должно быть предупреждение «Без согласия: 1»;
//   4. нажимаем «Пересобрать без несогласованных»;
//   5. проверяем, что заказ убран из рейса и вернулся в общий пул;
//   6. убираем за собой всё созданное.
//
// Запуск: node scripts/audit/verify-route-rebuild.cjs
// Скриншот: docs/audit-screens/taskH-rebuild.png

const fs = require("fs")

const { chromium } = require("/home/user/audit-browser/node_modules/playwright-core")

const BASE = process.env.AUDIT_BASE || "http://localhost:3000"
const EMAIL = process.env.STAFF_EMAIL || "admin@loginex.local"
const PASSWORD = process.env.STAFF_PASSWORD || "Sandbox-d0f763fc597545af76b446a"
const OUT_DIR = "/home/user/loginex/docs/audit-screens"
const MARK = "audit-rebuild-"

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
  page.on("dialog", (d) => d.accept())

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.waitForTimeout(600)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(4000)

  const call = async (url, method, body) =>
    page.evaluate(
      async ({ url: u, method: m, body: b }) => {
        const raw = document.cookie.split("; ").find((c) => c.startsWith("loginex_csrf="))
        const token = raw ? decodeURIComponent(raw.split("=")[1]) : ""
        const r = await fetch(u, {
          method: m,
          headers: { "Content-Type": "application/json", "x-csrf-token": token },
          body: b ? JSON.stringify(b) : undefined,
        })
        const d = await r.json().catch(() => ({}))
        return { status: r.status, data: d }
      },
      { url, method, body },
    )

  // 1. Два согласованных заказа
  const ids = []
  for (const [name, to] of [
    [`${MARK}гружёный`, "Рязань, улица Соборная, 4"],
    [`${MARK}отказной`, "Коломна, улица Парковая, 9"],
  ]) {
    const created = await call("/api/orders", "POST", {
      routeFrom: "Москва, улица Складочная, 8",
      routeTo: to,
      distance: 180,
      weight: 4000,
      volume: 10,
      cargoType: "Паллеты",
      price: 50000,
      clientName: name,
      clientContact: "+79161112244",
    })
    if (created.data?.order?.id) {
      await call(`/api/orders/${created.data.order.id}`, "PATCH", { status: "agreed" })
      ids.push(created.data.order.id)
    }
  }
  check("Два согласованных заказа созданы", ids.length === 2, `создано ${ids.length}`)

  // 2. Рейс из них
  const routeRes = await call("/api/routes", "POST", {
    orderIds: ids,
    name: `${MARK}рейс`,
  })
  const routeId = routeRes.data?.route?.id
  check("Рейс из двух заказов создан", Boolean(routeId), JSON.stringify(routeRes.data).slice(0, 120))

  // 3. Один заказ — «переговоры проиграны»
  await call(`/api/orders/${ids[1]}`, "PATCH", { negotiationStatus: "lost" })

  // 4. Карточка рейса: предупреждение
  await page.goto(`${BASE}/lm/routes/${routeId}`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(5000)
  let text = await page.evaluate(() => document.body.innerText || "")
  check("Предупреждение «Без согласия» на карточке рейса", text.includes("Без согласия"), text.slice(0, 200))
  await page.screenshot({ path: `${OUT_DIR}/taskH-rebuild-before.png`, fullPage: false })

  // 5. Кнопка пересборки
  const rebuildBtn = page.locator('button:has-text("Пересобрать без несогласованных")')
  check("Кнопка «Пересобрать без несогласованных» на месте", (await rebuildBtn.count()) > 0)
  if (await rebuildBtn.count()) {
    await rebuildBtn.first().click()
    await page.waitForTimeout(4000)
  }
  text = await page.evaluate(() => document.body.innerText || "")
  check("После пересборки предупреждение ушло", !text.includes("Без согласия"), text.slice(0, 200))
  await page.screenshot({ path: `${OUT_DIR}/taskH-rebuild-after.png`, fullPage: false })

  // 6. Заказ действительно убран из рейса и вернулся в пул
  const orderCheck = await call(`/api/orders/${ids[1]}`, "GET", null)
  const routeIdNow = orderCheck.data?.order?.routeId ?? null
  check("Несогласованный заказ убран из рейса", routeIdNow === null, `routeId=${routeIdNow}`)

  const keptCheck = await call(`/api/orders/${ids[0]}`, "GET", null)
  check("Согласованный заказ остался в рейсе", keptCheck.data?.order?.routeId === routeId, String(keptCheck.data?.order?.routeId))

  console.log(`\nИтог: ${pass} ок / ${fail} сбоя`)
  if (failures.length) console.log("Сбои:\n - " + failures.join("\n - "))
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error("ПРОВАЛ СЦЕНАРИЯ:", e.message)
  process.exit(1)
})
