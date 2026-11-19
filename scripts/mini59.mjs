// mini59 — приёмочные проверки и59 (жалоба №12, утро 19.11).
//
// НАСТОЯЩАЯ ПРИЧИНА всех жалоб №7–№12 найдена: с 8 ноября (коммит ae607d6,
// редизайн входа «итерация 9») путь кабинета app/m/page.tsx в репозитории
// по ошибке занимала СТРАНИЦА ВХОДА. Сервер честно отдавал её на /m: живая
// сессия, живые часы, живой баннер — и форма входа вместо кабинета. Все
// «застывшие кадры» и «призраки» были трактовками этого файла. Кабинет
// возвращён из истории git (ae607d6^), и этот мини проверяет главное:
//
//   1) /m с живой водительской сессией = КАБИНЕТ: ни одного поля входа,
//      ни «Доброй дороги», ни «пароль выдаёт»;
//   2) в кабинете живые элементы: баннер «Вы вошли как», «Вернуться»,
//      «Смена не начата», часы, метка сборки;
//   3) путь владельца целиком (телефон): «Войти как водитель» →
//      пересадка и58 → кабинет по настоящей ссылке;
//   4) в баннере больше нет подсказки про «застывший кадр» (призрака
//      не существовало — подсказка врала);
//   5) компьютер: кабинет в именованной вкладке (и45).
// Запуск: node scripts/mini59.mjs  (BASE=http://localhost:3100, дев поднят)

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

async function loginOwner(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.fill("[data-login-panel] input#email", EMAIL)
    await page.fill("[data-login-panel] input#password", PASSWORD)
    await page.waitForTimeout(1500)
    const email = await page.inputValue("[data-login-panel] input#email").catch(() => "")
    if (email === EMAIL) break
  }
  await page.press("[data-login-panel] input#password", "Enter")
  await page.waitForURL(/\/owner/, { timeout: 60000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 60000 })
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
      vhodApp: txt.includes("Вход в приложение"),
      banner: txt.includes("Вы вошли как"),
      vernutsya: txt.includes("Вернуться"),
      smena: txt.includes("Смена не начата"),
      clock: document.querySelectorAll("#loginex-clock").length,
      ghostHint: txt.includes("застывший кадр"),
    }
  })
}

const browser = await chromium.launch()

// ── Сценарий 1: телефон — весь путь владельца до кабинета ────────────────
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  const page = await context.newPage()
  try {
    await loginOwner(page)
    let popupFromButton = false
    page.once("popup", () => {
      popupFromButton = true
    })
    await page.click("a[href^='/owner/org/']")
    await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 30000 })
    await page.locator("button", { hasText: "Войти как водитель" }).first().click()

    await page.waitForURL(/\/owner\/open-account/, { timeout: 30000 })
    await page.waitForSelector("text=Сессия готова", { timeout: 30000 })
    check(
      "телефон: пересадка в той же вкладке, программной вкладки нет",
      !popupFromButton && /\/owner\/open-account/.test(page.url()),
      page.url(),
    )
    const [cab] = await Promise.all([
      page.waitForEvent("popup", { timeout: 30000 }),
      page.locator("[data-cab-open-link]").first().click(),
    ])
    await cab.waitForURL(/\/m/, { timeout: 30000 })
    await cab.waitForSelector("text=Смена не начата", { timeout: 30000 }).catch(() => {})
    await cab.waitForTimeout(5000)
    const d = await dumpCab(cab)
    check(
      "ГЛАВНОЕ: /m — кабинет, ни одного поля входа",
      d.passwordInputs === 0 && d.telInputs === 0 && !d.dobroy && !d.propusk && !d.parol && !d.vhodApp,
      cab.url(),
    )
    check("кабинет живой: баннер, «Вернуться», смена, часы", d.banner && d.vernutsya && d.clock === 1)
    check("кабинет: смена/рейс на экране", d.smena, JSON.stringify({ smena: d.smena }))
    check("баннер: подсказки про «застывший кадр» больше нет", !d.ghostHint)
    await cab.screenshot({ path: "/tmp/mini59-cabinet.png" })
  } catch (e) {
    check("сценарий «телефон» дошёл до конца", false, String(e).slice(0, 160))
  }
  await context.close()
}

// ── Сценарий 2: «программа» (standalone) — кабинет в том же окне ─────────
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  await context.addInitScript(() => {
    const orig = window.matchMedia.bind(window)
    window.matchMedia = (q) =>
      q === "(display-mode: standalone)"
        ? {
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
          }
        : orig(q)
  })
  const page = await context.newPage()
  try {
    await loginOwner(page)
    await page.click("a[href^='/owner/org/']")
    await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 30000 })
    await page.locator("button", { hasText: "Войти как водитель" }).first().click()
    // и43 (вернулось с и59): в «программе» кабинет открывается в ТОМ ЖЕ окне
    await page.waitForURL((u) => new URL(u).pathname === "/m", { timeout: 30000 })
    await page.waitForSelector("text=Смена не начата", { timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(4000)
    const d = await dumpCab(page)
    check(
      "программа: /m в том же окне — кабинет без формы входа",
      d.passwordInputs === 0 && !d.parol && !d.dobroy,
      page.url(),
    )
    check("программа: кабинет живой (баннер + смена)", d.banner && d.smena)
  } catch (e) {
    check("сценарий «программа» дошёл до конца", false, String(e).slice(0, 160))
  }
  await context.close()
}

// ── Сценарий 3: компьютер — и45 не сломан ─────────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  try {
    await loginOwner(page)
    await page.click("a[href^='/owner/org/']")
    await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 30000 })
    const [cab] = await Promise.all([
      page.waitForEvent("popup", { timeout: 30000 }),
      page.locator("button", { hasText: "Войти как водитель" }).first().click(),
    ])
    await cab.waitForURL(/\/m/, { timeout: 30000 })
    await cab.waitForSelector("text=Смена не начата", { timeout: 30000 }).catch(() => {})
    await cab.waitForTimeout(4000)
    const d = await dumpCab(cab)
    check(
      "компьютер: кабинет во вкладке, формы входа нет",
      d.passwordInputs === 0 && !d.parol && !d.dobroy,
      cab.url(),
    )
  } catch (e) {
    check("сценарий «компьютер» дошёл до конца", false, String(e).slice(0, 160))
  }
  await context.close()
}

await browser.close()
console.log(`\nИТОГ mini59: ${failures ? `ПРОВАЛОВ: ${failures}` : "ВСЁ ЗЕЛЁНОЕ"}`)
process.exit(failures ? 1 : 0)
