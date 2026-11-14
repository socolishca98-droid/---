// mini50: локальное воспроизведение жалобы №13 (экран авторизации после
// «Войти как водитель»). Владелец прислал скриншот: форма входа водителя
// (Телефон/Пароль/«Вход для логиста», БЕЗ кнопок владельца) + баннер
// «Вы вошли как Иванов Сергей Петрович» — при живой сессии в журнале.
//
// Что делаем: iPhone-UA + ЛАНДШАФТ (скриншот владельца 2778×1284):
//  1. вход владельца → /owner;
//  2. org-страница → «Войти как водитель»;
//  3. 30 секунд наблюдения за /m: URL + маркеры каждые 500мс + ВСЕ запросы;
//  4. скриншот итога;
//  5. прямой заход на /m/login при живой имперсонации — маркеры + скриншот.
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://localhost:3100"
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"

const browser = await chromium.launch({ args: ["--disable-gpu"] })
try {
  const context = await browser.newContext({
    viewport: { width: 932, height: 430 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })
  const page = await context.newPage()

  const netLog = []
  page.on("response", (res) => {
    try {
      const u = new URL(res.url())
      if (u.pathname.startsWith("/_next")) return
      netLog.push(`${res.request().method()} ${u.pathname}${u.search} → ${res.status()}`)
    } catch {}
  })
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)))
  const consoleErrors = []
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200))
  })

  const markers = async (p) => {
    const has = async (t) =>
      (await p.locator(`text=${t}`).count().catch(() => 0)) > 0
    return {
      url: new URL(p.url()).pathname,
      form: await has("Вход для логиста"),
      formHeadline: await has("Доброй"),
      vput: await has("В путь"),
      banner: await has("Вы вошли как"),
      ownerBtn: await has("вернуться в панель"),
      openCab: await has("Открыть кабинет водителя"),
      diag: await has("Диагностика: cookie"),
    }
  }
  const show = (m) =>
    `${m.url} | форма=${m.form ? "ДА" : "-"} | заголовок=${m.formHeadline ? "ДА" : "-"} | В путь=${m.vput ? "ДА" : "-"} | баннер=${m.banner ? "ДА" : "-"} | влад.кнопки=${m.ownerBtn ? "ДА" : "-"} | открыть каб=${m.openCab ? "ДА" : "-"} | диагностика=${m.diag ? "ДА" : "-"}`

  // ── 1. Вход владельца ────────────────────────────────────────────────────
  console.log("— вход владельца")
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForSelector("[data-login-panel] input#email", { timeout: 60000 })
  await page.fill("#email", "owner@local.test")
  await page.fill("#password", "Proverka123")
  await page.locator("#password").press("Enter")
  await page.waitForURL("**/owner", { timeout: 90000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 60000 })
  console.log("панель:", page.url())

  // ── 2. Org-страница → «Войти как водитель» ──────────────────────────────
  const orgLink = page.locator("a[href^='/owner/org/']").first()
  await orgLink.click()
  await page.waitForURL(/\/owner\/org\//, { timeout: 60000 })
  await page.waitForSelector("text=Войти как водитель", { timeout: 60000 })
  console.log("org-страница:", new URL(page.url()).pathname)
  netLog.length = 0

  await page.locator("button", { hasText: "Войти как водитель" }).first().evaluate((el) => el.click())
  console.log("— нажато «Войти как водитель», наблюдение 30с")

  // ── 3. Наблюдение ────────────────────────────────────────────────────────
  const seen = []
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(500)
    const m = await markers(page)
    const line = show(m)
    if (seen.length === 0 || seen[seen.length - 1] !== line) {
      seen.push(`${(i + 1) * 0.5}s ${line}`)
    }
    if (m.form && m.banner && i > 10) break // поймали экран со скриншота
  }
  console.log("смена состояний /m:")
  seen.forEach((s) => console.log("  " + s))
  await page.screenshot({ path: "/home/user/work/mini50-after.png" })
  console.log("скриншот: /home/user/work/mini50-after.png")

  console.log("сетевые запросы после нажатия:")
  netLog.forEach((l) => console.log("  " + l))
  console.log("ошибки страницы:", pageErrors.length ? pageErrors : "нет")
  console.log("console.error:", consoleErrors.length ? consoleErrors.slice(0, 5) : "нет")

  // ── 4. Прямой заход на /m/login при живой имперсонации ──────────────────
  console.log("— прямой заход на /m/login (имперсонация жива)")
  await page.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForTimeout(3000)
  const m2 = await markers(page)
  console.log("m/login:", show(m2))
  await page.screenshot({ path: "/home/user/work/mini50-mlogin.png" })
  console.log("скриншот: /home/user/work/mini50-mlogin.png")
  console.log("сеть m/login:", netLog.slice(-6).join(" | "))
} finally {
  await browser.close()
}
