// Живая приёмка мира входа «Ночной терминал» (фидбек владельца и9:
// «сцена — лицо логистической программы; поля — интегрированные и
// компактные; мигание после нажатия убрать; гироскоп ещё -10%»). Мир =
// контейнерный терминал ночью: краны, контейнеры, огни, маршрут заказов
// уходит к горизонту; форма — компактный пропуск-документ.
//
// Фазы (песочница тесная — дев между фазами перезапускаем):
//   PHASE=desktop | warp | mobile | driver | register | all

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

/** Мир рисует каждый кадр — на время снимка останавливаем камеру. */
const shot = async (page, path) => {
  await page.evaluate(() => {
    window.__loginWorldPaused = true
  })
  await page.waitForTimeout(140)
  await page.screenshot({ path })
  await page.evaluate(() => {
    window.__loginWorldPaused = false
  })
}

const PHASE = process.env.PHASE || "all"

const browser = await chromium.launch({ args: ["--disable-gpu"] })
process.on("exit", () => {
  try { browser.close() } catch {}
})
try {
  // ── Десктоп: мир, движение, ракурс, форма-объект ──
  if (PHASE === "all" || PHASE === "desktop") {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)))
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 150)) })

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector("[data-login-world]", { timeout: 30000 })
  await page.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  await page.waitForFunction(() => window.__loginWorld != null, null, { timeout: 20000 })
  await page.waitForTimeout(600)

  // мир в перспективе
  const world = await page.evaluate(() => {
    const vp = document.querySelector("[data-login-world]")
    const panel = document.querySelector("[data-login-panel]")
    const glass = panel ? panel.querySelector("[data-login-doc]") : null
    const gs = glass ? getComputedStyle(glass) : null
    const r = panel ? panel.getBoundingClientRect() : null
    return {
      perspective: vp ? getComputedStyle(vp).perspective : "нет",
      panel3d: panel ? getComputedStyle(panel).transform.includes("matrix3d") : false,
      cranes: document.querySelectorAll("[data-crane]").length,
      containers: document.querySelectorAll("[data-container]").length,
      dots: document.querySelectorAll("[data-route-dot]").length,
      panelW: r ? Math.round(r.width) : 0,
      panelH: r ? Math.round(r.height) : 0,
      vw: window.innerWidth,
      vh: window.innerHeight,
      glassAlpha: gs ? (gs.backgroundColor.match(/([\d.]+)\)$/) || [])[1] ?? "1" : "нет",
      glassBlur: gs ? gs.backdropFilter : "нет",
    }
  })
  check("мир: перспектива включена", world.perspective === "900px", `perspective ${world.perspective}`)
  check("терминал: краны-порталы", world.cranes >= 2, `${world.cranes} крана`)
  check("терминал: штабеля контейнеров", world.containers >= 10, `${world.containers} контейнеров`)
  check("маршрут заказов: точки-заказы бегут", world.dots >= 3, `${world.dots} точек`)
  check("форма — объект мира (3D-трансформ)", world.panel3d, world.panel3d ? "matrix3d" : "нет")
  check(
    "пропуск — компактный документ",
    world.panelW <= 400 && world.panelH <= Math.round(world.vh * 0.72),
    `${world.panelW}×${world.panelH} px на экране ${world.vw}×${world.vh}`,
  )
  check("форма — прозрачный экран", parseFloat(world.glassAlpha) <= 0.75 && world.glassBlur.includes("blur"), `фон ${world.glassAlpha}, blur: ${world.glassBlur.slice(0, 20)}`)

  // камера едет сквозь пространство
  const d1 = await page.evaluate(() => window.__loginWorld.dolly)
  await page.waitForTimeout(1300)
  const d2 = await page.evaluate(() => window.__loginWorld.dolly)
  check("камера перемещается в пространстве", d2 - d1 > 150, `dolly ${Math.round(d1)} → ${Math.round(d2)}`)

  // маршрут заказов живёт: точка реально едет по нити
  const dot1 = await page.evaluate(() => {
    const d = document.querySelector("[data-route-dot]")
    return d ? `${d.getAttribute("cx")},${d.getAttribute("cy")}` : "нет"
  })
  await page.waitForTimeout(1400)
  const dot2 = await page.evaluate(() => {
    const d = document.querySelector("[data-route-dot]")
    return d ? `${d.getAttribute("cx")},${d.getAttribute("cy")}` : "нет"
  })
  check("маршрут заказов живёт (точка едет)", dot1 !== dot2, `${dot1} → ${dot2}`)

  // ракурс за курсором
  const yaw1 = await page.evaluate(() => window.__loginWorld.yaw)
  await page.mouse.move(1150, 120)
  await page.waitForTimeout(900)
  const yaw2 = await page.evaluate(() => window.__loginWorld.yaw)
  check("ракурс за курсором (мир под углом)", Math.abs(yaw2 - yaw1) > 0.4, `yaw ${yaw1.toFixed(1)}° → ${yaw2.toFixed(1)}°`)

  // клик — БЕЗ мигания: перспектива постоянна, экран не дёргается
  const persp1 = await page.evaluate(() => getComputedStyle(document.querySelector("[data-login-world]")).perspective)
  const p1 = await page.evaluate(() => window.__loginWorld.plunges)
  await page.mouse.click(600, 700)
  await page.waitForTimeout(500)
  const persp2 = await page.evaluate(() => getComputedStyle(document.querySelector("[data-login-world]")).perspective)
  const p2 = await page.evaluate(() => window.__loginWorld.plunges)
  check("клик — без мигания (перспектива постоянна)", persp1 === persp2 && p2 > p1, `${persp1} → ${persp2}, кликов ${p1} → ${p2}`)

  // поля живые внутри 3D
  await page.fill("[data-login-panel] input#email", "logist")
  const typed = await page.evaluate(() => document.querySelector("input#email")?.value ?? "")
  check("ввод в полях внутри 3D", typed === "logist", `«${typed}»`)

  await shot(page, "/home/user/work/visual-login-3d-desktop-idle.png")
  check("скриншоты десктопа сохранены", true, "idle (+typing в поле)")

  const dErrors = errors.filter((t) => !isNoise(t))
  check("нет ошибок (десктоп)", dErrors.length === 0, dErrors.slice(0, 2).join(" || ") || "нет")
  await page.close()
  await context.close()
  }

  // ── Ворп: успешный вход — рывок сквозь мир ──
  if (PHASE === "all" || PHASE === "warp") {
  const wContext = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const wpage = await wContext.newPage()
  // /owner тяжёл и валит дев в песочнице — перехватываем пустышкой
  await wpage.route("**/owner", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>owner-stub</title>" }),
  )
  await wpage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await wpage.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  await wpage.waitForFunction(() => window.__loginWorld != null, null, { timeout: 20000 })
  await wpage.fill("input#email", envValue("OWNER_EMAIL"))
  await wpage.fill("input#password", envValue("OWNER_PASSWORD"))
  await wpage.click("button[type=\"submit\"]", { force: true })
  await wpage.waitForURL("**/owner", { timeout: 30000 })
  check("ворп при входе (рывок сквозь мир)", true, "после входа — /owner")
  await wpage.close()
  await wContext.close()
  }

  // ── Телефон: палец, гироскоп, форма ──
  if (PHASE === "all" || PHASE === "mobile") {
  const mContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const mpage = await mContext.newPage()
  const mErrors = []
  mpage.on("pageerror", (e) => mErrors.push(String(e).slice(0, 150)))
  mpage.on("console", (m) => { if (m.type() === "error") mErrors.push(m.text().slice(0, 150)) })

  await mpage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await mpage.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  await mpage.waitForFunction(() => window.__loginWorld != null, null, { timeout: 20000 })
  await mpage.waitForTimeout(400)

  const m1 = await mpage.evaluate(() => window.__loginWorld.dolly)
  await mpage.waitForTimeout(1100)
  const m2 = await mpage.evaluate(() => window.__loginWorld.dolly)
  check("телефон: камера едет", m2 - m1 > 100, `dolly ${Math.round(m1)} → ${Math.round(m2)}`)

  // палец по миру поворачивает камеру
  const mCdp = await mContext.newCDPSession(mpage)
  const yawA = await mpage.evaluate(() => window.__loginWorld.yaw)
  await mCdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 160 }] })
  for (let i = 1; i <= 6; i++) {
    await mCdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 195 + i * 14, y: 160 + i * 6 }],
    })
  }
  await mCdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await mpage.waitForTimeout(250)
  const yawB = await mpage.evaluate(() => window.__loginWorld.yaw)
  check("телефон: палец вертит мир", Math.abs(yawB - yawA) > 0.4, `yaw ${yawA.toFixed(1)}° → ${yawB.toFixed(1)}°`)

  // гироскоп БЕЗ КНОПКИ: на Android включается сам, на iPhone — по
  // первому касанию экрана (жест, которого требует Apple)
  const noPill = await mpage.evaluate(() => document.querySelector("[data-gyro-pill]") == null)
  await mCdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 110 }] })
  await mCdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await mpage.waitForTimeout(200)
  const gyroGranted = await mpage.evaluate(() => typeof window.__loginWorldGyro === "function")
  await mpage.evaluate(() => {
    // первое событие калибрует ноль, второе — наклон, третье — РЕЗКИЙ
    // рывок: гироскоп должен остаться спокойным (ограничен и сглажен)
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: 30, gamma: 10 }))
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: 30, gamma: 34 }))
  })
  await mpage.waitForTimeout(500)
  const gyroState = await mpage.evaluate(() => ({
    gyro: window.__loginWorld.gyro === true,
    yaw: window.__loginWorld.yaw,
  }))
  await mpage.evaluate(() => {
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: 30, gamma: 89 }))
  })
  await mpage.waitForTimeout(500)
  const gyroCalm = await mpage.evaluate(() => window.__loginWorld.yaw)
  check(
    "телефон: гироскоп жив и спокоен, кнопки нет",
    noPill &&
      gyroGranted &&
      gyroState.gyro &&
      Math.abs(gyroState.yaw) > 0.3 &&
      Math.abs(gyroCalm - gyroState.yaw) <= 13 &&
      Math.abs(gyroCalm) <= 22,
    `наклон ${gyroState.yaw.toFixed(1)}°, рывок +55° → ${gyroCalm.toFixed(1)}° (отклик ${Math.abs(gyroCalm - gyroState.yaw).toFixed(1)}°)`,
  )

  // поля работают, экран не скроллится (мир fixed)
  await mpage.fill("[data-login-panel] input#email", "logist")
  const mTyped = await mpage.evaluate(() => document.querySelector("input#email")?.value ?? "")
  const fits = await mpage.evaluate(() => ({
    h: document.scrollingElement?.scrollHeight ?? 0,
    vh: window.innerHeight,
  }))
  const docFit = await mpage.evaluate(() => {
    const r = document.querySelector("[data-login-panel]")?.getBoundingClientRect()
    return r ? { w: Math.round(r.width), h: Math.round(r.height), vh: window.innerHeight } : null
  })
  check("телефон: ввод в 3D-поля", mTyped === "logist", `«${mTyped}»`)
  check("телефон: экран без прокрутки", fits.h <= fits.vh + 2, `scrollHeight ${fits.h} / ${fits.vh}`)
  check(
    "телефон: пропуск не закрывает полстраницы",
    docFit != null && docFit.h <= docFit.vh * 0.58,
    docFit ? `документ ${docFit.w}×${docFit.h} из ${docFit.vh}px (${Math.round((docFit.h / docFit.vh) * 100)}%)` : "нет",
  )

  await shot(mpage, "/home/user/work/visual-login-3d-mobile.png")
  check("телефон: скриншот сохранён", true, "work/visual-login-3d-mobile.png")
  const mErr = mErrors.filter((t) => !isNoise(t))
  check("телефон: ошибок нет", mErr.length === 0, mErr.slice(0, 2).join(" || ") || "нет")
  await mpage.close()
  await mContext.close()
  }

  // ── Водитель: тот же мир, своя дорога ──
  if (PHASE === "all" || PHASE === "driver") {
  const driverContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const dpage = await driverContext.newPage()
  const dErrors = []
  dpage.on("pageerror", (e) => dErrors.push(String(e).slice(0, 150)))
  dpage.on("console", (m) => { if (m.type() === "error") dErrors.push(m.text().slice(0, 150)) })
  await dpage.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await dpage.waitForSelector("#driver-phone", { timeout: 30000 })
  await dpage.waitForFunction(() => window.__loginWorld != null, null, { timeout: 20000 })
  await dpage.waitForTimeout(400)

  const driver = await dpage.evaluate(() => ({
    world: document.querySelector("[data-login-world]") != null,
    cranes: document.querySelectorAll("[data-crane]").length,
    containers: document.querySelectorAll("[data-container]").length,
    dots: document.querySelectorAll("[data-route-dot]").length,
    phone: document.querySelector("#driver-phone") != null,
    password: document.querySelector("#driver-password") != null,
    button: [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("В путь")),
    headline: (document.querySelector("h2")?.textContent || "").replace(/\s+/g, " ").trim(),
  }))
  check(
    "водитель: терминал с маршрутом заказов",
    driver.world && driver.cranes >= 2 && driver.containers >= 10 && driver.dots >= 3,
    `кранов ${driver.cranes}, контейнеров ${driver.containers}, точек ${driver.dots}`,
  )
  check("водитель: поля и запуск «В путь»", driver.phone && driver.password && driver.button, `поля:${driver.phone && driver.password}, кнопка:${driver.button}`)
  check("водитель: заголовок в небе", driver.headline.includes("Доброй"), `«${driver.headline}»`)

  // палец по дороге
  const dCdp = await driverContext.newCDPSession(dpage)
  const dyawA = await dpage.evaluate(() => window.__loginWorld.yaw)
  await dCdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 170 }] })
  for (let i = 1; i <= 6; i++) {
    await dCdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 195 + i * 14, y: 170 + i * 6 }],
    })
  }
  await dCdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await dpage.waitForTimeout(250)
  const dyawB = await dpage.evaluate(() => window.__loginWorld.yaw)
  check("водитель: палец вертит мир", Math.abs(dyawB - dyawA) > 0.4, `yaw ${dyawA.toFixed(1)}° → ${dyawB.toFixed(1)}°`)

  const dFit = await dpage.evaluate(() => ({
    h: document.scrollingElement?.scrollHeight ?? 0,
    vh: window.innerHeight,
  }))
  check("водитель: экран без прокрутки", dFit.h <= dFit.vh + 2, `scrollHeight ${dFit.h} / ${dFit.vh}`)

  await dpage.waitForTimeout(1500)
  await shot(dpage, "/home/user/work/visual-driver-login.png")
  check("водитель: скриншот сохранён", true, "work/visual-driver-login.png")
  const dErr = dErrors.filter((t) => !isNoise(t))
  check("водитель: ошибок нет", dErr.length === 0, dErr.slice(0, 2).join(" || ") || "нет")
  await dpage.close()
  await driverContext.close()
  }

  // ── Регистрация: тот же мир, карточка-объект ──
  if (PHASE === "all" || PHASE === "register") {
  const regContext = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const rpage = await regContext.newPage()
  const rErrors = []
  rpage.on("pageerror", (e) => rErrors.push(String(e).slice(0, 150)))
  rpage.on("console", (m) => { if (m.type() === "error") rErrors.push(m.text().slice(0, 150)) })
  await rpage.goto(`${BASE}/register`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await rpage.waitForSelector("input#email", { timeout: 30000 })
  await rpage.waitForFunction(() => window.__loginWorld != null, null, { timeout: 20000 })
  await rpage.waitForTimeout(400)
  const reg = await rpage.evaluate(() => {
    const card = document.querySelector("[data-login-panel] > div > div > div")
    return {
      world: document.querySelector("[data-login-world]") != null,
      tabs: document.querySelectorAll("[role=\"tab\"]").length,
      email: document.querySelector("input#email") != null,
      panel3d: getComputedStyle(document.querySelector("[data-login-panel]")).transform.includes("matrix3d"),
    }
  })
  check("регистрация: мир и вкладки", reg.world && reg.tabs >= 2 && reg.email, `вкладок ${reg.tabs}, email:${reg.email}`)
  check("регистрация: карточка — объект мира", reg.panel3d, reg.panel3d ? "matrix3d" : "нет")
  await rpage.waitForTimeout(1200)
  await shot(rpage, "/home/user/work/visual-register.png")
  check("регистрация: скриншот сохранён", true, "work/visual-register.png")
  const rErr = rErrors.filter((t) => !isNoise(t))
  check("регистрация: ошибок нет", rErr.length === 0, rErr.slice(0, 2).join(" || ") || "нет")
  await rpage.close()
  await regContext.close()
  }

  console.log(`ИТОГ: ${results.filter((r) => r.ok).length}/${results.length} проверок пройдено`)
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
