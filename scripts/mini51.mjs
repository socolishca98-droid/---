// mini51: «утро владельца» — телефон потерял штабную cookie за ночь
// (журнал 15.11 06:07: сессия в базе жива, штабной cookie нет, cookie
// имперсонации и водительской сессии живы). Раньше это приводило к экрану
// входа: «Вернуться» и «Войти как» падали в 403 ещё в proxy.
// Проверяем спасение и51:
//  1. вход владельца → org → «Войти как водитель» → кабинет /m;
//  2. удаляем ТОЛЬКО штабную cookie (как ночной сброс телефона);
//  3. кнопка «Вернуться» на баннере — работает (POST /api/admin/return
//     проходит через proxy по cookie имперсонации), владелец в /owner;
//  4. снова «Войти как водитель» → снова имперсонация без входа по паролю;
//  5. прямое открытие штабной страницы без штабной cookie — НЕ форма
//     входа, а спасение: /api/admin/return?next=… → задуманная страница.
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://localhost:3100"
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`)
}

const browser = await chromium.launch({ args: ["--disable-gpu"] })
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
// и56: «Войти как …» на телефоне теперь открывает НОВУЮ вкладку; этот
// сценарий проверяет свою ветку — запасной путь в той же вкладке, — поэтому
// просим браузер не давать вкладку (окно как «заблокировано»).
  await context.addInitScript(() => {
    window.open = () => null
  })
  let page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 150)))

  // 1. Владелец → org → «Войти как водитель»
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForSelector("[data-login-panel] input#email", { timeout: 60000 })
  // Гидратация на холодном деве может смыть ранний ввод (e2e typeStable):
  // печатаем, ждём, проверяем, что значения живы — иначе печатаем снова.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.fill("#email", "owner@local.test")
    await page.fill("#password", "Proverka123")
    await page.waitForTimeout(1500)
    const email = await page.inputValue("#email").catch(() => "")
    const password = await page.inputValue("#password").catch(() => "")
    if (email === "owner@local.test" && password === "Proverka123") break
  }
  await page.locator("#password").press("Enter")
  await page.waitForURL("**/owner", { timeout: 120000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 60000 })
  await page.locator("a[href^='/owner/org/']").first().click()
  await page.waitForURL(/\/owner\/org\//, { timeout: 60000 })
  await page.waitForSelector("text=Войти как водитель", { timeout: 60000 })
  await page.locator("button", { hasText: "Войти как водитель" }).first().evaluate((el) => el.click())
  // и58: телефон — пересадка в той же вкладке, кабинет — настоящей ссылкой
  await page.waitForURL(/\/owner\/open-account/, { timeout: 60000 })
  await page.locator("[data-cab-open-link]").first().waitFor({ state: "visible", timeout: 60000 })
  ;[page] = await Promise.all([
    page.waitForEvent("popup", { timeout: 60000 }),
    page.locator("[data-cab-open-link]").first().click(),
  ])
  await page.waitForURL(/\/m/, { timeout: 60000 })

  await page.waitForSelector("text=Вы вошли как", { timeout: 60000 })
  check("вход как водитель — кабинет /m с баннером", true, page.url())

  // 2. «Ночь»: удаляем ТОЛЬКО штабную cookie
  await context.clearCookies({ name: "loginex_staff_session" })
  const staffCookie = await context.cookies().then((cs) => cs.find((c) => c.name === "loginex_staff_session"))
  const impersonationCookie = await context
    .cookies()
    .then((cs) => cs.find((c) => c.name === "loginex_owner_session"))
  check(
    "штабная cookie удалена, cookie имперсонации жива",
    !staffCookie && Boolean(impersonationCookie),
    `staff=${staffCookie ? "есть" : "нет"}, impersonation=${impersonationCookie ? "есть" : "нет"}`,
  )

  // 3. «Вернуться» на баннере при мёртвой штабной cookie
  await page.locator("button", { hasText: "Вернуться" }).first().click()
  await page.waitForURL("**/owner", { timeout: 60000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 60000 })
  check("«Вернуться» без штабной cookie — владелец в своей панели", true, page.url())

  // 4. Снова «Войти как водитель» — без пароля
  await page.locator("a[href^='/owner/org/']").first().click()
  await page.waitForURL(/\/owner\/org\//, { timeout: 60000 })
  await page.waitForSelector("text=Войти как водитель", { timeout: 60000 })
  await page.locator("button", { hasText: "Войти как водитель" }).first().evaluate((el) => el.click())
  // и58: телефон — пересадка в той же вкладке, кабинет — настоящей ссылкой
  await page.waitForURL(/\/owner\/open-account/, { timeout: 60000 })
  await page.locator("[data-cab-open-link]").first().waitFor({ state: "visible", timeout: 60000 })
  ;[page] = await Promise.all([
    page.waitForEvent("popup", { timeout: 60000 }),
    page.locator("[data-cab-open-link]").first().click(),
  ])
  await page.waitForURL(/\/m/, { timeout: 60000 })

  await page.waitForSelector("text=Вы вошли как", { timeout: 60000 })
  check("повторное «Войти как водитель» — снова кабинет, без формы входа", true, page.url())

  // 5. Спасение штабной страницы: удаляем штабную cookie и открываем /owner
  await context.clearCookies({ name: "loginex_staff_session" })
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 60000 })
  const landed = new URL(page.url()).pathname
  check(
    "открытие /owner без штабной cookie — спасение в панель, НЕ форма входа",
    landed === "/owner",
    `итоговый путь: ${landed}`,
  )

  check("ошибок страницы нет", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "чисто")
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ mini51: ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
