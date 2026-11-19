// mini60 — приёмочные проверки и60 «Кабинет разработчика».
//
// Просьба владельца: «всё, что брал для аналитики, организуй мне в кабинет
// разработчика». Проверяем, что инструменты разбора жалоб №7–№12 теперь
// живут ВНУТРИ программы:
//
//   1) анониму закрыто: /api/admin/dev → 401, /owner/dev → редирект на вход;
//   2) владелец видит раздел «Разработчику» в навигации панели;
//   3) сводка: метка сборки, Node, живые сессии;
//   4) хроника входов показывает события с РАСКРЫТЫМИ метаданными датчиков
//      (diag_m_layout: сессия водителя, устройство, путь);
//   5) живые сессии: таблица непуста, id — только префиксы;
//   6) рецепты: мини-сценарии, прод-проверки, SQL, OCR.
// Запуск: node scripts/mini60.mjs  (BASE=http://localhost:3100, дев поднят)

import { chromium } from "playwright"

const BASE = process.env.BASE || "http://localhost:3100"
const EMAIL = process.env.E2E_EMAIL || "owner@local.test"
const PASSWORD = process.env.E2E_PASSWORD || "Proverka123"

let failures = 0
const check = (name, ok, info = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${info ? " | " + info : ""}`)
  if (!ok) failures++
}

const browser = await chromium.launch()

// ── 1. Аноним: кабинет разработчика закрыт ───────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  try {
    const api = await page.request.get(`${BASE}/api/admin/dev?hours=24`)
    check("аноним: /api/admin/dev → 401", api.status() === 401, `статус ${api.status()}`)

    await page.goto(`${BASE}/owner/dev`, { waitUntil: "domcontentloaded", timeout: 60000 })
    const anonRedirected = /\/login/.test(page.url())
    check("аноним: /owner/dev уводит на вход", anonRedirected, page.url())
  } catch (e) {
    check("анонимные проверки дошли до конца", false, String(e).slice(0, 160))
  }
  await context.close().catch(() => {})
}

// ── 2. Датчик прогревается: анонимный заход на /m/login пишет diag_m_layout
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  try {
    await page.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForTimeout(1500)
    check("датчик прогрет: /m/login открыт анонимно", /\/m\/login/.test(page.url()))
  } catch (e) {
    check("прогрев датчика дошёл до конца", false, String(e).slice(0, 160))
  }
  await context.close().catch(() => {})
}

// ── 3. Владелец: раздел «Разработчику» и его содержимое ──────────────────
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  try {
    // Вход — программно (CSRF + POST /api/auth/login): форма входа — «плита»
    // в 3D-мире, под нагрузкой она перемонтируется и гонит UI-автоматизацию
    // по кругу (поля очищаются, press виснет). Сама форма закрыта мини 59;
    // здесь проверяем КАБИНЕТ РАЗРАБОТЧИКА, а не вход.
    const csrf = await (await page.request.get(`${BASE}/api/auth/csrf`)).json()
    const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
      headers: { "x-csrf-token": csrf.csrfToken },
      data: { email: EMAIL, password: PASSWORD },
    })
    check("вход владельца (API)", loginRes.ok(), `статус ${loginRes.status()}`)
    await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForSelector("text=Компании на платформе", { timeout: 60000 })

    const navLink = page.locator("a[href='/owner/dev']")
    check("навигация панели: пункт «Разработчику»", (await navLink.count()) > 0)
    // В деве первый переход на маршрут ждёт холодной компиляции (Next Link
    // молчит, пока чанк собирается) — открываем напрямую, с запасом времени
    await page.goto(`${BASE}/owner/dev`, { waitUntil: "domcontentloaded", timeout: 90000 })
    await page.waitForURL(/\/owner\/dev/, { timeout: 30000 })
    await page.waitForSelector("text=Кабинет разработчика", { timeout: 60000 })

    // Сводка: метка сборки — из самого API (текст плитки анимируется)
    await page.waitForTimeout(2500)
    const health = await (await page.request.get(`${BASE}/api/admin/dev?hours=24`)).json()
    const body = await page.evaluate(() => document.body.innerText)
    check(
      "сводка: API жив (сборка, аптайм, счётчики)",
      typeof health.build === "string" &&
        health.build.length > 0 &&
        typeof health.uptimeSec === "number" &&
        health.counts?.liveSessions >= 1,
      JSON.stringify({ build: health.build, live: health.counts?.liveSessions }),
    )
    check("сводка: Node и серверное время", body.includes("Node v"))
    check("сводка: живые сессии (плитка)", body.includes("Живые сессии"))

    // Хроника: ищем событие датчика из шага 2
    await page.fill("input[placeholder*='Поиск']", "diag_m_layout")
    await page.waitForTimeout(700)
    const chronicle = await page.evaluate(() => document.body.innerText)
    check(
      "хроника: датчик diag_m_layout с метаданными",
      chronicle.includes("Датчик: запрос кабинета /m") &&
        chronicle.includes("Сессия водителя") &&
        chronicle.includes("Устройство") &&
        chronicle.includes("/m/login"),
    )

    // Хроника: наш вход по паролю
    await page.fill("input[placeholder*='Поиск']", EMAIL)
    await page.waitForTimeout(700)
    const loginSeen = await page.evaluate(() => document.body.innerText)
    check("хроника: вход владельца по паролю", loginSeen.includes("Вход") && loginSeen.includes("login"))

    // Живые сессии: таблица непуста, только префиксы
    const sessions = await page.evaluate(() => {
      const txt = document.body.innerText
      return {
        panel: txt.includes("Живые сессии:"),
        prefix: /…/.test(txt),
        ownerRow: txt.includes("owner@local.test"),
      }
    })
    check("сессии: таблица жива, префиксы вместо полных id", sessions.panel && sessions.prefix)
    check("сессия владельца в таблице", sessions.ownerRow)

    // Обновление не ломает страницу (force: под нагрузкой анимации мешают
    // actionability-проверкам клика)
    await page.click("button:has-text('Обновить')", { force: true, timeout: 15000 })
    await page.waitForTimeout(1500)
    const afterReload = await page.evaluate(() => document.body.innerText)
    check("кнопка «Обновить» жива", afterReload.includes("Кабинет разработчика"))

    // Рецепты
    const recipes = await page.evaluate(() => document.body.innerText)
    check(
      "рецепты: мини-сценарии, SQL, OCR",
      recipes.includes("mini59") && recipes.includes("AuditLog") && recipes.includes("tesseract"),
    )
    check("рецепты: прод-проверки (307 с /m)", recipes.includes("curl -sI"))
  } catch (e) {
    check("сценарий владельца дошёл до конца", false, String(e).slice(0, 200))
  }
  await context.close().catch(() => {})
}

await browser.close().catch(() => {})
console.log(`\nИТОГ mini60: ${failures ? `ПРОВАЛОВ: ${failures}` : "ВСЁ ЗЕЛЁНОЕ"}`)
process.exit(failures ? 1 : 0)
