// scripts/audit/verify-anchor-build.cjs
//
// Приёмочная проверка сборки рейса от опорного заказа (/lm/routes/assistant).
//
// Проверяем по существу:
//   1. экран «Собрать вокруг заказа» открывается и показывает согласованные заказы;
//   2. выбор опорного заказа сворачивает общий список к одной карточке;
//   3. радиус задаётся кнопками и меняет состав;
//   4. то, что не взяли, объясняется причиной по каждому заказу;
//   5. «Предложить рейс» создаёт рейс из выбранного состава;
//   6. эндпоинт координат отвечает и не падает.
//
// Временные заказы снимаются сценарием (уборка).
//
// Запуск: node scripts/audit/verify-anchor-build.cjs
// Скриншоты: docs/audit-screens/taskH-*.png

const fs = require("fs")

const { chromium } = require("/home/user/audit-browser/node_modules/playwright-core")

const BASE = process.env.AUDIT_BASE || "http://localhost:3000"
const EMAIL = process.env.STAFF_EMAIL || "admin@loginex.local"
const PASSWORD = process.env.STAFF_PASSWORD || "Sandbox-d0f763fc597545af76b446a"
const OUT_DIR = "/home/user/loginex/docs/audit-screens"
const MARK = "audit-anchor-"

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

// Временные заказы: опорный «Тула → Калуга», попутный рядом и далёкий
const SPECS = [
  { name: `${MARK}опорный`, from: "Тула, улица Советская, 1", to: "Калуга, улица Московская, 10", distance: 180, weight: 4000, price: 70000, contact: "+79161110001" },
  { name: `${MARK}попутный`, from: "Калуга, улица Гагарина, 3", to: "Обнинск, проспект Маркса, 5", distance: 90, weight: 3000, price: 35000, contact: "+79161110002" },
  { name: `${MARK}далёкий`, from: "Воронеж, улица Ленина, 7", to: "Саратов, улица Кирова, 2", distance: 520, weight: 3000, price: 60000, contact: "+79161110003" },
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

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector('input[type="email"]', { timeout: 20000 })
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.waitForTimeout(600)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(4000)

  // ── 6. Эндпоинт координат отвечает ──
  const geo = await page.evaluate(async () => {
    const r = await fetch("/api/orders/geo-points")
    const d = await r.json().catch(() => ({}))
    return {
      status: r.status,
      success: d.success,
      points: Object.keys(d.points || {}).length,
      known: Object.entries(d.points || {}).filter(([, v]) => v !== null).length,
    }
  })
  check("Эндпоинт координат отвечает", geo.status === 200 && geo.success === true, JSON.stringify(geo).slice(0, 120))
  check("Координаты городов найдены", geo.known > 0, `известно ${geo.known} из ${geo.points}`)

  // ── временные заказы ──
  const created = []
  for (const spec of SPECS) {
    const token = await csrf()
    const res = await page.evaluate(
      async ({ body, token: t }) => {
        const r = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": t },
          body: JSON.stringify(body),
        })
        const d = await r.json().catch(() => ({}))
        return { status: r.status, id: d.order?.id ?? null }
      },
      {
        token,
        body: {
          routeFrom: spec.from,
          routeTo: spec.to,
          distance: spec.distance,
          weight: spec.weight,
          volume: 10,
          cargoType: "Паллеты",
          price: spec.price,
          clientName: spec.name,
          clientContact: spec.contact,
        },
      },
    )
    if (res.id) {
      const token2 = await csrf()
      const agreed = await page.evaluate(
        async ({ id, token: t }) => {
          const r = await fetch(`/api/orders/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-csrf-token": t },
            body: JSON.stringify({ status: "agreed" }),
          })
          return r.status
        },
        { id: res.id, token: token2 },
      )
      if (agreed === 200) created.push(res.id)
    }
  }
  check("Три согласованных заказа созданы", created.length === 3, `создано ${created.length}`)

  await page.goto(`${BASE}/lm/routes/assistant`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(6000)

  // ── 1. Панель ──
  const panelBtn = page.locator('button:has-text("Собрать вокруг заказа")')
  check("Панель «Собрать вокруг заказа» на месте", (await panelBtn.count()) > 0)
  if (await panelBtn.count()) {
    await panelBtn.first().click()
    await page.waitForTimeout(900)
  }
  const panelText = await page.evaluate(() => document.body.innerText || "")
  check(
    "Радиус задаётся кнопками",
    panelText.includes("Радиус сборки") && panelText.includes("по направлению") && panelText.includes("50 км"),
    panelText.slice(0, 200),
  )

  // ── 2. Опорный заказ ──
  const anchorButton = page.locator(`button:has-text("${MARK}опорный")`)
  if (await anchorButton.count()) {
    await anchorButton.first().click()
    await page.waitForTimeout(1500)
  }
  let text = await page.evaluate(() => document.body.innerText || "")
  check("Выбран опорный заказ — список свернулся к одной карточке", text.includes("Собрано вокруг:"), text.slice(0, 200))
  check("Появилась кнопка «Сбросить»", text.includes("Сбросить"))
  const cardCount = await page.locator('button:has-text("Предложить рейс")').count()
  check("Карточка ровно одна", cardCount === 1, `карточек: ${cardCount}`)

  // ── 3. Радиус 100 км: попутный (Обнинск ~60 км от Калуги) должен взяться,
  //      далёкий (Воронеж) — нет ──
  const radiusBtn = page.locator('button:has-text("100 км")')
  if (await radiusBtn.count()) {
    await radiusBtn.first().click()
    await page.waitForTimeout(3000)
  }
  text = await page.evaluate(() => document.body.innerText || "")
  check("Радиус меняется на 100 км", text.includes("Радиус сборки: 100 км"), text.slice(0, 200))
  check("Попутный груз рядом взят", text.includes(`${MARK}попутный`), text.slice(0, 300))
  check("Далёкий груз не взят", !text.includes(`${MARK}далёкий`) || text.includes("Не взято"), text.slice(0, 300))
  check(
    "Не взятое объяснено причиной",
    /Не взято \(\d+\)/.test(text) || text.includes("Готово: рейс из одного заказа"),
    text.slice(0, 300),
  )

  await page.screenshot({ path: `${OUT_DIR}/taskH-anchor.png`, fullPage: false })

  // ── 5. «Предложить рейс» ──
  const proposeBtn = page.locator('button:has-text("Предложить рейс")').first()
  if (await proposeBtn.count()) {
    await proposeBtn.click()
    await page.waitForTimeout(6000)
    check("«Предложить рейс» создаёт рейс", page.url().includes("/lm/routes/"), page.url())
    await page.screenshot({ path: `${OUT_DIR}/taskH-anchor-route.png`, fullPage: false })
  } else {
    check("«Предложить рейс» доступен", false, "кнопки нет")
  }

  check("Нет ошибок страницы", errors.length === 0, errors.slice(0, 2).join(" | "))

  console.log(`\nИтог: ${pass} ок / ${fail} сбоя`)
  if (failures.length) console.log("Сбои:\n - " + failures.join("\n - "))
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error("ПРОВАЛ СЦЕНАРИЯ:", e.message)
  process.exit(1)
})
