// mini50b: последний непротестированный переход.
// /m открыт (кабинет + баннер «Вы вошли как Иванов») → сессия водителя
// умирает В БД (как «Вернуться»/повторная имперсонация из другого окна) →
// что рисует клиент? Форма? Баннер остаётся? TruckLoader? Куда URL?
import { chromium } from "playwright"
import { PrismaClient } from "@prisma/client"

const BASE = process.env.BASE_URL || "http://localhost:3100"
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1"

const prisma = new PrismaClient()
const browser = await chromium.launch({ args: ["--disable-gpu"] })
try {
  const context = await browser.newContext({
    viewport: { width: 932, height: 430 },
    deviceScaleFactor: 3,
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
  const netLog = []
  page.on("response", (res) => {
    try {
      const u = new URL(res.url())
      if (u.pathname.startsWith("/_next")) return
      netLog.push(`${res.request().method()} ${u.pathname}${u.search} → ${res.status()}`)
    } catch {}
  })

  const markers = async (p) => {
    const has = async (t) => (await p.locator(`text=${t}`).count().catch(() => 0)) > 0
    return {
      url: new URL(p.url()).pathname + new URL(p.url()).search,
      form: await has("Вход для логиста"),
      banner: await has("Вы вошли как"),
      ownerBtn: await has("вернуться в панель"),
      diag: await has("Диагностика: cookie"),
      reason: await has("Сессия водителя недействительна"),
    }
  }
  const show = (m) =>
    `${m.url} | форма=${m.form ? "ДА" : "-"} | баннер=${m.banner ? "ДА" : "-"} | влад.кнопки=${m.ownerBtn ? "ДА" : "-"} | диагноз=${m.diag ? "ДА" : "-"} | причина=${m.reason ? "ДА" : "-"}`

  // 1. Владелец → org → «Войти как водитель»
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForSelector("[data-login-panel] input#email", { timeout: 60000 })
  await page.fill("#email", "owner@local.test")
  await page.fill("#password", "Proverka123")
  await page.locator("#password").press("Enter")
  await page.waitForURL("**/owner", { timeout: 90000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 60000 })
  await page.locator("a[href^='/owner/org/']").first().click()
  await page.waitForURL(/\/owner\/org\//, { timeout: 60000 })
  await page.waitForSelector("text=Войти как водитель", { timeout: 60000 })
  await page.locator("button", { hasText: "Войти как водитель" }).first().evaluate((el) => el.click())
  await page.waitForURL(/\/m$/, { timeout: 60000 })
  await page.waitForSelector("text=Вы вошли как", { timeout: 60000 })
  await page.waitForTimeout(2000)
  console.log("до отзыва:", show(await markers(page)))

  // 2. Отзываем ВСЕ driver-сессии в БД (как «Вернуться» из другого окна)
  const revoked = await prisma.session.updateMany({
    where: { role: "driver" },
    data: { revokedAt: new Date(), revokeReason: "mini50b-test" },
  })
  console.log("отозвано driver-сессий:", revoked.count)
  netLog.length = 0

  // 3. Триггерим перепроверку (visibilitychange — как пробуждение телефона)
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })

  // 4. Наблюдаем 20 секунд
  const seen = []
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(500)
    const m = await markers(page)
    const line = show(m)
    if (seen.length === 0 || seen[seen.length - 1] !== line) seen.push(`${(i + 1) * 0.5}s ${line}`)
  }
  console.log("после отзыва — смена состояний:")
  seen.forEach((s) => console.log("  " + s))
  await page.screenshot({ path: "/home/user/work/mini50b-after-revoke.png" })
  console.log("скриншот: /home/user/work/mini50b-after-revoke.png")
  console.log("сеть после отзыва:")
  netLog.forEach((l) => console.log("  " + l))
} finally {
  await browser.close()
  await prisma.$disconnect()
}
