// scripts/audit/verify-backload-live.cjs
//
// Живая проверка обратной загрузки: создаём пару временных заказов
// «А → Б» и «Б → А», смотрим, что помощник предлагает возврат с грузом,
// и убираем за собой всё созданное.
//
// Запуск: node scripts/audit/verify-backload-live.cjs
// Скриншот: docs/audit-screens/taskG-backload.png

const path = require("path")
const fs = require("fs")

const { chromium } = require("/home/user/audit-browser/node_modules/playwright-core")

const BASE = process.env.AUDIT_BASE || "http://localhost:3000"
const EMAIL = process.env.STAFF_EMAIL || "admin@loginex.local"
const PASSWORD = process.env.STAFF_PASSWORD || "Sandbox-d0f763fc597545af76b446a"
const OUT_DIR = "/home/user/loginex/docs/audit-screens"
const MARK = "audit-backload-"

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

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.waitForTimeout(600)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(4000)

  // Два согласованных заказа в противоположных направлениях
  const created = []
  for (const spec of [
    { from: "Тверь, улица Новая, 1", to: "Рыбинск, улица Портовая, 5", weight: 4000, price: 90000, name: `${MARK}туда` },
    { from: "Рыбинск, улица Портовая, 5", to: "Тверь, улица Новая, 1", weight: 4000, price: 80000, name: `${MARK}обратно` },
  ]) {
    const res = await page.evaluate(async (body) => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("loginex_csrf="))
      const token = csrf ? decodeURIComponent(csrf.split("=")[1]) : ""
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": token },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      return { status: r.status, order: d.order || null, error: d.error || null }
    }, {
      routeFrom: spec.from,
      routeTo: spec.to,
      distance: 400,
      weight: spec.weight,
      volume: 12,
      cargoType: "Паллеты",
      price: spec.price,
      clientName: spec.name,
      clientContact: "+79161112233",
      status: "agreed",
    })
    if (res.order?.id) created.push(res.order.id)
    console.log(`  создан заказ ${spec.name}: статус ${res.status}`)

    // Заводится заказ в статусе «переговоры» — в помощник попадают только
    // согласованные. Согласуем его тем же путём, что и логист в карточке.
    if (res.order?.id) {
      const agreed = await page.evaluate(async (orderId) => {
        const csrf = document.cookie.split("; ").find((c) => c.startsWith("loginex_csrf="))
        const token = csrf ? decodeURIComponent(csrf.split("=")[1]) : ""
        const r = await fetch(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({ status: "agreed" }),
        })
        const d = await r.json().catch(() => ({}))
        return { status: r.status, error: d.error || null }
      }, res.order.id)
      console.log(`  согласован ${spec.name}: ${agreed.status}${agreed.error ? ` (${agreed.error})` : ""}`)
      if (agreed.status !== 200) {
        // Не согласовали — убираем, чтобы не оставлять мусор
        await page.evaluate(async (orderId) => {
          const csrf = document.cookie.split("; ").find((c) => c.startsWith("loginex_csrf="))
          const token = csrf ? decodeURIComponent(csrf.split("=")[1]) : ""
          await fetch(`/api/orders/${orderId}`, { method: "DELETE", headers: { "x-csrf-token": token } })
        }, res.order.id)
        created.pop()
      }
    }
  }
  check("Оба временных заказа созданы и согласованы", created.length === 2, `создано: ${created.length}`)

  await page.goto(`${BASE}/lm/routes/assistant`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(6000)

  const text = await page.evaluate(() => document.body.innerText || "")
  check("Возврат с грузом предлагается", /Возврат с грузом/.test(text), text.slice(0, 200))
  check("Объяснено, что машина приедет домой загруженной", /приедет домой загруженной/.test(text))
  check("Есть сумма обратной загрузки", /₽/.test(text))

  await page.screenshot({ path: path.join(OUT_DIR, "taskG-backload.png"), fullPage: false })

  // ── Уборка: удаляем созданные заказы ──
  for (const id of created) {
    const res = await page.evaluate(async (orderId) => {
      const csrf = document.cookie.split("; ").find((c) => c.startsWith("loginex_csrf="))
      const token = csrf ? decodeURIComponent(csrf.split("=")[1]) : ""
      const r = await fetch(`/api/orders/${orderId}`, {
        method: "DELETE",
        headers: { "x-csrf-token": token },
      })
      return r.status
    }, id)
    console.log(`  удаление ${id}: ${res}`)
  }

  console.log(`\nИтог: ${pass} ок / ${fail} сбоя`)
  if (failures.length) console.log("Сбои:\n - " + failures.join("\n - "))
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error("ПРОВАЛ СЦЕНАРИЯ:", e.message)
  process.exit(1)
})
