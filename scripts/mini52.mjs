// mini52: «окаменевший экран» — щит воскрешения + пульс кабинета.
//
// Жалобы 13–15.11: сервер по журналу отдавал кабинет, а владелец видел
// старый экран входа без единого запроса к серверу — телефон замораживает
// вкладку, краска остаётся, JavaScript наполовину мёртв. и52 ставит два
// механизма:
//   1. ЩИТ (корневой layout, все страницы): долго скрытая вкладка при
//      возврате полностью перезагружается — сервер сам решает, что показать.
//   2. ПУЛЬС (кабинет /m): раз в минуту видимая страница тихо спрашивает
//      сессию; 200 — беззвучно (плюс метка в журнале раз в 15 минут),
//      401/403 — полный перезапуск.
// Проверяем: (а) пульс бьётся и оставляет метку в журнале; (б) второй
// пульс журналом НЕ засоряется; (в) щит перезагружает «вернувшуюся»
// вкладку; (г) после перезагрузки — снова кабинет (сессия жива).
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
  const page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 150)))
  const beats = []
  page.on("request", (r) => {
    const u = r.url()
    if (u.includes("beat=1")) beats.push(u.includes("mark=1") ? "mark" : "quiet")
  })

  // Вход владельца → «Войти как водитель» → кабинет
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.waitForSelector("[data-login-panel] input#email", { timeout: 60000 })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.fill("#email", "owner@local.test")
    await page.fill("#password", "Proverka123")
    await page.waitForTimeout(1500)
    const email = await page.inputValue("#email").catch(() => "")
    if (email === "owner@local.test") break
  }
  await page.locator("#password").press("Enter")
  await page.waitForURL("**/owner", { timeout: 120000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 60000 })
  await page.locator("a[href^='/owner/org/']").first().click()
  await page.waitForURL(/\/owner\/org\//, { timeout: 60000 })
  await page.waitForSelector("text=Войти как водитель", { timeout: 60000 })
  await page.locator("button", { hasText: "Войти как водитель" }).first().evaluate((el) => el.click())
  await page.waitForURL((u) => new URL(u).pathname === "/m", { timeout: 60000 })
  await page.waitForSelector("text=Вы вошли как", { timeout: 60000 })
  check("вход как водитель — кабинет /m", true, page.url())

  // (а)+(б) Пульс: первый удар через 60с с меткой, второй через 120с — тихий
  console.log("… жду пульс: 70с (первый удар, должен быть с mark) …")
  await page.waitForTimeout(70_000)
  console.log("… жду второй удар: +65с (должен быть тихим) …")
  await page.waitForTimeout(65_000)
  check(
    "пульс бьётся: ≥2 удара, первый с меткой журнала",
    beats.length >= 2 && beats[0] === "mark",
    `удары: [${beats.join(", ")}]`,
  )
  const quiet = beats.slice(1).filter((b) => b === "quiet").length
  check("тихие пульсы не несут метку (журнал чист)", quiet >= 1, `тихих: ${quiet}`)

  // (в) Щит: эмулируем «вкладку скрыли на часы и вернулись» —
  // прячем (реальные часы), сдвигаем часы, показываем: разница > 2 минут
  // должна заставить щит перезагрузить страницу
  await page.evaluate(() => {
    window.__mini52BeforeReload = "alive"
    const realNow = Date.now.bind(Date)
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    document.dispatchEvent(new Event("visibilitychange")) // щит запомнил время (реальное)
    Date.now = () => realNow() + 10 * 60 * 1000 // «пролетело» 10 минут
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    })
    document.dispatchEvent(new Event("visibilitychange")) // возврат: разница 10 минут > 2
    Date.now = realNow
  })
  await page.waitForTimeout(4000)
  const survived = await page.evaluate(() => window.__mini52BeforeReload ?? null).catch(() => null)
  check("щит перезагрузил «вернувшуюся» вкладку", survived === null, `память старой страницы: ${survived}`)

  // (г) После перезагрузки — снова кабинет (сессия жива, владелец при ней)
  await page.waitForSelector("text=Вы вошли как", { timeout: 60000 })
  check("после воскрешения — снова кабинет с баннером", true, page.url())

  check("ошибок страницы нет", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "чисто")
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ mini52: ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
