// mini57 — приёмочные проверки «Войти как …» на телефоне.
// История: и57 открывал вкладку кабинета программно (window.open("",
// "_blank") в момент нажатия + заставка). Жалоба №11 (18.11 23:16) показала,
// что единственное звено, невидимое серверному журналу, — сам момент
// открытия вкладки: на iPhone Safari программная вкладка может не
// показаться, а поверх живой страницы висит замороженный слой прошлой
// отрисовки. и58 убрал программную вкладку совсем: телефон переходит на
// страницу-пересадку /owner/open-account, и кабинет открывает НАСТОЯЩАЯ
// ссылка <a target="_blank"> — клик человека. Полный приёмочный набор —
// mini58.mjs; здесь дымовая проверка основного пути:
//   1) нажатие «Войти как водитель» → пересадка в ТОЙ ЖЕ вкладке,
//      программной вкладки нет, сессия подтверждена, ссылка _blank;
//   2) клик по ссылке → вкладка кабинета /m: баннер, «Вернуться»,
//      ни одного поля входа.
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
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
      await page.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
      await page.fill("[data-login-panel] input#email", EMAIL)
      await page.fill("[data-login-panel] input#password", PASSWORD)
      await page.press("[data-login-panel] input#password", "Enter")
      await page.waitForURL(/\/owner/, { timeout: 60000 })
      await page.waitForSelector("text=Компании на платформе", { timeout: 60000 })
      return true
    } catch (e) {
      console.log(`попытка входа ${attempt} не удалась:`, String(e).slice(0, 100))
    }
  }
  return false
}

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })
  const page = await context.newPage()

  const okLogin = await loginOwner(page)
  check("вход владельца (iPhone-UA) → панель", okLogin, page.url())
  if (!okLogin) throw new Error("вход владельца не удался")

  await page.click("a[href^='/owner/org/']")
  await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 30000 })
  const btn = page.locator("button", { hasText: "Войти как водитель" }).first()

  let popupFromButton = false
  page.once("popup", () => {
    popupFromButton = true
  })
  await btn.click()

  // 1. Пересадка в той же вкладке, программной вкладки нет
  await page.waitForURL(/\/owner\/open-account/, { timeout: 30000 })
  await page.waitForSelector("text=Сессия готова", { timeout: 30000 })
  check(
    "пересадка в ТОЙ ЖЕ вкладке, кнопка программную вкладку НЕ открывала",
    !popupFromButton && /\/owner\/open-account/.test(page.url()),
    page.url(),
  )
  const link = page.locator("[data-cab-open-link]").first()
  await link.waitFor({ state: "visible", timeout: 10000 })
  check("«Открыть кабинет» — настоящая ссылка _blank", (await link.getAttribute("target")) === "_blank")

  // 2. Кабинет по настоящей ссылке
  const [cab] = await Promise.all([page.waitForEvent("popup", { timeout: 30000 }), link.click()])
  await cab.waitForURL(/\/m/, { timeout: 30000 })
  await cab.waitForSelector("text=Вы вошли как", { timeout: 30000 })
  await cab.waitForTimeout(2500)
  const body = (await cab.textContent("body")) ?? ""
  check(
    "вкладка кабинета: баннер, «Вернуться», ни одного поля входа",
    body.includes("Вы вошли как") &&
      body.includes("Вернуться") &&
      (await cab.locator("input[type=password]").count()) === 0 &&
      !body.includes("пароль выдаёт"),
    cab.url(),
  )
  await context.close()
} catch (e) {
  check("сценарий дошёл до конца без ошибок", false, String(e).slice(0, 160))
} finally {
  await browser.close().catch(() => {})
}

console.log(`\nИТОГ mini57: ${failures ? `ПРОВАЛОВ: ${failures}` : "ВСЁ ЗЕЛЁНОЕ"}`)
process.exit(failures ? 1 : 0)
