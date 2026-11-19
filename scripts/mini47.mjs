// и47: телефон — «Войти как водитель» открывает кабинет В ТОЙ ЖЕ ВКЛАДКЕ.
// Причина и47: на iPhone Safari window.open после выпуска сессии (два await
// после нажатия) открывает/навигирует вкладку кабинета В ФОНЕ — focus()
// телефон игнорирует. Журнал сервера при этом чист: сессия выдана, /m
// загружен, ошибок нет — но человек смотрит на прежний экран. Переход в
// той же вкладке ставит кабинет ровно туда, куда человек смотрит.
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
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  })
// и56: «Войти как …» на телефоне теперь открывает НОВУЮ вкладку; этот
// сценарий проверяет свою ветку — запасной путь в той же вкладке, — поэтому
// просим браузер не давать вкладку (окно как «заблокировано»).
  await context.addInitScript(() => {
    window.open = () => null
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)))

  // 1. Вход владельца своим паролем (холодный обзор организации может
  //    исполняться десятки секунд — таймауты щедрые)
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  await page.fill("#email", process.env.OWNER_EMAIL || "owner@local.test")
  await page.fill("#password", process.env.OWNER_PASSWORD || "Proverka123")
  await page.locator("#password").press("Enter")
  await page.waitForURL("**/owner", { timeout: 90000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 90000 })
  check("вход владельца (iPhone-UA) → панель", true, page.url())

  // 2. Страница управления организацией → «Войти как водитель»
  await page.locator("a[href^='/owner/org/']").first().click()
  await page.waitForURL(/\/owner\/org\//, { timeout: 60000 })
  await page.waitForSelector("text=Войти как водитель", { timeout: 60000 })
  let popupFired = false
  page.once("popup", () => {
    popupFired = true
  })
  await page.locator("button", { hasText: "Войти как водитель" }).first().evaluate((el) => el.click())

  // 3. и58: кнопка НЕ открывает программную вкладку — текущая вкладка
  //    переходит на страницу-пересадку, где кабинет открывается настоящей
  //    ссылкой (клик человека). Это и есть «запасной путь в той же вкладке»:
  //    даже с полностью выключенным window.open путь работает.
  await page.waitForURL(/\/owner\/open-account/, { timeout: 60000 })
  await page.waitForSelector("text=Сессия готова", { timeout: 60000 })
  check(
    "«Войти как водитель» — пересадка в ТОЙ ЖЕ вкладке, попапа не было",
    !popupFired && /\/owner\/open-account/.test(page.url()),
    page.url(),
  )

  // 3б. Настоящая ссылка на пересадке открывает кабинет новой вкладкой
  const cabLink = page.locator("[data-cab-open-link]").first()
  const [cabPage] = await Promise.all([
    page.waitForEvent("popup", { timeout: 60000 }),
    cabLink.click(),
  ])
  await cabPage.waitForURL(/\/m/, { timeout: 60000 })
  await cabPage.waitForSelector("text=Вы вошли как", { timeout: 60000 })
  check("ссылка «Открыть кабинет» → вкладка кабинета /m", /\/m/.test(cabPage.url()), cabPage.url())
  const banner = await cabPage.locator("text=Вы вошли как").first().textContent()
  check("полоса «Вы вошли как …» на месте", Boolean(banner && banner.length > 10), (banner ?? "").slice(0, 60))

  // 4. «Вернуться» возвращает на панель владельца — путь назад не теряется
  await cabPage.locator("button", { hasText: "Вернуться" }).first().evaluate((el) => el.click())
  await cabPage.waitForURL("**/owner", { timeout: 90000 })
  check("«Вернуться» → панель владельца", true, cabPage.url())

  check("ошибок страницы нет", errors.length === 0, errors.slice(0, 2).join(" | ") || "чисто")
} finally {
  await browser.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ и47: ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
