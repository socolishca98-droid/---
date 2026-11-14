// и46: браузерная проверка переключателей экранов входа.
// Владелец: «Войти как водитель» → окно авторизации → «войти как логист» → ошибка.
// Гипотеза: внутренние (SPA) переходы между экранами входа ломаются в старой
// вкладке; и46 превращает их в полные загрузки. Проверяем: клик по ссылкам
// «Вход для логиста» и «Вход в приложение водителя» грузит страницу целиком
// (маркер на window исчезает) и попадает на нужный экран без ошибок.
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://localhost:3100"
const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`)
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e)))

  // 1. Экран водителя → «Вход для логиста»
  await page.goto(`${BASE}/m/login`, { waitUntil: "load", timeout: 60000 })
  await page.waitForSelector("text=Вход для логиста", { timeout: 30000 })
  await page.evaluate(() => {
    window.__marker46 = "alive"
  })
  await page.locator("a", { hasText: "Вход для логиста" }).first().evaluate((el) => el.click())
  await page.waitForURL((u) => new URL(u).pathname === "/login", { timeout: 30000 })
  await page.waitForSelector("text=Вход в приложение водителя", { timeout: 30000 })
  const marker1 = await page.evaluate(() => window.__marker46)
  check(
    "«Вход для логиста» — полный переход на экран логиста (не SPA)",
    marker1 === undefined,
    `маркер после перехода: ${JSON.stringify(marker1)}; url=${page.url()}`,
  )

  // 2. Экран логиста → «Вход в приложение водителя»
  await page.evaluate(() => {
    window.__marker46 = "alive"
  })
  await page.locator("a", { hasText: "Вход в приложение водителя" }).first().evaluate((el) => el.click())
  await page.waitForURL((u) => new URL(u).pathname === "/m/login", { timeout: 30000 })
  await page.waitForSelector("text=Вход для логиста", { timeout: 30000 })
  const marker2 = await page.evaluate(() => window.__marker46)
  check(
    "«Вход в приложение водителя» — полный переход на экран водителя (не SPA)",
    marker2 === undefined,
    `маркер после перехода: ${JSON.stringify(marker2)}; url=${page.url()}`,
  )

  // 3. Ссылки — настоящие <a href> (полная загрузка), а не next/link
  const hrefs = await page.evaluate(() => {
    const links = [...document.querySelectorAll("a")]
    return links.filter((a) => /Вход для логиста/.test(a.textContent || "")).map((a) => a.getAttribute("href"))
  })
  check("ссылка «Вход для логиста» — обычный <a> с href=/login", hrefs[0] === "/login", JSON.stringify(hrefs))

  check("ошибок страницы нет", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "чисто")
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ и46: ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
