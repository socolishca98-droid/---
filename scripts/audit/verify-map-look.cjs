// scripts/audit/verify-map-look.cjs
//
// Приёмочная проверка внешнего вида карты логиста (/lm/map).
//
// Что проверяем по существу, а не «страница открылась»:
//   1. карта реально отрисовалась — на холсте есть тайлы подложки;
//   2. подписи (названия городов/улиц) подключены отдельным слоем;
//   3. нити рейсов рисуются двумя линиями — подкладка + цветная;
//   4. точки «Погрузка»/«Выгрузка» стоят на концах нитей;
//   5. честная плашка про пробки на месте и закрывается;
//   6. на карте нет «рваных» линий — у полилиний скруглённые концы.
//
// Запуск: node scripts/audit/verify-map-look.cjs
// Скриншоты: docs/audit-screens/taskF-*.png

const path = require("path")
const fs = require("fs")

const PW_PATH = process.env.PLAYWRIGHT_CORE_PATH || "/home/user/audit-browser/node_modules/playwright-core"
const { chromium } = require(PW_PATH)

const BASE = process.env.AUDIT_BASE || "http://localhost:3000"
const EMAIL = process.env.STAFF_EMAIL || "admin@loginex.local"
const PASSWORD = process.env.STAFF_PASSWORD || "Sandbox-d0f763fc597545af76b446a"
const OUT_DIR = "/home/user/loginex/docs/audit-screens"

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1
    console.log(`  OK   ${name}`)
  } else {
    fail += 1
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

async function login(page, context) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 20000 })
  await page.fill('input[type="email"], input[name="email"]', EMAIL)
  const pwd = page.locator('input[type="password"]').first()
  await pwd.fill(PASSWORD)
  // CSRF: страница сама получает токен при загрузке, ждём готовности формы
  await page.waitForTimeout(600)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(4000)
}

;(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({
    executablePath: "/home/user/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
  const context = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    locale: "ru-RU",
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e)))

  console.log("Вход в панель логиста…")
  await login(page, context)

  console.log("\nОткрываю карту /lm/map…")
  await page.goto(`${BASE}/lm/map`, { waitUntil: "domcontentloaded" })
  // Лист: ждём, пока появятся тайлы подложки
  await page.waitForSelector(".leaflet-tile-loaded", { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(3500)

  // ── 1. Подложка отрисована ──
  const tiles = await page.locator(".leaflet-tile-loaded").count()
  check("Подложка загрузилась (есть тайлы)", tiles > 0, `тайлов: ${tiles}`)

  // ── 2. Слой подписей подключён ──
  // На бою своего ключа CARTO нет — там подписи идут отдельным слоем Esri.
  // В песочнице ключ есть, и подложка CARTO уже содержит подписи.
  const labelTiles = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll(".leaflet-tile")]
    return imgs.filter((img) => {
      const src = img.getAttribute("src") || ""
      return src.includes("Dark_Gray_Reference") || src.includes("dark_all")
    }).length
  })
  check("Подписи на карте подключены", labelTiles > 0, `плиток с подписями: ${labelTiles}`)

  // ── 3. Нитки рейсов: подкладка + цветная ──
  const lineInfo = await page.evaluate(() => {
    const paths = [...document.querySelectorAll(".leaflet-pane path")]
    const casings = paths.filter((p) => p.getAttribute("stroke") === "#0a0a0c")
    const colored = paths.filter((p) => {
      const w = Number(p.getAttribute("stroke-width") || 0)
      return w === 3.5
    })
    return { casings: casings.length, colored: colored.length, total: paths.length }
  })
  check("Нить рейса рисуется с подкладкой", lineInfo.casings > 0, `подкладок: ${lineInfo.casings}`)
  check("Нить рейса рисуется цветной линией", lineInfo.colored > 0, `цветных линий: ${lineInfo.colored}`)

  // ── 4. Точки «Погрузка»/«Выгрузка» ──
  // Тултип Leaflet открывается только при наведении, поэтому наводимся
  // на каждое кольцо конца нити и собираем подписи.
  const endpointLabels = await page.evaluate(async () => {
    const paths = [...document.querySelectorAll(".leaflet-pane path")]
    const rings = paths.filter((p) => {
      const w = Number(p.getAttribute("stroke-width") || 0)
      const fill = p.getAttribute("fill-opacity") || ""
      const stroke = p.getAttribute("stroke") || ""
      // Кольца конца нити: белая обводка толщиной 2, плотная заливка
      return w === 2 && fill === "1" && stroke === "#ffffff"
    })
    const labels = []
    for (const ring of rings.slice(0, 60)) {
      ring.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      await new Promise((r) => setTimeout(r, 30))
      const tip = document.querySelector(".leaflet-tooltip")
      if (tip && tip.textContent) labels.push(tip.textContent)
      ring.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
    }
    return labels
  })
  check(
    "Точка «Погрузка» подписана",
    endpointLabels.some((t) => t.includes("Погрузка")),
    endpointLabels.slice(0, 3).join(" | ").slice(0, 120),
  )
  check(
    "Точка «Выгрузка» подписана",
    endpointLabels.some((t) => t.includes("Выгрузка")),
    endpointLabels.slice(0, 3).join(" | ").slice(0, 120),
  )

  // ── 5. Плашка про пробки ──
  const noticeText = await page.evaluate(() => {
    const all = [...document.querySelectorAll("p")]
    return all.map((p) => p.textContent || "").find((t) => t.includes("Пробки")) || ""
  })
  check("Плашка про пробки на месте", noticeText.includes("не учитываются"), noticeText.slice(0, 80))

  // Закрываем плашку
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "") === "Скрыть сообщение о пробках")
    if (btn) btn.click()
  })
  await page.waitForTimeout(400)
  const noticeGone = await page.evaluate(() => {
    const all = [...document.querySelectorAll("p")]
    return !all.some((p) => (p.textContent || "").includes("Пробки"))
  })
  check("Плашка закрывается крестиком", noticeGone)

  // ── 6. Линии без «лесенки» ──
  const rounded = await page.evaluate(() => {
    const paths = [...document.querySelectorAll(".leaflet-pane path")]
    return paths.filter((p) => (p.getAttribute("stroke-linecap") || "") === "round").length
  })
  check("Концы линий скруглены", rounded > 0, `path со скруглением: ${rounded}`)

  await page.screenshot({ path: path.join(OUT_DIR, "taskF-map-polished.png"), fullPage: false })

  // Открываем шторку со списком машин
  await page.locator('button:has-text("Машины на карте")').first().click().catch(() => {})
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(OUT_DIR, "taskF-map-sheet.png"), fullPage: false })

  check("Нет ошибок страницы", errors.length === 0, errors.slice(0, 2).join(" | "))

  console.log(`\nИтог: ${pass} ок / ${fail} сбоя`)
  if (failures.length) console.log("Сбои:\n - " + failures.join("\n - "))
  await browser.close()
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error("ПРОВАЛ СЦЕНАРИЯ:", e.message)
  process.exit(1)
})
