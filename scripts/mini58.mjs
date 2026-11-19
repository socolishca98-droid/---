// mini58 — и58: «Войти как водитель» через страницу-пересадку и настоящую
// ссылку (жалоба №11). Проверяем на дев-сервере (BASE, см. ниже):
//   1) телефон: нажатие «Войти как водитель» НЕ открывает программную
//      вкладку — текущая вкладка переходит на /owner/open-account;
//   2) на пересадке появляется «Сессия готова» и большая кнопка —
//      настоящая ссылка <a target="_blank">;
//   3) клик по кнопке открывает вкладку кабинета: /m, живой кабинет,
//      НИ ОДНОГО поля входа (главная претензия жалоб №7–№11);
//   4) компьютер: прежнее поведение и45 — кабинет в именованной вкладке.
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://localhost:3100"
const EMAIL = "owner@local.test"
const PASSWORD = "Proverka123"
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"

const results = []
function ok(name, cond) {
  results.push(!!cond)
  console.log(`${cond ? "✓" : "✗"} ${name}`)
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  await page.fill("[data-login-panel] input#email", EMAIL)
  await page.fill("[data-login-panel] input#password", PASSWORD)
  await page.press("[data-login-panel] input#password", "Enter")
  await page.waitForURL(/\/owner/, { timeout: 30000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 30000 })
}

async function openOrgAndFindButton(page) {
  await page.click("a[href^='/owner/org/']")
  await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 30000 })
  return page.locator("button", { hasText: "Войти как водитель" }).first()
}

async function dumpCab(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText
    return {
      url: location.href,
      passwordInputs: document.querySelectorAll("input[type=password]").length,
      telInputs: document.querySelectorAll("input[type=tel], input[name=phone]").length,
      dobroy: txt.includes("Доброй"),
      propusk: txt.includes("ПРОПУСК"),
      parol: txt.includes("пароль выдаёт"),
      banner: txt.includes("Вы вошли как"),
      smena: txt.includes("Смена не начата"),
      clock: document.querySelectorAll("#loginex-clock").length,
    }
  })
}

const browser = await chromium.launch()

// ─── Сценарий 1: телефон (жалоба №11) ────────────────────────────────────
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  const page = await context.newPage()
  await login(page)
  const btn = await openOrgAndFindButton(page)

  let popupOpened = false
  page.on("popup", () => {
    popupOpened = true
  })

  await btn.click()
  await page.waitForURL(/\/owner\/open-account/, { timeout: 30000 })
  ok("телефон: после нажатия — страница-пересадка в ТОЙ ЖЕ вкладке", /\/owner\/open-account/.test(page.url()))
  ok("телефон: программная вкладка НЕ открывалась", !popupOpened)

  await page.waitForSelector("text=Сессия готова", { timeout: 30000 })
  ok("телефон: пересадка подтвердила сессию водителя", true)
  const bridgeText = await page.evaluate(() => document.body.innerText)
  ok(
    "телефон: на пересадке НЕТ формы входа",
    !bridgeText.includes("пароль выдаёт") && (await page.locator("input[type=password]").count()) === 0,
  )

  const link = page.locator("[data-cab-open-link]").first()
  await link.waitFor({ state: "visible", timeout: 10000 })
  ok(
    "телефон: «Открыть кабинет» — настоящая ссылка _blank",
    (await link.getAttribute("target")) === "_blank",
  )

  const [cab] = await Promise.all([page.waitForEvent("popup", { timeout: 30000 }), link.click()])
  await cab.waitForURL(/\/m/, { timeout: 30000 })
  await cab.waitForSelector("text=Смена не начата", { timeout: 30000 }).catch(() => {})
  await cab.waitForTimeout(6000)
  const dump = await dumpCab(cab)
  ok("телефон: вкладка кабинета открыта по ссылке", /\/m\/?$/.test(dump.url))
  ok(
    "телефон: в кабинете НЕТ полей входа",
    dump.passwordInputs === 0 && dump.telInputs === 0 && !dump.dobroy && !dump.propusk && !dump.parol,
  )
  ok("телефон: кабинет живой (баннер/смена/часы)", dump.banner && dump.clock === 1)
  await cab.screenshot({ path: "/tmp/mini58-cab.png" })
  await context.close()
}

// ─── Сценарий 2: компьютер (и45 не сломан) ───────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  await login(page)
  const btn = await openOrgAndFindButton(page)
  const [cab] = await Promise.all([page.waitForEvent("popup", { timeout: 30000 }), btn.click()])
  await cab.waitForURL(/\/m/, { timeout: 30000 })
  await cab.waitForSelector("text=Смена не начата", { timeout: 30000 }).catch(() => {})
  await cab.waitForTimeout(4000)
  const dump = await dumpCab(cab)
  ok("компьютер: кабинет открылся во вкладке (и45)", /\/m\/?$/.test(dump.url))
  ok(
    "компьютер: в кабинете нет формы входа",
    dump.passwordInputs === 0 && !dump.dobroy && !dump.parol,
  )
  await context.close()
}

await browser.close()

const failed = results.filter((r) => !r).length
console.log(`\nmini58: ${results.length - failed}/${results.length} проверок пройдено`)
process.exit(failed ? 1 : 0)
