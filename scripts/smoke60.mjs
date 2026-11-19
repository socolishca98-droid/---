// Дым и60: все страницы владельца рендерятся с новым пунктом навигации
import { chromium } from "playwright"
const BASE = "http://localhost:3100"
let failures = 0
const check = (n, ok, i = "") => { console.log(`${ok ? "PASS" : "FAIL"} | ${n}${i ? " | " + i : ""}`); if (!ok) failures++ }
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const csrf = await (await page.request.get(`${BASE}/api/auth/csrf`)).json()
const login = await page.request.post(`${BASE}/api/auth/login`, {
  headers: { "x-csrf-token": csrf.csrfToken },
  data: { email: "owner@local.test", password: "Proverka123" },
})
check("вход владельца", login.ok(), `статус ${login.status()}`)
for (const step of [
  { url: "/owner", text: "Компании на платформе", name: "панель: компании" },
  { url: "/owner/journal", text: "Журнал действий", name: "панель: журнал" },
  { url: "/owner/dev", text: "Кабинет разработчика", name: "панель: разработчику" },
]) {
  try {
    await page.goto(BASE + step.url, { waitUntil: "domcontentloaded", timeout: 90000 })
    await page.waitForSelector(`text=${step.text}`, { timeout: 45000 })
    const nav = await page.locator("a[href='/owner/dev']").count()
    check(`${step.name} (+ пункт навигации)`, nav > 0, page.url())
  } catch (e) {
    check(step.name, false, String(e).slice(0, 120))
  }
}
try {
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 90000 })
  await page.waitForSelector("a[href^='/owner/org/']", { timeout: 45000 })
  await page.click("a[href^='/owner/org/']")
  await page.waitForSelector("button:has-text('Войти как водитель')", { timeout: 45000 })
  check("страница компании: «Войти как водитель» на месте", true, page.url())
} catch (e) {
  check("страница компании", false, String(e).slice(0, 120))
}
await browser.close().catch(() => {})
console.log(`\nИТОГ smoke60: ${failures ? `ПРОВАЛОВ: ${failures}` : "ВСЁ ЗЕЛЁНОЕ"}`)
process.exit(failures ? 1 : 0)
