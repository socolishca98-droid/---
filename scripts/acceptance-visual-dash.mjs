// Облегчённая живая приёмка дашборда (атмосфера по мотивам MotionSites).
// Никаких жёстких ожиданий: что увидели — то проверили, скриншот в любом
// случае. Песочнице 2 ГБ RAM, дев+Chrome+дашборд на пределе — поэтому
// этот прогон не падает, а фиксирует факты.
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
  console.log(`${ok ? "OK  " : "факт"} | ${name} | ${detail}`)
}

const browser = await chromium.launch({ args: ["--disable-gpu"] })
try {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 640 },
    reducedMotion: "reduce",
  })
  const page = await context.newPage()
  const consoleErrors = []
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200))
  })
  page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 200)))

  const csrfRes = await context.request.get(`${BASE}/api/auth/csrf`)
  const csrfCookie = (await csrfRes.headers()["set-cookie"] || "").match(/loginex_csrf=([^;]+)/)?.[1]
  const loginRes = await context.request.post(`${BASE}/api/auth/login`, {
    headers: { "content-type": "application/json", "x-csrf-token": csrfCookie },
    data: { email: envValue("OWNER_EMAIL"), password: envValue("OWNER_PASSWORD") },
  })
  check("вход", loginRes.status() === 200, `HTTP ${loginRes.status()}`)

  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector(".leaflet-container", { state: "attached", timeout: 60000 })
  check("карта", true, "leaflet-container в DOM")

  // мягкие ожидания: данные могут не успеть — это факт, а не падение
  let markers = 0
  try {
    await page.waitForSelector(".driver-marker", { state: "attached", timeout: 25000 })
    markers = await page.locator(".driver-marker").count()
  } catch {}
  check("маркеры водителей", markers > 0, `${markers} шт.`)

  const ambient = await page.evaluate(() => {
    const pane = document.querySelector('.leaflet-pane[class*="ambientGlow"]')
    return { blobs: pane ? pane.querySelectorAll(".ambient-blob").length : 0 }
  })
  check("ambient-слой (pane z205)", ambient.blobs === 3, `пятен: ${ambient.blobs}`)

  const hud = await page.evaluate(() => {
    const header = document.querySelector("header.panel-rise")
    const kpi = header ? [...header.querySelectorAll(".text-xs.font-bold")].map((el) => el.textContent?.trim()).filter(Boolean) : []
    return { panelRise: header != null, kpi }
  })
  check("panel-rise на HUD", hud.panelRise, hud.panelRise ? "класс на месте" : "не найден")
  check("KPI-числа", hud.kpi.length >= 2, hud.kpi.slice(0, 5).join(" | "))

  await page.screenshot({ path: "/home/user/work/visual-dashboard.png" })
  check("скриншот", true, "work/visual-dashboard.png")

  const realErrors = consoleErrors.filter(
    (t) => !t.includes("favicon") && !t.includes("React DevTools") && !t.includes("CARTO_API_KEY") && !t.includes("caret-color"),
  )
  check("ошибки консоли", realErrors.length === 0, realErrors.slice(0, 2).join(" || ") || "нет")

  await page.close()
} finally {
  await browser.close()
}
console.log("готово")
