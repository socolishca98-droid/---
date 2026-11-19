import { chromium } from "playwright"
const BASE = "http://localhost:3100"
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA })
const page = await context.newPage()
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
await page.waitForSelector("[data-login-panel] input#email", { timeout: 20000 })
await page.fill("[data-login-panel] input#email", "owner@local.test")
await page.fill("[data-login-panel] input#password", "Proverka123")
await page.press("[data-login-panel] input#password", "Enter")
await page.waitForURL(/\/owner/, { timeout: 30000 })
await page.waitForSelector("text=Компании на платформе", { timeout: 20000 })
await page.click("a[href^='/owner/org/']")
await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 20000 })
const btn = page.locator("button", { hasText: "Войти как водитель" }).first()
const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 30000 }), btn.click()])
console.log("попап открылся, начальный url:", popup.url())
// ждём как владелец: 7 секунд после загрузки
await popup.waitForURL(/\/m/, { timeout: 30000 }).catch((e) => console.log("waitForURL /m:", String(e).slice(0, 100)))
await popup.waitForTimeout(7000)
const dump = await popup.evaluate(() => {
  const t = (sel) => document.querySelectorAll(sel).length
  const txt = document.body.innerText
  return {
    url: location.href,
    title: document.title,
    clock: t("#loginex-clock"),
    passwordInputs: t("input[type=password]"),
    telInputs: t("input[type=tel], input[name=phone]"),
    loginPanel: t("[data-login-panel]"),
    logistLink: [...document.querySelectorAll("a")].filter((a) => /Вход для логиста/.test(a.textContent || "")).length,
    propusk: txt.includes("ПРОПУСК"),
    dobroy: txt.includes("Доброй"),
    vhodApp: txt.includes("Вход в приложение"),
    banner: txt.includes("Вы вошли как"),
    vernutsya: txt.includes("Вернуться"),
    smena: txt.includes("Смена не начата"),
    header: txt.slice(0, 700),
  }
})
console.log(JSON.stringify(dump, null, 2))
await popup.screenshot({ path: "/tmp/popup58.png", fullPage: false })
console.log("скриншот: /tmp/popup58.png")
// что показывает вкладка-источник (страница управления) после нажатия?
const orgDump = await page.evaluate(() => ({ url: location.href, hasButton: [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Войти как водитель")), greenBar: Boolean(document.getElementById("loginex-cab-hint")) }))
console.log("вкладка управления:", JSON.stringify(orgDump))
await browser.close()
