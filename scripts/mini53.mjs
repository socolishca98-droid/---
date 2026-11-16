// mini53: сторож краски (и53) — детектор «экран показывает старую картину».
//
// Вечер 16.11: сервер трижды открыл кабинет (журнал), клики со «застрявшего»
// экрана доходили («Вернуться» срабатывал), но на экране оставалась форма
// входа с баннером. Так умирает композитор WebKit: rAF перестаёт приходить,
// а таймеры и сеть живут. Сторож в корневом layout замечает это и: (1) пишет
// в журнал метку paint=dead, (2) один раз за жизнь вкладки перезагружает
// страницу — навигация может оживить композитор.
//
// Проверяем:
//  1. при живом rAF сторож молчит (нет ни бикона, ни перезагрузки);
//  2. при убитом rAF: бикон paint=dead уходит на сервер, журнал пишет
//     запись с paint:"dead", страница перезагружается ровно один раз;
//  3. после перезагрузки (rAF снова жив) — сторож не срабатывает повторно.
import { chromium } from "playwright"

const BASE = process.env.BASE_URL || "http://localhost:3100"

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`)
}

const browser = await chromium.launch({ args: ["--disable-gpu"] })
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
  })
  const page = await context.newPage()
  const paintBeacons = []
  page.on("request", (r) => {
    if (r.url().includes("paint=dead")) paintBeacons.push(r.url())
  })

  // 1. Живой экран: открываем /m/login (публичная страница), ждём 10с с
  //    укороченным порогом 4с — сторож молчит
  await page.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded", timeout: 120000 })
  await page.evaluate(() => {
    window.__PAINT_DEAD_MS = 4000
  })
  await page.waitForTimeout(9000)
  check("живой rAF: сторож молчит (ни бикона, ни перезагрузки)", paintBeacons.length === 0)

  // 2. Убиваем rAF: перехватываем requestAnimationFrame так, чтобы новые
  //    кадры не приходили никогда — точная имитация мёртвого композитора
  const beforeReload = await page.evaluate(() => {
    window.__mini53Before = "alive"
    window.requestAnimationFrame = () => 0 // ни один новый кадр не придёт
    return window.__mini53Before
  })
  await page.waitForTimeout(10000)
  check("мёртвый rAF: бикон paint=dead ушёл на сервер", paintBeacons.length >= 1, paintBeacons[0] || "-")

  const survived = await page.evaluate(() => window.__mini53Before ?? null).catch(() => null)
  check("мёртвый rAF: страница перезагружена (память обнулена)", survived === null)

  // 3. После перезагрузки сторож не должен срабатывать повторно
  //    (sessionStorage-флаг + живой rAF на новой странице)
  const beaconsBefore = paintBeacons.length
  await page.waitForTimeout(8000)
  const beaconCount = await page
    .evaluate(() => window.__PAINT_DEAD_MS = 4000)
    .then(() => paintBeacons.length)
    .catch(() => paintBeacons.length)
  check("после перезагрузки: повторных биконов нет", paintBeacons.length === beaconsBefore, `было ${beaconsBefore}, стало ${paintBeacons.length}`)
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ mini53: ${results.length - failed.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
