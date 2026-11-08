// Живая приёмка основной карты (дашборд) после правок «красоты».
// Прогон дешёвый по CPU: prefers-reduced-motion (canvas без rAF-цикла),
// проверка DOM-элементов по состоянию attached (маркеры могут быть вне
// вьюпорта карты — для Leaflet это нормально), hover эмулируем dispatchEvent
// mouseover — Leaflet открывает тултип независимо от положения элемента.
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://localhost:3100"

function envValue(name) {
  const match = readFileSync("/home/user/loginex/.env", "utf8")
    .split("\n")
    .find((line) => line.startsWith(`${name}=`))
  if (!match) throw new Error(`нет ${name} в .env`)
  return match.slice(name.length + 1).trim().replace(/^"(.*)"$/, "$1")
}

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "OK  " : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1100, height: 700 },
  reducedMotion: "reduce",
})
const page = await context.newPage()

const consoleErrors = []
const pageErrors = []
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200))
})
page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)))

// ── Вход ──
const csrfRes = await context.request.get(`${BASE}/api/auth/csrf`)
const csrfCookie = (await csrfRes.headers()["set-cookie"] || "").match(/loginex_csrf=([^;]+)/)?.[1]
const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
  headers: { "content-type": "application/json", "x-csrf-token": csrfCookie },
  data: { email: envValue("OWNER_EMAIL"), password: envValue("OWNER_PASSWORD") },
})
check("вход владельца", loginRes.status() === 200, `HTTP ${loginRes.status}`)

// ── Дашборд ──
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 })
await page.waitForSelector(".leaflet-container", { state: "attached", timeout: 90000 })
check("карта (leaflet) отрисована", true)

await page.waitForSelector(".driver-marker", { state: "attached", timeout: 90000 })
const driverCount = await page.locator(".driver-marker").count()
check("маркеры водителей (грузовички) в DOM", driverCount > 0, `${driverCount} шт.`)

const canvasInfo = await page.evaluate(() => {
  const pane = document.querySelector('.leaflet-pane[class*="routeAnimation"]')
  const canvas = pane ? pane.querySelector("canvas") : null
  if (!canvas) return null
  return { w: canvas.width, h: canvas.height }
})
check("canvas нитей в pane z450", canvasInfo != null && canvasInfo.w > 0, JSON.stringify(canvasInfo))

await page.waitForSelector(".wp-container", { state: "attached", timeout: 30000 })
const wpCount = await page.locator(".wp-container").count()
check("точки рейса (погрузка/выгрузка) в DOM", wpCount > 0, `${wpCount} шт.`)

// тултип: mouseover через dispatchEvent — Leaflet открывает его в DOM
await page.locator(".wp-container").first().evaluate((el) => {
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }))
})
try {
  await page.waitForSelector(".wp-hint", { state: "attached", timeout: 5000 })
  const hintText = await page.locator(".wp-hint").first().textContent()
  check("тултип точки (наведение)", (hintText || "").length > 0, (hintText || "").slice(0, 60))
} catch {
  check("тултип точки (наведение)", false, "не появился за 5 с")
}

// панель прогноза. Перед этим закрываем приветственный диалог
// (FirstLoginGuide), если он открыт — его оверлей перехватывает клики.
const overlay = page.locator('[data-slot="dialog-overlay"]')
if ((await overlay.count()) > 0) {
  try {
    const guideButton = page.locator('button:has-text("Понятно, начать работу")')
    if ((await guideButton.count()) > 0) await guideButton.click({ timeout: 5000 })
    else await page.keyboard.press("Escape")
    await overlay.waitFor({ state: "detached", timeout: 5000 })
  } catch {
    await page.keyboard.press("Escape")
  }
}
const forecastButton = page.locator('button[title^="Прогноз рейса"]')
const hasButton = (await forecastButton.count()) > 0
check("кнопка прогноза рейса", hasButton)
if (hasButton) {
  // Панель водителей (z-1050) может перекрывать кнопку — кликаем программно
  await forecastButton.evaluate((el) => el.click())
  await page.waitForSelector("text=Следующая точка", { timeout: 15000 })
  const panelText = await page.evaluate(() => document.body.innerText)
  check("панель: следующая точка", panelText.toLowerCase().includes("следующая точка"))
  check("панель: живой таймер «через»", /через \d+/.test(panelText), (panelText.match(/через [^\n]{0,30}/) || [""])[0])
  check("панель: осталось по рейсу", panelText.toLowerCase().includes("осталось по рейсу"))
  check("панель: время «до HH:MM»", /до \d{2}:\d{2}/.test(panelText), (panelText.match(/до \d{2}:\d{2}[^ ]{0,20}/) || [""])[0])
}

await page.screenshot({ path: "/home/user/work/acceptance-dashboard-map.png" })
check("скриншот сохранён", true, "work/acceptance-dashboard-map.png")

check("нет ошибок страницы", pageErrors.length === 0, pageErrors.slice(0, 3).join(" || "))
const realConsoleErrors = consoleErrors.filter(
  (text) => !text.includes("favicon") && !text.includes("React DevTools"),
)
check("нет ошибок консоли", realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(" || "))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено`)
process.exit(failed.length > 0 ? 1 : 0)
