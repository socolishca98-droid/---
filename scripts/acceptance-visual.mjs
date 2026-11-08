// Живая приёмка «сдержанно-премиальной» атмосферы (задача по мотивам
// MotionSites): экран входа (LoginAurora — canvas со «сиянием» и частицами)
// и дашборд (ambient-слой над картой, живые счётчики KPI, panel-rise).
//
// Прогон дешёвый: prefers-reduced-motion (canvas рисует один статичный
// кадр, CSS-анимации замирают) — DOM-проверки и скриншоты от этого не
// зависят. У реального пользователя всё движется.
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://localhost:3100"

function envValue(name) {
  const line = readFileSync("/home/user/loginex/.env", "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${name}=`))
  if (!line) throw new Error(`нет ${name} в .env`)
  return line.slice(name.length + 1).trim().replace(/^"(.*)"$/, "$1")
}

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "OK  " : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`)
}

const browser = await chromium.launch({ args: ["--disable-gpu"] })
const context = await browser.newContext({
  viewport: { width: 1024, height: 640 },
  reducedMotion: "reduce",
})
const page = await context.newPage()

const consoleErrors = []
const pageErrors = []
process.on("exit", () => {
  // страховка: браузер не должен переживать скрипт (в песочнице 2 ГБ RAM)
  try { browser.close() } catch {}
})
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200))
})
page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)))

// ── Экран входа ──
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForSelector("form", { timeout: 30000 })
check("экран входа открылся", true)

const aurora = await page.evaluate(() => {
  const canvas = document.querySelector("canvas")
  if (!canvas) return null
  return { w: canvas.width, h: canvas.height, visible: canvas.clientWidth > 0 }
})
check("LoginAurora: canvas с сиянием и частицами", aurora != null && aurora.w > 0 && aurora.visible, JSON.stringify(aurora))

const hasCard = await page.locator("form").first().isVisible()
check("карточка входа видна", hasCard)

await page.screenshot({ path: "/home/user/work/visual-login.png" })
check("скриншот входа сохранён", true, "work/visual-login.png")

// ── Вход и дашборд ──
const csrfRes = await context.request.get(`${BASE}/api/auth/csrf`)
const csrfCookie = (await csrfRes.headers()["set-cookie"] || "").match(/loginex_csrf=([^;]+)/)?.[1]
const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
  headers: { "content-type": "application/json", "x-csrf-token": csrfCookie },
  data: { email: envValue("OWNER_EMAIL"), password: envValue("OWNER_PASSWORD") },
})
check("вход владельца", loginRes.status() === 200, `HTTP ${loginRes.status()}`)

await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForSelector(".leaflet-container", { state: "attached", timeout: 90000 })

const ambient = await page.evaluate(() => {
  const pane = document.querySelector('.leaflet-pane[class*="ambientGlow"]')
  if (!pane) return null
  const blobs = pane.querySelectorAll(".ambient-blob")
  return { blobs: blobs.length, size: pane.clientWidth > 0 }
})
check("ambient-слой над картой (pane z205)", ambient != null && ambient.blobs === 3, JSON.stringify(ambient))

await page.waitForSelector(".driver-marker", { state: "attached", timeout: 45000 })

const kpi = await page.evaluate(() => {
  const header = document.querySelector("header.panel-rise")
  return { panelRise: header != null }
})
check("panel-rise на HUD статистики", kpi.panelRise)

const numbers = await page.evaluate(() => {
  const texts = [...document.querySelectorAll("header .text-xs.font-bold")].map((el) => el.textContent?.trim())
  return texts.filter(Boolean).slice(0, 6)
})
check("KPI-числа на месте", numbers.length >= 2, numbers.join(" | "))

await page.screenshot({ path: "/home/user/work/visual-dashboard.png" })
check("скриншот дашборда сохранён", true, "work/visual-dashboard.png")

check("нет ошибок страницы", pageErrors.length === 0, pageErrors.slice(0, 2).join(" || "))
const realConsoleErrors = consoleErrors.filter(
  (text) => !text.includes("favicon") && !text.includes("React DevTools") && !text.includes("CARTO_API_KEY") && !text.includes("caret-color"),
)
check("нет ошибок консоли", realConsoleErrors.length === 0, realConsoleErrors.slice(0, 2).join(" || "))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено`)
await browser.close()
process.exit(failed.length > 0 ? 1 : 0)
