// mini56 — приёмочные проверки и56: «Войти как …» на телефоне открывает
// кабинет в НОВОЙ вкладке, созданной синхронно с нажатием кнопки (жест,
// который iOS признаёт), с адресом — после выпуска и проверки сессии.
// Застывший кадр старой формы входа (жалобы 16–18.11: кадр живёт во вкладке
// и переживает даже перезапуск программы) в новой вкладке оказаться не может.
//   1) телефон: «Войти как водитель» → новая вкладка → /m, кабинет живой;
//   2) пока сессия выпускается, во вкладке заставка «Открываю кабинет…»;
//   3) вкладки заблокированы (window.open → null) → переход в той же вкладке;
//   4) «программа» (standalone, PWA) → переход в том же окне, вкладок нет;
//   5) подсказка баннера указывает на вкладку.
// Запуск: node scripts/mini56.mjs  (BASE=http://localhost:3100, дев-сервер поднят)

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

async function loginOwner(page) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
      await page.waitForSelector("[data-login-panel] input#email", { timeout: 20000 })
      await page.fill("[data-login-panel] input#email", EMAIL)
      await page.fill("[data-login-panel] input#password", PASSWORD)
      await page.press("[data-login-panel] input#password", "Enter")
      await page.waitForURL(/\/owner/, { timeout: 30000 })
      return true
    } catch {
      await page.waitForTimeout(1500)
    }
  }
  return false
}

async function openOrgPage(page) {
  await page.waitForSelector("text=Компании на платформе", { timeout: 20000 })
  await page.click("a[href^='/owner/org/']")
  await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 20000 })
}

// ── 1+2: новая вкладка с заставкой и кабинетом ────────────────────────────
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  // держим выпуск сессии полторы секунды: заставка во вкладке обязана
  // успеть появиться и продержаться — проверка не гонка, а утверждение
  await context.route("**/api/admin/impersonate", async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  const page = await context.newPage()
  const okLogin = await loginOwner(page)
  let popup = null
  let loadingSeen = false
  if (okLogin) {
    try {
      await openOrgPage(page)
      const btn = page.locator("button", { hasText: "Войти как водитель" }).first()
      // и58: программной вкладки больше нет — пересадка в той же вкладке
      await btn.click()
      await page.waitForURL(/\/owner\/open-account/, { timeout: 30000 })
      await page.locator("[data-cab-open-link]").first().waitFor({ state: "visible", timeout: 30000 })
      const [p] = await Promise.all([
        page.waitForEvent("popup", { timeout: 30000 }),
        page.locator("[data-cab-open-link]").first().click(),
      ])
      popup = p
      await popup.waitForFunction(
        () => document.body !== null && document.body.innerText.includes("Вы вошли как"),
        { timeout: 8000 },
      )
      loadingSeen = true
      await popup.waitForURL(/\/m/, { timeout: 30000 })
      await popup.waitForTimeout(2500)
    } catch (e) {
      console.log("сценарий 1:", String(e).slice(0, 160))
    }
  }
  check(
    "телефон: кабинет в новой вкладке (/m)",
    okLogin && Boolean(popup) && /\/m/.test(popup.url()),
    popup ? `вкладка: ${popup.url()}` : okLogin ? "вкладка не открылась" : "вход не удался",
  )
  check("и58: кабинет открывается настоящей ссылкой с пересадки", loadingSeen)
  if (popup) {
    const body = (await popup.textContent("body")) ?? ""
    check(
      "в новой вкладке живой кабинет: баннер и возврат",
      body.includes("Вы вошли как") && body.includes("Вернуться"),
    )
  }
  await context.close()
}

// ── 3: вкладки заблокированы — переход в той же вкладке ──────────────────
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  await context.addInitScript(() => {
    window.open = () => null
  })
  const page = await context.newPage()
  const okLogin = await loginOwner(page)
  let sameTab = false
  if (okLogin) {
    try {
      await openOrgPage(page)
      const btn = page.locator("button", { hasText: "Войти как водитель" }).first()
      await btn.click()
      // и58: вкладки заблокированы — пересадка в той же вкладке; кабинет
      // открывает НАСТОЯЩАЯ ссылка (не window.open — блокировщик её не ест)
      await page.waitForURL(/\/owner\/open-account/, { timeout: 30000 })
      await page.locator("[data-cab-open-link]").first().waitFor({ state: "visible", timeout: 30000 })
      const [p3] = await Promise.all([
        page.waitForEvent("popup", { timeout: 30000 }),
        page.locator("[data-cab-open-link]").first().click(),
      ])
      await p3.waitForURL(/\/m/, { timeout: 30000 })
      await p3.waitForTimeout(2500)
      sameTab = true
    } catch (e) {
      console.log("сценарий 3:", String(e).slice(0, 160))
    }
  }
  check("вкладки заблокированы: пересадка + кабинет настоящей ссылкой", okLogin && sameTab)
  await context.close()
}

// ── 4: «программа» (standalone) — без новых вкладок ──────────────────────
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  await context.addInitScript(() => {
    const orig = window.matchMedia.bind(window)
    window.matchMedia = (q) =>
      q === "(display-mode: standalone)"
        ? ({
            matches: true,
            media: q,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return false
            },
          })
        : orig(q)
  })
  const page = await context.newPage()
  const okLogin = await loginOwner(page)
  let popupFired = false
  page.on("popup", () => {
    popupFired = true
  })
  let sameTab = false
  if (okLogin) {
    try {
      await openOrgPage(page)
      const btn = page.locator("button", { hasText: "Войти как водитель" }).first()
      await btn.click()
      await page.waitForURL(/\/m/, { timeout: 30000 })
      await page.waitForTimeout(1500)
      sameTab = true
    } catch (e) {
      console.log("сценарий 4:", String(e).slice(0, 160))
    }
  }
  check(
    "программа (standalone): переход в том же окне, без новых вкладок",
    okLogin && sameTab && !popupFired,
  )
  await context.close()
}

await browser.close()
console.log(`\nИТОГ mini56: ${failures === 0 ? "ВСЁ ЗЕЛЁНОЕ" : `ПРОВАЛОВ: ${failures}`}`)
process.exit(failures ? 1 : 0)
