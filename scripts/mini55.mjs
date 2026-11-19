// mini55 — приёмочные проверки и55 (обновлены под и56):
//   1) «встряхивание композитора»: при возврате к экрану body на 80 мс
//      получает translateZ(0) — попытка вытеснить застрявшие слои прошлой
//      страницы (жалобы 16–17.11: форма входа-призрак);
//   2) штабной вход владельца;
//   3) «Войти как водитель» на телефоне открывает кабинет в НОВОЙ вкладке
//      (и56): вкладка создаётся синхронно с нажатием, адрес — после сессии;
//   4) баннер «Вы вошли как …» несёт подсказку про застывший кадр и вкладку.
// Запуск: node scripts/mini55.mjs  (BASE=http://localhost:3100, дев-сервер поднят)

import { chromium } from "playwright"

const BASE = process.env.BASE || "http://localhost:3100"
const EMAIL = process.env.E2E_EMAIL || "owner@local.test"
const PASSWORD = process.env.E2E_PASSWORD || "Proverka123"
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"

let failures = 0
const check = (name, ok, info = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${info ? " | " + info : ""}`)
  if (!ok) failures++
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: IPHONE_UA,
})
const page = await context.newPage()

// ── 1: встряхивание композитора ───────────────────────────────────────────
await page.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded" })
await page.waitForSelector("#loginex-clock", { timeout: 20000 })
const bodyT = async () => page.evaluate(() => document.body.style.transform)
const n0 = await bodyT()
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  })
  document.dispatchEvent(new Event("visibilitychange"))
})
const n1 = await bodyT()
await page.waitForTimeout(200)
const n2 = await bodyT()
check(
  "встряхивание композитора: translateZ(0) на ~80 мс при появлении экрана",
  n0 === "" && n1.startsWith("translateZ") && n2 === "",
  `до=${JSON.stringify(n0)} сразу=${JSON.stringify(n1)} после=${JSON.stringify(n2)}`,
)

// ── 2: штабной вход ───────────────────────────────────────────────────────
let okLogin = false
for (let attempt = 1; attempt <= 4 && !okLogin; attempt++) {
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector("[data-login-panel] input#email", { timeout: 20000 })
    await page.fill("[data-login-panel] input#email", EMAIL)
    await page.fill("[data-login-panel] input#password", PASSWORD)
    await page.press("[data-login-panel] input#password", "Enter")
    await page.waitForURL(/\/owner/, { timeout: 30000 })
    okLogin = true
  } catch {
    await page.waitForTimeout(1500)
  }
}
check("штабной вход (владелец)", okLogin)

// ── 3: вход как водитель — кабинет в НОВОЙ вкладке (и56) ─────────────────
let driverPage = null
if (okLogin) {
  try {
    await page.waitForSelector("text=Компании на платформе", { timeout: 20000 })
    await page.click("a[href^='/owner/org/']")
    await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 20000 })
    const btn = page.locator("button", { hasText: "Войти как водитель" }).first()
    await btn.click()
    // и58: пересадка в той же вкладке → кабинет настоящей ссылкой
    await page.waitForURL(/\/owner\/open-account/, { timeout: 30000 })
    await page.locator("[data-cab-open-link]").first().waitFor({ state: "visible", timeout: 30000 })
    const [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 30000 }),
      page.locator("[data-cab-open-link]").first().click(),
    ])
    await popup.waitForURL(/\/m/, { timeout: 30000 })
    await popup.waitForTimeout(2500)
    driverPage = popup
  } catch (e) {
    console.log("вход как водитель не удался:", String(e).slice(0, 160))
  }
}
check(
  "вход как водитель — кабинет /m в новой вкладке",
  Boolean(driverPage) && /\/m/.test(driverPage.url()),
  driverPage ? `вкладка: ${driverPage.url()}` : "вкладка не открылась",
)

// ── 4: подсказка в баннере (вкладке, не программе) ────────────────────────
if (driverPage) {
  const body = (await driverPage.textContent("body")) ?? ""
  check(
    "баннер несёт подсказку о застывшем кадре и вкладке",
    body.includes("Вы вошли как") && body.includes("застывший кадр") && body.includes("вкладк"),
  )
}

await browser.close()
console.log(`\nИТОГ mini55: ${failures === 0 ? "ВСЁ ЗЕЛЁНОЕ" : `ПРОВАЛОВ: ${failures}`}`)
process.exit(failures ? 1 : 0)
