// Живая приёмка кинематографичного 3D-входа (задача владельца: «очень
// крутой 3Д вход со сменой угла обзора, проваливание при каждом клике,
// информация о программе на странице»). БЕЗ reducedMotion — иначе отклик
// выключен; страница входа лёгкая, песочнице это по силам.
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://localhost:3100"

function envValue(key) {
  const match = readFileSync("/home/user/loginex/.env", "utf-8")
    .split("\n")
    .find((line) => line.startsWith(`${key}=`))
  return match ? match.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : ""
}

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "OK  " : "FAIL"} | ${name} | ${detail}`)
}
const isNoise = (t) =>
  t.includes("favicon") || t.includes("caret-color") || t.includes("401")

const browser = await chromium.launch({ args: ["--disable-gpu"] })
process.on("exit", () => {
  try { browser.close() } catch {}
})
try {
  // ── Десктоп: сцена, угол обзора, проваливание, витрина ──
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)))
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)) })

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector("form", { timeout: 30000 })
  await page.waitForFunction(() => window.__loginScene != null, null, { timeout: 20000 })
  check("экран входа открыт", true)

  const canvas = await page.evaluate(() => {
    const c = document.querySelector("canvas[data-login-scene]")
    return c ? { w: c.clientWidth, h: c.clientHeight } : null
  })
  check("3D-сцена (канвас коридора)", canvas != null && canvas.w === 1200, JSON.stringify(canvas))

  const tilt = await page.evaluate(() => document.querySelector('[data-tilt="login-card"]') != null)
  check("3D-наклон карточки за курсором", tilt)

  // смена угла обзора: ведём мышь влево-вверх — камера поворачивается
  await page.mouse.move(250, 200)
  await page.waitForTimeout(900)
  const yaw1 = await page.evaluate(() => window.__loginScene?.yaw ?? 0)
  await page.mouse.move(950, 620)
  await page.waitForTimeout(900)
  const yaw2 = await page.evaluate(() => window.__loginScene?.yaw ?? 0)
  const pitch2 = await page.evaluate(() => window.__loginScene?.pitch ?? 0)
  check(
    "смена угла обзора за курсором",
    Math.abs(yaw2 - yaw1) > 0.05,
    `yaw ${yaw1.toFixed(3)} → ${yaw2.toFixed(3)}, pitch ${pitch2.toFixed(3)}`,
  )

  // проваливание: каждый клик — рывок скорости
  const before = await page.evaluate(() => window.__loginScene.plunges)
  await page.mouse.click(600, 400)
  await page.waitForTimeout(120)
  const plunge1 = await page.evaluate(() => ({ p: window.__loginScene.plunges, s: window.__loginScene.speed }))
  await page.screenshot({ path: "/home/user/work/visual-login-3d-plunge.png" })
  check(
    "проваливание при клике (рывок)",
    plunge1.p === before + 1 && plunge1.s > 400,
    `кликов +1, скорость ${Math.round(plunge1.s)}`,
  )

  // витрина программы
  const chips = await page.evaluate(() => document.querySelectorAll("[data-login-info] > div").length)
  check("витрина модулей на странице", chips >= 6, `${chips} чипов`)

  // свечение рамки при фокусе
  await page.focus('input[type="email"], input[name="email"]')
  await page.waitForTimeout(400)
  const glow = await page.evaluate(() => {
    const card = document.querySelector(".login-card-glow")
    return card ? getComputedStyle(card).boxShadow : "none"
  })
  check("свечение рамки при фокусе", glow !== "none" && glow.length > 10, `${glow.slice(0, 36)}…`)

  // печать — энергия полёта
  await page.type('input[type="email"], input[name="email"]', "logist", { delay: 80 })
  const energy = await page.evaluate(() => window.__loginScene.energy)
  check("отклик на ввод (энергия полёта)", energy > 0.05, `energy ${energy.toFixed(2)}`)
  await page.screenshot({ path: "/home/user/work/visual-login-3d-typing.png" })
  await page.screenshot({ path: "/home/user/work/visual-login-3d.png" })
  check("скриншоты десктопа сохранены", true, "idle + печать + провал")

  const realErrors = errors.filter((t) => !isNoise(t))
  check("нет ошибок (десктоп)", realErrors.length === 0, realErrors.slice(0, 2).join(" || ") || "нет")
  await page.close()
  await context.close()

  // ── Ворп: реальный вход владельца = прыжок сквозь программу ──
  const warpContext = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const wpage = await warpContext.newPage()
  await wpage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await wpage.waitForSelector("form", { timeout: 30000 })
  await wpage.fill('input[type="email"], input[name="email"]', envValue("OWNER_EMAIL"))
  await wpage.fill('input[type="password"]', envValue("OWNER_PASSWORD"))
  await wpage.click('button[type="submit"]')
  await wpage.waitForFunction(() => (window.__loginScene?.warps ?? 0) >= 1, null, { timeout: 20000 })
  const warp = await wpage.evaluate(() => ({
    w: window.__loginScene?.warps ?? 0,
    s: window.__loginScene?.speed ?? 0,
  }))
  check("ворп при входе (прыжок сквозь программу)", warp.w >= 1 && warp.s > 3000, `warps ${warp.w}, скорость ${Math.round(warp.s)}`)
  await wpage.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {})
  check("после ворпа — внутри программы", !new URL(wpage.url()).pathname.startsWith("/login"), new URL(wpage.url()).pathname)
  await wpage.close()
  await warpContext.close()

  // ── Телефон ──
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const mpage = await mobileContext.newPage()
  const mErrors = []
  mpage.on("pageerror", (e) => mErrors.push(String(e).slice(0, 150)))
  mpage.on("console", (m) => { if (m.type() === "error") mErrors.push(m.text().slice(0, 150)) })
  await mpage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await mpage.waitForSelector("form", { timeout: 30000 })
  await mpage.waitForFunction(() => window.__loginScene != null, null, { timeout: 20000 })
  const mCanvas = await mpage.evaluate(() => {
    const c = document.querySelector("canvas[data-login-scene]")
    return c ? c.clientWidth : 0
  })
  check("телефон: сцена на весь экран", mCanvas === 390, `${mCanvas}px`)
  const mChips = await mpage.evaluate(() => document.querySelectorAll("[data-login-info] > div").length)
  check("телефон: витрина модулей", mChips >= 6, `${mChips} чипов`)
  // тап — тоже проваливание
  const mBefore = await mpage.evaluate(() => window.__loginScene.plunges)
  await mpage.touchscreen.tap(195, 700)
  await mpage.waitForTimeout(150)
  const mAfter = await mpage.evaluate(() => window.__loginScene.plunges)
  check("телефон: проваливание по тапу", mAfter === mBefore + 1, `${mBefore} → ${mAfter}`)
  await mpage.type('input[type="email"], input[name="email"]', "logist", { delay: 80 })
  await mpage.screenshot({ path: "/home/user/work/visual-login-3d-mobile.png" })
  check("телефон: скриншот сохранён", true, "work/visual-login-3d-mobile.png")
  check("телефон: ошибок нет", mErrors.filter((t) => !isNoise(t)).length === 0, mErrors.filter((t) => !isNoise(t)).slice(0, 2).join(" || ") || "нет")
  await mpage.close()
  await mobileContext.close()
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено`)
process.exit(failed.length > 0 ? 1 : 0)
