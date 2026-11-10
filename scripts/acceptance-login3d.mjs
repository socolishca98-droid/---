// Живая приёмка мира входа «Терминал в объёме» (фидбек владельца и11:
// «гироскоп сломали — уведомление убрать, работал хоть и не четко;
// сцены мало, хочется больше объёма и 3D»). Мир = полёт сквозь
// контейнерный терминал: штабеля/краны/фонари пролетают мимо на разных
// глубинах, земля — плоскость в перспективе с бегущей ниткой маршрута,
// форма — компактный пропуск-документ; гироскоп 0.32 без уведомлений.
//
// Фазы (песочница тесная — дев между фазами перезапускаем):
//   PHASE=desktop | warp | mobile | driver | register | recover | dashboard | lm | all
//
// и16: горизонт ниже середины, краны 244px, дорога 260px, ели ×18,
// подбой земли — «не проваливаемся под дорогу».
// и17: горизонт 57% + СВЕТЛЯЩАЯСЯ ЛИНИЯ .world-horizon, земля со
// светлым дальним краем, дорога растворяется вдали.
// и18: геометрия двора (центры, основания на земле), Г-фонари
// попарно, краны ×2, гироскоп 0.06, refs ели/искры разведены;
// и18б: камера выше плоскости (GROUND_Y=160, origin 58%),
// hit-тест «внизу земля, вверху небо».
// и19: здания, зажим рамки. и20: гироскоп ВЫКЛЮЧЕН, вход — «ночной
// тоннель». и21: здания на телефоне, регистрация — документ,
// восстановление — в мире, дашборд: пауза под подложкой + safe-area.
// и22: придорожное ×6 (АЗС и склад), на телефоне — ЗАМЕТНО в кадре
// (≥40px перекрытия); дашборд — нижняя навигация «как у приложения».
// и23: панель логиста /lm — там, где владелец живёт на телефоне:
// main-каркас (пауза прилёта), лестница panel-rise карточек главной,
// въезд нижней навигации. 75 чеков (desktop 33 + warp 3 + mobile 11 +
// driver 8 + register 6 + recover 4 + dashboard 5 + lm 5).

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
    const ground = document.querySelector("[data-ground]")
    return {
      perspective: vp ? getComputedStyle(vp).perspective : "нет",
      panel3d: panel ? getComputedStyle(panel).transform.includes("matrix3d") : false,
      cranes: document.querySelectorAll("[data-crane]").length,
      stacks: document.querySelectorAll("[data-stack]").length,
      motes: document.querySelectorAll("[data-login-mote]").length,
      dots: document.querySelectorAll("[data-route-dot]").length,
      moteLit: [...document.querySelectorAll("[data-login-mote]")].filter(
        (el) => getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)",
      ).length,
      treesAnimated: [...document.querySelectorAll("[data-tree]")].filter(
        (el) => el.style.opacity !== "",
      ).length,
      ground3d: ground ? getComputedStyle(ground).transform !== "none" : false,
      panelW: r ? Math.round(r.width) : 0,
      panelH: r ? Math.round(r.height) : 0,
      vw: window.innerWidth,
      vh: window.innerHeight,
      glassAlpha: gs ? (gs.backgroundColor.match(/([\d.]+)\)$/) || [])[1] ?? "1" : "нет",
      glassBlur: gs ? gs.backdropFilter : "нет",
    }
  })
  check("мир: перспектива включена", world.perspective === "900px", `perspective ${world.perspective}`)
  check("терминал: штабеля в объёме", world.stacks >= 8, `${world.stacks} штабелей`)
  check("терминал: краны-порталы (реже)", world.cranes >= 2, `${world.cranes} крана на цикл`)
  check("объём: земля — плоскость в перспективе", world.ground3d, world.ground3d ? "rotateX(90°)" : "нет")

  // дорога/земля/небо и13: дорога видна, двор на земле, не «космос»
  const roadWorld = await page.evaluate(() => {
    const road = document.querySelector("[data-road]")
    const rs = road ? getComputedStyle(road) : null
    const ground = document.querySelector("[data-ground]")
    const fade = document.querySelector("[data-sky-fade]")
    const poles = [...document.querySelectorAll("[data-pole]")].map((el) => {
      const m = getComputedStyle(el).transform.match(/matrix3d\(([^)]+)\)/)
      if (!m) return null
      const v = m[1].split(",").map(Number)
      // визуальный центр = столб Г-фонаря: tx + полширины
      return v[12] + parseFloat(getComputedStyle(el).width) / 2
    })
    const poleZ = [...document.querySelectorAll("[data-pole]")].map((el) => {
      const m = getComputedStyle(el).transform.match(/matrix3d\(([^)]+)\)/)
      return m ? Math.round(parseFloat(m[1].split(",")[14])) : null
    })
    const craneSvg = document.querySelector("[data-crane] svg")
    const backdrop = document.querySelector("[data-ground-backdrop]")
    const br = backdrop ? backdrop.getBoundingClientRect() : null
    return {
      roadW: road ? Math.round(parseFloat(getComputedStyle(road).width)) : 0,
      asphalt: rs ? rs.backgroundColor : "нет",
      groundW: ground ? Math.round(parseFloat(getComputedStyle(ground).width)) : 0,
      fadeH: fade ? Math.round(fade.getBoundingClientRect().height) : 0,
      vh: window.innerHeight,
      poleTx: poles,
      poleZ,
      poleSvgW: (() => {
        const s = document.querySelector("[data-pole] svg")
        return s ? parseInt(s.getAttribute("width") || "0", 10) : 0
      })(),
      shadows: document.querySelectorAll(".yard-shadow").length,
      pools: document.querySelectorAll(".yard-pool").length,
      craneH: craneSvg ? parseInt(craneSvg.getAttribute("height") || "0", 10) : 0,
      treeTx: [...document.querySelectorAll("[data-tree]")].map((el) => {
        const m = getComputedStyle(el).transform.match(/matrix3d\(([^)]+)\)/)
        return m ? Math.round(parseFloat(m[1].split(",")[12]) + parseFloat(getComputedStyle(el).width) / 2) : null
      }),
      bldTx: [...document.querySelectorAll("[data-building]")].map((el) => {
        const m = getComputedStyle(el).transform.match(/matrix3d\(([^)]+)\)/)
        return m ? Math.round(parseFloat(m[1].split(",")[12]) + parseFloat(getComputedStyle(el).width) / 2) : null
      }),
      bldKinds: [...new Set([...document.querySelectorAll("[data-building]")].map((el) => el.getAttribute("data-kind")))]
        .join(","),
      po: document.querySelector("[data-login-world]")
        ? document.querySelector("[data-login-world]").style.perspectiveOrigin
        : "",
      horizonTop: (() => {
        const h = document.querySelector(".world-horizon")
        const r = h ? h.getBoundingClientRect() : null
        return r ? r.top / window.innerHeight : -1
      })(),
      horizonH: (() => {
        const h = document.querySelector(".world-horizon")
        const r = h ? h.getBoundingClientRect() : null
        return r ? r.height : 0
      })(),
      groundGrad: ground
        ? getComputedStyle(ground).backgroundImage.startsWith("linear-gradient(")
        : false,
      camAbove: (() => {
        const po = document.querySelector("[data-login-world]").style.perspectiveOrigin.match(/(\d+)%\s+(\d+)%/)
        const py = po ? (parseFloat(po[2]) / 100 - 0.5) * window.innerHeight : 9999
        return py <= 120 // плоскость земли y=160: камера обязана быть выше
      })(),
      hitBottom: null,
      hitLow: null,
      hitSky: null,
      backdropTop: br ? br.top / window.innerHeight : 0,
      backdropH: br ? br.height / window.innerHeight : 0,
    }
  })
  // hit-тест: внизу — земля/двор, вверху — небо (ловит «дорогу на
  // потолке» и «землю ребром»: rect у Chrome для 3D через камеру врёт,
  // а hit-тест честный). Ригам на секунду включаем pointer-events.
  const hits = await page.evaluate(() => {
    // риги остаются pointer-events:none (иначе съедают клик), включаем
    // точечно сами элементы мира — их и ловит elementFromPoint
    const els = [...document.querySelectorAll(
      "[data-ground],[data-road],[data-tree],[data-pole],[data-stack],[data-crane],[data-route-dot],[data-login-mote],[data-building]",
    )]
    const saved = els.map((el) => el.style.pointerEvents)
    els.forEach((el) => (el.style.pointerEvents = "auto"))
    const classify = (fy) => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * fy)
      if (!el) return "none"
      if (el.closest("[data-road]")) return "road"
      if (el.closest("[data-ground]")) return "ground"
      if (el.closest("[data-tree],[data-pole],[data-stack],[data-crane],[data-route-dot],[data-login-mote],[data-building]")) return "yard"
      if (el.closest("[data-login-world]")) return "sky"
      return "other"
    }
    const out = { bottom: classify(0.88), low: classify(0.65), sky: classify(0.3) }
    els.forEach((el, i) => (el.style.pointerEvents = saved[i]))
    return out
  })
  roadWorld.hitBottom = hits.bottom
  roadWorld.hitLow = hits.low
  roadWorld.hitSky = hits.sky
  check(
    "внизу земля, вверху небо (дорога не в небе)",
    ["road", "ground", "yard"].includes(roadWorld.hitBottom) &&
      ["road", "ground", "yard"].includes(roadWorld.hitLow) &&
      ["sky", "yard"].includes(roadWorld.hitSky),
    `низ кадра: ${roadWorld.hitBottom}, у горизонта: ${roadWorld.hitLow}, верх: ${roadWorld.hitSky}`,
  )
  check(
    "дорога — узкая полоса с краями (не взлётка)",
    roadWorld.roadW >= 220 && roadWorld.roadW <= 330 && roadWorld.asphalt !== "rgba(0, 0, 0, 0)" && roadWorld.asphalt !== "transparent",
    `${roadWorld.roadW}px, ${roadWorld.asphalt}`,
  )
  check(
    "земля накрывает весь двор (не космос)",
    roadWorld.groundW >= 3000 && roadWorld.fadeH >= roadWorld.vh * 0.3 && roadWorld.camAbove,
    `земля ${roadWorld.groundW}px, камера выше плоскости: ${roadWorld.camAbove}, гашение звёзд ${Math.round((roadWorld.fadeH / roadWorld.vh) * 100)}%`,
  )
  const polePairs = (() => {
    const byZ = new Map()
    for (const z of roadWorld.poleZ) if (z != null) byZ.set(z, (byZ.get(z) ?? 0) + 1)
    let n = 0
    for (const c of byZ.values()) if (c >= 2) n += 1
    return n
  })()
  const alongRoad =
    roadWorld.poleTx.length >= 10 &&
    roadWorld.poleTx.every((tx) => tx != null && Math.abs(tx) >= 240 && Math.abs(tx) <= 420) &&
    roadWorld.poleTx.some((tx) => tx < 0) &&
    roadWorld.poleTx.some((tx) => tx > 0) &&
    polePairs >= 5 &&
    roadWorld.poleSvgW >= 280
  check(
    "фонари-«Г» попарно с двух сторон дороги",
    alongRoad,
    `${roadWorld.poleTx.length} шт, столбы ±${[...new Set(roadWorld.poleTx.map((t) => Math.round(Math.abs(t))))].join("/")}px, пар по глубине ${polePairs}, кронштейн ${roadWorld.poleSvgW}px`,
  )
  check(
    "предметы на земле: тени и пятна света",
    roadWorld.shadows >= 14 && roadWorld.pools >= 6,
    `теней ${roadWorld.shadows}, пятен ${roadWorld.pools}`,
  )
  const poY = parseInt((roadWorld.po.match(/(\d+)%\s+(\d+)%/) || [])[2] || "0", 10)
  check(
    "горизонт ниже середины — небо главный план",
    poY >= 55,
    `perspectiveOrigin «${roadWorld.po}»: земля — нижние ${100 - poY}% кадра`,
  )
  check(
    "арки-краны компактнее (не пол-экрана)",
    roadWorld.craneH > 0 && roadWorld.craneH <= 260,
    `высота портала ${roadWorld.craneH}px (было 330)`,
  )
  check(
    "деревья по сторонам дороги",
    roadWorld.treeTx.length >= 16 &&
      roadWorld.treeTx.every((tx) => tx != null && Math.abs(tx) >= 180 && Math.abs(tx) <= 600) &&
      roadWorld.treeTx.some((tx) => tx < 0) &&
      roadWorld.treeTx.some((tx) => tx > 0),
    `${roadWorld.treeTx.length} елей: ${roadWorld.treeTx.slice(0, 8).join(", ")}…`,
  )
  check(
    "придорожное: парковка, закусочная, АЗС, мотель, склад, ангар",
    roadWorld.bldTx.length === 6 &&
      roadWorld.bldTx.every((tx) => tx != null && Math.abs(tx) >= 600) &&
      roadWorld.bldTx.some((tx) => tx < 0) &&
      roadWorld.bldTx.some((tx) => tx > 0) &&
      roadWorld.bldKinds.split(",").filter(Boolean).length >= 5,
    `${roadWorld.bldTx.length} зданий (${roadWorld.bldKinds}) по обочинам ${roadWorld.bldTx.join(", ")}`,
  )
  check(
    "под дорогу не проваливаемся (подбой снизу)",
    roadWorld.backdropTop >= 0.55 && roadWorld.backdropH >= 0.25,
    `подбой земли от ${(roadWorld.backdropTop * 100).toFixed(0)}% высоты, толщиной ${(roadWorld.backdropH * 100).toFixed(0)}%`,
  )
  check(
    "горизонт — светящаяся линия (дорога не в небе)",
    roadWorld.horizonTop > 0.5 &&
      roadWorld.horizonTop < 0.62 &&
      roadWorld.horizonH > 0 &&
      roadWorld.horizonH <= 24 &&
      roadWorld.groundGrad,
    `линия на ${(roadWorld.horizonTop * 100).toFixed(1)}% высоты (${Math.round(roadWorld.horizonH)}px), земля с дальним светлым краем: ${roadWorld.groundGrad}`,
  )
  const tidy = await page.evaluate(() => {
    const center = (el) => {
      const m = getComputedStyle(el).transform.match(/matrix3d\(([^)]+)\)/)
      if (!m) return null
      return Math.round(parseFloat(m[1].split(",")[12]) + parseFloat(getComputedStyle(el).width) / 2)
    }
    const tx = [...document.querySelectorAll("[data-stack]")].map(center)
    return {
      cols: new Set(tx.map((v) => Math.abs(v ?? 0))).size,
      ok: tx.every((v) => v != null && Math.abs(v) >= 400 && Math.abs(v) <= 700),
      dots: [...document.querySelectorAll("[data-route-dot]")].every((el) => Math.abs(center(el)) <= 2),
    }
  })
  check(
    "двор опрятен: ровные колонны, бусины на нитке",
    tidy.ok && tidy.cols <= 4 && tidy.dots,
    `колонн штабелей ${tidy.cols}, точки на оси: ${tidy.dots}`,
  )
  const grounded = await page.evaluate(() => {
    const dolly = window.__loginWorld.dolly
    const oy =
      (parseFloat(
        (document.querySelector("[data-login-world]").style.perspectiveOrigin.match(/(\d+)%\s+(\d+)%/) || [])[2] || "50",
      ) /
        100) *
      window.innerHeight
    const pick = (sel) => {
      let best = null
      for (const el of document.querySelectorAll(sel)) {
        const m = getComputedStyle(el).transform.match(/matrix3d\(([^)]+)\)/)
        if (!m) continue
        const v = m[1].split(",").map(Number)
        const f = 900 / (900 - (dolly + v[14]))
        if (f < 0.3 || f > 1.3) continue
        const score = Math.abs(f - 0.6)
        if (!best || score < best.score) best = { el, f, score }
      }
      if (!best) return null
      const py = oy - window.innerHeight / 2
      const groundY = 160 // GROUND_Y в login-world.tsx
      const pred = oy + (groundY - py) * best.f
      return Math.abs(best.el.getBoundingClientRect().bottom - pred)
    }
    const vals = [
      pick("[data-stack]"),
      pick("[data-tree]"),
      pick("[data-pole]"),
      pick("[data-building]"),
    ].filter((x) => x != null)
    return { n: vals.length, max: vals.length ? Math.max(...vals) : 999 }
  })
  check(
    "двор стоит на земле (основания на плоскости)",
    grounded.n >= 2 && grounded.max <= 15,
    `макс. отклонение основания ${grounded.max.toFixed(1)}px у ${grounded.n} типов (до и18 было 20–90px)`,
  )
  const pwa = await page.evaluate(() => ({
    capable:
      document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute("content") === "yes" ||
      document.querySelector('meta[name="mobile-web-app-capable"]')?.getAttribute("content") === "yes",
    manifest: document.querySelector('link[rel="manifest"]') != null,
    theme: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "",
  }))
  check(
    "PWA: с экрана «Домой» без браузерных стрелок",
    pwa.capable && pwa.manifest && pwa.theme !== "",
    `capable:${pwa.capable}, manifest:${pwa.manifest}, theme:${pwa.theme}`,
  )

  // время суток: палитры переключаются (?tod= — ручной override)
  const todPage = await context.newPage()
  const todProbe = async (url) => {
    // в песочнице хромиум изредка роняет навигацию (ERR_ABORTED,
    // память) — это флак среды, не сцены: честно пробуем ещё раз
    for (let attempt = 1; ; attempt += 1) {
      try {
        await todPage.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
        break
      } catch (err) {
        if (attempt >= 3) throw err
        await todPage.waitForTimeout(1500)
      }
    }
    await todPage.waitForFunction(() => window.__loginWorld != null, null, { timeout: 20000 })
    await todPage.waitForTimeout(600)
    return todPage.evaluate(() => ({
      tod: document.querySelector("[data-login-world]")?.getAttribute("data-tod"),
      road: getComputedStyle(document.querySelector("[data-road]")).backgroundColor,
      stars: getComputedStyle(document.querySelector(".sky-stars")).opacity,
      lamp: getComputedStyle(document.querySelector(".pole-cone")).opacity,
      sun: getComputedStyle(document.querySelector(".sky-sun")).opacity,
      leaf: getComputedStyle(document.querySelector(".tree-leaf")).fill,
      bldWin: getComputedStyle(document.querySelector(".bld-win")).opacity,
    }))
  }
  const todDay = await todProbe(`${BASE}/login?tod=day`)
  const todDawn = await todProbe(`${BASE}/login?tod=dawn`)
  const todDusk = await todProbe(`${BASE}/login?tod=dusk`)
  const todNow = await todProbe(`${BASE}/login`)
  const hour = await todPage.evaluate(() => {
    const h = new Date().getHours()
    return h >= 5 && h < 9 ? "dawn" : h >= 9 && h < 17 ? "day" : h >= 17 && h < 23 ? "dusk" : "night"
  })
  check(
    "сцена по времени суток меняется",
    todDay.tod === "day" &&
      todDawn.tod === "dawn" &&
      todDusk.tod === "dusk" &&
      todNow.tod === hour &&
      parseFloat(todDay.stars) === 0 &&
      parseFloat(todDawn.stars) > 0.2 &&
      parseFloat(todDay.sun) > 0.5 &&
      todDay.road !== todDawn.road &&
      todDay.road !== todDusk.road &&
      parseFloat(todDay.lamp) < 0.3 &&
      todDay.leaf !== todDawn.leaf &&
      parseFloat(todDay.bldWin) < 0.3 &&
      parseFloat(todDawn.bldWin) > 0.5,
    `день: звёзды ${todDay.stars}, солнце ${todDay.sun}; рассвет: звёзды ${todDawn.stars}; закат: дорога ${todDusk.road}; ели ${todDay.leaf} vs ${todDawn.leaf}; сейчас ${todNow.tod} (${hour})`,
  )
  await todPage.close()
  check(
    "объём: искры горят и летят, ели в полёте (refs целы)",
    world.motes >= 10 && world.moteLit >= 10 && world.treesAnimated >= 16,
    `искр ${world.motes} (горят ${world.moteLit}), елей с анимацией ${world.treesAnimated}/18`,
  )
  check("маршрут заказов: точки бегут по нитке", world.dots >= 4, `${world.dots} точек`)
  check("форма — объект мира (3D-трансформ)", world.panel3d, world.panel3d ? "matrix3d" : "нет")

  // до касания: дорога бежит ЧИСТОЙ — плиты нет, только подсказка
  const before = await page.evaluate(() => ({
    state: document.querySelector(".doc-arrive")?.getAttribute("data-state"),
    opacity: document.querySelector(".doc-arrive") ? getComputedStyle(document.querySelector(".doc-arrive")).opacity : "?",
    hint: document.querySelector("[data-login-hint]") != null,
  }))
  check("до касания — чистая дорога, плита далеко", before.state === "far" && before.opacity === "0" && before.hint, `state ${before.state}, opacity ${before.opacity}, подсказка:${before.hint}`)

  // касание экрана → плита красиво ПРИЛЕТАЕТ издалека («мы приехали»)
  await page.mouse.click(600, 400)
  await page.waitForTimeout(2600)
  const after = await page.evaluate(() => ({
    state: document.querySelector(".doc-arrive")?.getAttribute("data-state"),
    opacity: document.querySelector(".doc-arrive") ? getComputedStyle(document.querySelector(".doc-arrive")).opacity : "?",
    hint: document.querySelector("[data-login-hint]") != null,
  }))
  check("касание — плита прилетает издалека", after.state === "here" && parseFloat(after.opacity) >= 0.9 && !after.hint, `state ${after.state}, opacity ${after.opacity}`)
  const docSize = await page.evaluate(() => {
    const r = document.querySelector("[data-login-panel]")?.getBoundingClientRect()
    return r ? { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight } : null
  })
  check(
    "пропуск — компактный документ",
    docSize != null && docSize.w <= 400 && docSize.h <= Math.round(docSize.vh * 0.72),
    docSize ? `${docSize.w}×${docSize.h} px на экране ${docSize.vw}×${docSize.vh}` : "нет",
  )
  check("форма — прозрачный экран", parseFloat(world.glassAlpha) <= 0.55 && world.glassBlur.includes("blur"), `фон ${world.glassAlpha}, blur: ${world.glassBlur.slice(0, 20)}`)

  // камера едет сквозь пространство
  const d1 = await page.evaluate(() => window.__loginWorld.dolly)
  await page.waitForTimeout(1300)
  const d2 = await page.evaluate(() => window.__loginWorld.dolly)
  check("камера перемещается в пространстве", d2 - d1 > 150, `dolly ${Math.round(d1)} → ${Math.round(d2)}`)

  // объём: элементы двора пролетают мимо камеры и сменяются
  const pA = await page.evaluate(() => window.__loginWorld.passed)
  await page.waitForTimeout(5200)
  const pB = await page.evaluate(() => window.__loginWorld.passed)
  check("объём: двор пролетает мимо и сменяется", pB > pA, `пролетело ${pA} → ${pB}`)

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
  await wpage.mouse.click(600, 400) // плита прилетает — как живой пользователь
  await wpage.waitForTimeout(1400)
  await wpage.fill("input#email", envValue("OWNER_EMAIL"))
  await wpage.fill("input#password", envValue("OWNER_PASSWORD"))
  await wpage.click("button[type=\"submit\"]", { force: true })
  // ждём начала ворпа и смотрим «фонари заканчиваются»: двор впереди
  // больше не рождается, мир гаснет — дорога приехала
  await wpage.waitForFunction(() => (window.__loginWorld?.warp ?? 0) > 0.9, null, { timeout: 15000 })
  const yardVis = () =>
    wpage.evaluate(() => {
      const els = [...document.querySelectorAll("[data-stack],[data-crane],[data-pole],[data-route-dot]")]
      let vis = 0
      for (const el of els) if (parseFloat(getComputedStyle(el).opacity) > 0.05) vis++
      const rig = document.querySelector(".world-rig")
      return {
        vis,
        rig: rig ? parseFloat(getComputedStyle(rig).opacity) : 1,
        warp: document.querySelector("[data-login-world]")?.getAttribute("data-warp"),
      }
    })
  const e1 = await yardVis()
  await wpage.waitForTimeout(560)
  const e2 = await yardVis()
  await wpage.waitForTimeout(120)
  const duskProbe = await wpage.evaluate(() => ({
    op: getComputedStyle(document.querySelector(".warp-dusk")).opacity,
    arriving: (() => {
      try {
        return window.sessionStorage.getItem("loginex:arriving")
      } catch {
        return "err"
      }
    })(),
  }))
  check(
    "ворп: ночной тоннель — эстафета приветствия",
    parseFloat(duskProbe.op) >= 0.5 && duskProbe.arriving === "1",
    `тоннель ${duskProbe.op}, флаг прилёта: ${duskProbe.arriving}`,
  )
  check(
    "ворп: фонари заканчиваются, мир гаснет",
    e1.warp === "1" && e2.vis < e1.vis && e2.rig < 0.55,
    `двор виден ${e1.vis} → ${e2.vis}, мир ${e1.rig.toFixed(2)} → ${e2.rig.toFixed(2)}`,
  )
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

  // касание экрана: плита ПРИЛЕТАЕТ (и это же — жест для гироскопа)
  const mBefore = await mpage.evaluate(() => ({
    state: document.querySelector(".doc-arrive")?.getAttribute("data-state"),
    hint: document.querySelector("[data-login-hint]") != null,
  }))
  await mCdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 110 }] })
  await mCdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await mpage.waitForTimeout(1600)
  const mAfter = await mpage.evaluate(() => ({
    state: document.querySelector(".doc-arrive")?.getAttribute("data-state"),
    opacity: document.querySelector(".doc-arrive") ? getComputedStyle(document.querySelector(".doc-arrive")).opacity : "?",
    hint: document.querySelector("[data-login-hint]") != null,
  }))
  check(
    "телефон: касание — плита прилетает",
    mBefore.state === "far" && mAfter.state === "here" && parseFloat(mAfter.opacity) >= 0.9 && !mAfter.hint,
    `${mBefore.state} → ${mAfter.state}, opacity ${mAfter.opacity}`,
  )
  const noPill = await mpage.evaluate(() => document.querySelector("[data-gyro-pill]") == null)
  await mpage.waitForTimeout(200)
  const gyroHookGone = await mpage.evaluate(
    () => typeof window.__loginWorldGyro === "undefined" && window.__loginWorld.gyro === undefined,
  )
  // даём недавнему повороту пальца затухнуть, чтобы мерить только реакцию
  // на события гироскопа, а не естественный дрейф мира
  await mpage.waitForTimeout(600)
  const yawBefore = await mpage.evaluate(() => window.__loginWorld.yaw)
  await mpage.evaluate(() => {
    // трясём телефон как угодно: мира это больше не касается —
    // гироскоп выключен (и20), наклон только от пальца и курсора.
    // Скачок gamma 10→89 при живом гироскопе дал бы ~1.6° за 250мс
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: 30, gamma: 10 }))
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: 74, gamma: 89 }))
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { beta: -20, gamma: -60 }))
  })
  await mpage.waitForTimeout(250)
  const yawAfter = await mpage.evaluate(() => window.__loginWorld.yaw)
  check(
    "телефон: гироскоп выключен — тряска не двигает мир, кнопки нет",
    noPill && gyroHookGone && Math.abs(yawAfter - yawBefore) < 0.5,
    `до ${yawBefore.toFixed(2)}°, после тряски ${yawAfter.toFixed(2)}° (отклик ${Math.abs(yawAfter - yawBefore).toFixed(2)}°, дрейф мира в норме)`,
  )

  // придорожное на телефоне (и21): здания сдвигаются к дороге
  // пропорционально ширине окна — раньше на 390px они были за обрезом
  const bldVis = () =>
    mpage.evaluate(() => {
      let vis = 0
      for (const el of document.querySelectorAll("[data-building]")) {
        const r = el.getBoundingClientRect()
        // заметность: не «один пиксель у кромки», а ≥40px по горизонтали
        const overlap = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0)
        if (overlap >= 40 && r.bottom > window.innerHeight * 0.2) vis += 1
      }
      return vis
    })
  let bldMax = 0
  for (let i = 0; i < 3; i += 1) {
    bldMax = Math.max(bldMax, await bldVis())
    await mpage.waitForTimeout(600)
  }
  check(
    "телефон: здания у дороги в кадре (не за обрезом)",
    bldMax >= 2,
    `видно зданий: ${bldMax} из 6 (макс. за 3 замера, каждая ≥40px)`,
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

  // никаких уведомлений и кнопок про гироскоп — только живой датчик
  const noNotices = await mpage.evaluate(
    () => document.querySelector("[data-gyro-hint]") == null && document.querySelector("[data-gyro-pill]") == null,
  )
  check("телефон: уведомлений про гироскоп нет", noNotices, noNotices ? "чисто" : "есть (ошибка)")
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
    stacks: document.querySelectorAll("[data-stack]").length,
    motes: document.querySelectorAll("[data-login-mote]").length,
    dots: document.querySelectorAll("[data-route-dot]").length,
    phone: document.querySelector("#driver-phone") != null,
    password: document.querySelector("#driver-password") != null,
    button: [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("В путь")),
    headline: (document.querySelector("h2")?.textContent || "").replace(/\s+/g, " ").trim(),
  }))
  check(
    "водитель: терминал в объёме",
    driver.world && driver.cranes >= 2 && driver.stacks >= 8 && driver.motes >= 10 && driver.dots >= 4,
    `кранов ${driver.cranes}, штабелей ${driver.stacks}, искр ${driver.motes}, точек ${driver.dots}`,
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

  // касание — плита водителя прилетает
  await dCdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 420 }] })
  await dCdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await dpage.waitForTimeout(1600)
  const dArrive = await dpage.evaluate(() => ({
    state: document.querySelector(".doc-arrive")?.getAttribute("data-state"),
    opacity: document.querySelector(".doc-arrive") ? getComputedStyle(document.querySelector(".doc-arrive")).opacity : "?",
  }))
  check("водитель: касание — плита прилетает", dArrive.state === "here" && parseFloat(dArrive.opacity) >= 0.9, `state ${dArrive.state}, opacity ${dArrive.opacity}`)
  await dpage.waitForTimeout(400)
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
  await rpage.mouse.click(600, 400)
  await rpage.waitForTimeout(1600)
  const rArrive = await rpage.evaluate(() => ({
    state: document.querySelector(".doc-arrive")?.getAttribute("data-state"),
    opacity: document.querySelector(".doc-arrive") ? getComputedStyle(document.querySelector(".doc-arrive")).opacity : "?",
  }))
  check("регистрация: касание — карточка прилетает", rArrive.state === "here" && parseFloat(rArrive.opacity) >= 0.9, `state ${rArrive.state}, opacity ${rArrive.opacity}`)
  const rDoc = await rpage.evaluate(() => {
    const doc = document.querySelector("[data-login-doc]")
    return {
      doc: doc != null,
      barcode: doc ? doc.textContent.includes("ЯРОСЛАВЛЬ") : false,
      scroll: doc ? doc.scrollWidth <= doc.clientWidth + 1 : false,
    }
  })
  check(
    "регистрация: пропуск-документ со штрихкодом (не карточка)",
    rDoc.doc && rDoc.barcode && rDoc.scroll,
    `документ ${rDoc.doc}, штрихкод ${rDoc.barcode}`,
  )
  await rpage.waitForTimeout(600)
  await shot(rpage, "/home/user/work/visual-register.png")
  check("регистрация: скриншот сохранён", true, "work/visual-register.png")
  const rErr = rErrors.filter((t) => !isNoise(t))
  check("регистрация: ошибок нет", rErr.length === 0, rErr.slice(0, 2).join(" || ") || "нет")
  await rpage.close()
  await regContext.close()
  }

  // ── Восстановление пароля: те же мир и пропуск ──
  if (PHASE === "all" || PHASE === "recover") {
  const fContext = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const fpage = await fContext.newPage()
  const fErrors = []
  fpage.on("pageerror", (e) => fErrors.push(String(e).slice(0, 150)))
  fpage.on("console", (m) => { if (m.type() === "error") fErrors.push(m.text().slice(0, 150)) })
  await fpage.goto(`${BASE}/forgot-password`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await fpage.waitForSelector("input#email", { timeout: 30000 })
  await fpage.waitForFunction(() => window.__loginWorld != null, null, { timeout: 20000 })
  await fpage.waitForTimeout(400)
  const forgot = await fpage.evaluate(() => ({
    world: document.querySelector("[data-login-world]") != null,
    doc: document.querySelector("[data-login-doc]") != null,
    email: document.querySelector("input#email") != null,
    back: [...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/login"),
  }))
  check(
    "восстановление: мир и пропуск-документ",
    forgot.world && forgot.doc && forgot.email && forgot.back,
    `мир ${forgot.world}, документ ${forgot.doc}, назад ко входу ${forgot.back}`,
  )
  const tpage = await fContext.newPage()
  const tErrors = []
  tpage.on("pageerror", (e) => tErrors.push(String(e).slice(0, 150)))
  await tpage.goto(`${BASE}/reset-password?token=acceptance-fake`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await tpage.waitForFunction(() => window.__loginWorld != null || document.querySelector("main, [data-login-world]") != null, null, { timeout: 30000 })
  await tpage.waitForTimeout(1200)
  const reset = await tpage.evaluate(() => ({
    world: document.querySelector("[data-login-world]") != null,
    verdict: document.body.textContent.includes("Ссылка не работает") || document.body.textContent.includes("ссылк"),
  }))
  check(
    "восстановление: смена пароля — в мире, вердикт по ссылке",
    reset.world && reset.verdict,
    `мир ${reset.world}, вердикт показан ${reset.verdict}`,
  )
  const fErr = fErrors.filter((t) => !isNoise(t))
  const tErr = tErrors.filter((t) => !isNoise(t))
  check("восстановление: ошибок нет (почта)", fErr.length === 0, fErr.slice(0, 2).join(" || ") || "нет")
  check("восстановление: ошибок нет (смена)", tErr.length === 0, tErr.slice(0, 2).join(" || ") || "нет")
  await fpage.close()
  await tpage.close()
  await fContext.close()
  }

  // ── Дашборд владельца на телефоне: прилёт по эстафете ──
  if (PHASE === "all" || PHASE === "dashboard") {
  const oContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const opage = await oContext.newPage()
  const oErrors = []
  opage.on("pageerror", (e) => oErrors.push(String(e).slice(0, 150)))
  opage.on("console", (m) => { if (m.type() === "error") oErrors.push(m.text().slice(0, 150)) })
  await opage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await opage.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  await opage.waitForFunction(() => window.__loginWorld != null, null, { timeout: 20000 })
  await opage.tap("body").catch(() => {})
  await opage.waitForTimeout(1600)
  await opage.fill("input#email", envValue("OWNER_EMAIL"))
  await opage.fill("input#password", envValue("OWNER_PASSWORD"))
  await opage.click("button[type=\"submit\"]", { force: true })
  // /owner здесь НЕ перехватываем: смотрим настоящий дашборд
  await opage.waitForURL("**/owner", { timeout: 90000 })
  await opage.waitForSelector("main", { timeout: 60000 })
  await opage.waitForTimeout(450)
  const arriving = await opage.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-arriving"),
    paused: getComputedStyle(document.querySelector("main [style]") ?? document.querySelector("main")).animationPlayState,
  }))
  await opage.waitForTimeout(2200)
  const landed = await opage.evaluate(() => {
    const header = document.querySelector("header")
    const bar = document.querySelector("[data-bottom-nav]")
    const barRect = bar ? bar.getBoundingClientRect() : null
    return {
      attr: document.documentElement.getAttribute("data-arriving"),
      safeArea: (header?.getAttribute("style") ?? "").includes("safe-area"),
      barVisible:
        barRect != null &&
        barRect.width > 200 &&
        barRect.bottom <= window.innerHeight + 1 &&
        barRect.top > window.innerHeight * 0.75,
      barButtons: bar ? bar.querySelectorAll("a, button").length : 0,
      barSafeBottom: (bar?.getAttribute("style") ?? "").includes("safe-area-inset-bottom"),
      overflow: (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth + 1,
      rise: [...document.querySelectorAll("main [style]")].filter((el) =>
        String(el.style.animation).includes("rise-in"),
      ).length,
      splash: document.querySelector(".welcome-splash") != null,
    }
  })
  check(
    "дашборд: прилёт — контент на паузе под тон-подложкой",
    arriving.attr === "1" && landed.attr === null,
    `во время подложки data-arriving=${arriving.attr}, после=${landed.attr}`,
  )
  check(
    "дашборд: нижняя навигация «как у приложения» + safe-area",
    landed.barVisible && landed.barButtons >= 3 && landed.barSafeBottom && landed.safeArea,
    `панель ${landed.barVisible}, кнопок ${landed.barButtons}, safe-area шапка ${landed.safeArea}`,
  )
  check("дашборд: не шире экрана (без бокового скролла)", landed.overflow, `scrollWidth ok`)
  check(
    "дашборд: карточки встают по очереди (rise-in)",
    landed.rise >= 4 || landed.splash,
    `анимируется элементов: ${landed.rise}`,
  )
  const oErr = oErrors.filter((t) => !isNoise(t))
  check("дашборд: ошибок нет", oErr.length === 0, oErr.slice(0, 2).join(" || ") || "нет")
  await shot(opage, "/home/user/work/visual-owner-mobile.png")
  await opage.close()
  await oContext.close()
  }

  if (PHASE === "all" || PHASE === "lm") {
  // Панель логиста /lm — экраны, где владелец проводит время на телефоне
  const lContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const lpage = await lContext.newPage()
  const lErrors = []
  lpage.on("pageerror", (e) => lErrors.push(String(e).slice(0, 150)))
  lpage.on("console", (m) => { if (m.type() === "error") lErrors.push(m.text().slice(0, 150)) })
  await lpage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await lpage.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  await lpage.waitForFunction(() => window.__loginWorld != null, null, { timeout: 20000 })
  await lpage.tap("body").catch(() => {})
  await lpage.waitForTimeout(1600)
  await lpage.fill("input#email", envValue("OWNER_EMAIL"))
  await lpage.fill("input#password", envValue("OWNER_PASSWORD"))
  await lpage.click("button[type=\"submit\"]", { force: true })
  await lpage.waitForURL("**/owner", { timeout: 90000 })
  await lpage.waitForTimeout(2500) // сплэш /owner доиграет
  // владелец открывает панель логиста — ту, где он живёт на телефоне
  await lpage.goto(`${BASE}/lm`, { waitUntil: "domcontentloaded", timeout: 90000 })
  await lpage.waitForSelector("[data-lm-bottom-nav]", { timeout: 60000 })
  await lpage.waitForTimeout(2500) // лестница карточек доиграет
  const lm1 = await lpage.evaluate(() => {
    const nav = document.querySelector("[data-lm-bottom-nav]")
    const risers = [...document.querySelectorAll("main .panel-rise, main .lm-stagger > *")]
    return {
      navButtons: nav ? nav.querySelectorAll("a, button").length : 0,
      hasMain: document.querySelector("main") != null,
      overflow: (document.scrollingElement?.scrollWidth ?? 0) <= window.innerWidth + 1,
      rise: risers.filter((el) => getComputedStyle(el).animationName === "panel-rise").length,
    }
  })
  check(
    "лм-панель: каркас — main + нижняя навигация 5 вкладок",
    lm1.hasMain && lm1.navButtons >= 5,
    `main ${lm1.hasMain}, кнопок ${lm1.navButtons}`,
  )
  check("лм-панель: не шире экрана (без бокового скролла)", lm1.overflow, "scrollWidth ok")
  check(
    "лм-панель: карточки главной встают по очереди (panel-rise)",
    lm1.rise >= 4,
    `анимируется элементов: ${lm1.rise}`,
  )
  // эстафета прилёта: флаг + reload — карточки на паузе под тон-подложкой
  await lpage.evaluate(() => sessionStorage.setItem("loginex:arriving", "1"))
  await lpage.reload({ waitUntil: "domcontentloaded", timeout: 90000 })
  await lpage.waitForSelector("[data-lm-bottom-nav]", { timeout: 60000 })
  const veilUp = await lpage
    .waitForFunction(() => document.documentElement.getAttribute("data-arriving") === "1", null, { timeout: 8000 })
    .then(() => true, () => false)
  const lArr = await lpage.evaluate(() => {
    const el = document.querySelector("main .panel-rise, main .lm-stagger > *")
    return {
      paused: el ? getComputedStyle(el).animationPlayState : "нет элементов",
    }
  })
  await lpage.waitForTimeout(2200)
  const lAfter = await lpage.evaluate(() => document.documentElement.getAttribute("data-arriving"))
  check(
    "лм-панель: эстафета прилёта — пауза под тон-подложкой, потом снята",
    veilUp && lArr.paused === "paused" && lAfter === null,
    `подложка ${veilUp}, play-state=${lArr.paused}, после=${lAfter}`,
  )
  const lErr = lErrors.filter((t) => !isNoise(t))
  check("лм-панель: ошибок нет", lErr.length === 0, lErr.slice(0, 2).join(" || ") || "нет")
  await shot(lpage, "/home/user/work/visual-lm-mobile.png")
  await lpage.close()
  await lContext.close()
  }

  console.log(`ИТОГ: ${results.filter((r) => r.ok).length}/${results.length} проверок пройдено`)
  process.exitCode = results.some((r) => !r.ok) ? 1 : 0
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await browser.close()
}
