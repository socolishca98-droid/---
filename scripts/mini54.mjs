// mini54 — приёмочные проверки и54 «нет следов входа»:
//   1) живые часы в углу каждого экрана тикают (снимок/призрак — стоят);
//   2) строка «живой экран · время» на форме входа водителя;
//   3) мир входа сворачивается при уходе со страницы (pagehide) — призраку
//      не из чего возникнуть — и возвращается при pageshow;
//   4) вход логиста доступен анониму (диагностика diag_login проверяется
//      отдельно по журналу);
//   5) возврат к видимому экрану кабинета бьёт метку пульса (beat=1&mark=1) —
//      журнал видит каждое возвращение в приложение.
// Запуск: node scripts/mini54.mjs  (BASE=http://localhost:3100, дев-сервер поднят)

import { chromium } from "playwright"

const BASE = process.env.BASE || "http://localhost:3100"
const EMAIL = process.env.E2E_EMAIL || "owner@local.test"
const PASSWORD = process.env.E2E_PASSWORD || "Proverka123"
// iPhone UA: без него «Войти как водитель» уходит в десктоп-ветку и31
// (window.open в новом окне), и кабинет не открывается в этой вкладке.
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

// ── 1–3: экран входа водителя ──────────────────────────────────────────────
await page.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded" })
await page.waitForSelector("#loginex-clock", { timeout: 20000 })

const clockAt = async () => page.textContent("#loginex-clock")
const t1 = await clockAt()
await page.waitForTimeout(3300)
const t2 = await clockAt()
check("живые часы в углу тикают", t1 !== t2 && /\d/.test(t2 || ""), `${t1} → ${t2}`)

const live = await page.textContent("[data-live-clock]").catch(() => null)
check(
  "строка «живой экран · время» на входе водителя",
  Boolean(live && live.includes("живой экран") && /\d{2}:\d{2}/.test(live)),
  live || "не найдена",
)

const worldDisp = async () =>
  page.evaluate(() => {
    const el = document.querySelector("[data-login-world]")
    return el ? el.style.display : "NO_ELEMENT"
  })
const d0 = await worldDisp()
await page.evaluate(() => window.dispatchEvent(new Event("pagehide")))
const d1 = await worldDisp()
await page.evaluate(() => window.dispatchEvent(new Event("pageshow")))
const d2 = await worldDisp()
check(
  "мир входа сворачивается при уходе со страницы и возвращается",
  d0 === "" && d1 === "none" && d2 === "",
  `до=${JSON.stringify(d0)} pagehide=${JSON.stringify(d1)} pageshow=${JSON.stringify(d2)}`,
)

// ── 4: вход логиста анониму ────────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
const staffForm = await page
  .waitForSelector("[data-login-panel] input#email", { timeout: 20000 })
  .then(() => true)
  .catch(() => false)
check("вход логиста: форма доступна анониму", staffForm)

// ── 5: возврат в кабинет бьёт метку пульса ────────────────────────────────
// штабной вход → «Войти как водитель» → на /m имитируем возврат вкладки
let okLogin = false
for (let attempt = 1; attempt <= 4 && !okLogin; attempt++) {
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
    const panel = page.waitForSelector("[data-login-panel] input#email", { timeout: 20000 })
    await panel
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

let inDriverCab = false
if (okLogin) {
  try {
    await page.waitForSelector("text=Компании на платформе", { timeout: 20000 })
    await page.click("a[href^='/owner/org/']")
    await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 20000 })
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Войти как водитель"),
      )
      btn?.click()
    })
    await page.waitForURL(/\/m$/, { timeout: 30000 })
    await page.waitForTimeout(2500) // гидрация + старт пульса
    inDriverCab = true
  } catch (e) {
    console.log("вход как водитель не удался:", String(e).slice(0, 120))
  }
}
check("вход как водитель — кабинет /m", inDriverCab)

if (inDriverCab) {
  const markPromise = page.waitForRequest(
    (r) => r.url().includes("/api/auth/session?kind=driver&beat=1&mark=1"),
    { timeout: 15000 },
  )
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  const markReq = await markPromise.catch(() => null)
  check("возврат к экрану бьёт метку пульса (mark=1)", Boolean(markReq))
}

await browser.close()
console.log(`\nИТОГ mini54: ${failures === 0 ? "ВСЁ ЗЕЛЁНОЕ" : `ПРОВАЛОВ: ${failures}`}`)
process.exit(failures ? 1 : 0)
