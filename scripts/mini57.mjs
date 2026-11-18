// mini57 — приёмочные проверки и57: «Войти как …» на телефоне открывает
// ВСЕГДА НОВУЮ вкладку (_blank), даже если текущая вкладка носит имя
// «loginex-cab». Жалоба №10 (18.11 22:33): именованный поиск из и56
// возвращал ТУ ЖЕ вкладку владельца (имя с и42-эпохи) — кабинет честно
// грузился, но под тем же застывшим кадром: «опять не смог попасть».
//   1) вкладка-тёзка loginex-cab: нажатие открывает НОВУЮ вкладку,
//      страница управления остаётся целой (не перезаписана, не ушла);
//   2) повторное нажатие закрывает прежнюю вкладку кабинета (не копим, и45);
//   3) в новой вкладке живой кабинет /m с баннером и «Вернуться».
// Запуск: node scripts/mini57.mjs  (BASE=http://localhost:3100, дев поднят)

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

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: IPHONE_UA,
})
const page = await context.newPage()
const okLogin = await loginOwner(page)

// ── 1: вкладка-тёзка не ловит кабинет в себя ──────────────────────────────
let popup = null
let selfIntact = false
if (okLogin) {
  try {
    await openOrgPage(page)
    // текущая вкладка «называется» loginex-cab — как у владельца с и42
    await page.evaluate(() => {
      window.name = "loginex-cab"
    })
    const btn = page.locator("button", { hasText: "Войти как водитель" }).first()
    const [p] = await Promise.all([
      page.waitForEvent("popup", { timeout: 30000 }),
      btn.click(),
    ])
    popup = p
    await popup.waitForURL(/\/m/, { timeout: 30000 })
    await popup.waitForTimeout(2000)
    // страница управления цела: адрес тот же, кнопки на месте
    const path = new URL(page.url()).pathname
    const buttons = await page.locator("button", { hasText: "Войти как водитель" }).count()
    selfIntact = /^\/owner\/org\//.test(path) && buttons > 0
  } catch (e) {
    console.log("сценарий 1:", String(e).slice(0, 160))
  }
}
check(
  "вкладка-тёзка loginex-cab: кабинет в НОВОЙ вкладке, страница управления цела",
  okLogin && selfIntact && Boolean(popup) && /\/m/.test(popup ? popup.url() : ""),
  popup ? `вкладка: ${popup.url()}; управление: ${selfIntact ? "цела" : "повреждена"}` : "вкладка не открылась",
)

// ── 2: повторное нажатие закрывает прежнюю вкладку кабинета ──────────────
let popup2 = null
let oldClosed = false
if (popup) {
  try {
    const btn = page.locator("button", { hasText: "Войти как водитель" }).first()
    const [p2] = await Promise.all([
      page.waitForEvent("popup", { timeout: 30000 }),
      btn.click(),
    ])
    popup2 = p2
    for (let i = 0; i < 24 && !popup.isClosed(); i++) await popup.waitForTimeout(250)
    oldClosed = popup.isClosed()
    await popup2.waitForURL(/\/m/, { timeout: 30000 })
    await popup2.waitForTimeout(1500)
  } catch (e) {
    console.log("сценарий 2:", String(e).slice(0, 160))
  }
}
check(
  "повторное нажатие закрывает прежнюю вкладку кабинета (вкладки не копятся)",
  oldClosed && Boolean(popup2) && /\/m/.test(popup2 ? popup2.url() : ""),
  oldClosed ? "прежняя закрыта" : "прежняя осталась открытой",
)

// ── 3: живой кабинет в новой вкладке ──────────────────────────────────────
if (popup2) {
  const body = (await popup2.textContent("body")) ?? ""
  check(
    "в новой вкладке живой кабинет: баннер и возврат",
    body.includes("Вы вошли как") && body.includes("Вернуться"),
  )
}

await context.close()
await browser.close()
console.log(`\nИТОГ mini57: ${failures === 0 ? "ВСЁ ЗЕЛЁНОЕ" : `ПРОВАЛОВ: ${failures}`}`)
process.exit(failures ? 1 : 0)
