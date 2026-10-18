// scripts/acceptance-eta-run.cjs
//
// Сквозная приёмка ETA на ОТДЕЛЬНОМ рейсе acc-route-2. Ничего не подменяет:
// координаты берёт настоящий геокодер, расстояния — настоящий OSRM.
//
// Что делает:
//   1. фиксирует адреса и координаты всех точек рейса;
//   2. считает прогноз движком рейса и сверяет каждое плечо с суммой;
//   3. проводит рейс по этапам до завершения (кабинет водителя);
//   4. проверяет сохранение прогнозов, версий, фактических отметок;
//   5. проверяет идемпотентность повторного finish_trip.
//
// Запуск: node scripts/acceptance-eta-run.cjs
const BASE = "http://localhost:3000"
const fs = require("node:fs")
const { PrismaClient } = require("@prisma/client")
const p = new PrismaClient()

const ROUTE = "acc-route-2"
const DRIVER_PHONE = "79161234504"

const jar = new Map()
function absorb(res) {
  const raw = res.headers.get("set-cookie")
  if (!raw) return
  for (const part of raw.split(/,(?=[^;]+?=)/)) {
    const [pair] = part.split(";")
    const i = pair.indexOf("=")
    if (i > 0) {
      const n = pair.slice(0, i).trim()
      const v = pair.slice(i + 1).trim()
      if (v === "") jar.delete(n)
      else jar.set(n, v)
    }
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
let CSRF = ""

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": CSRF, cookie: cookieHeader() },
    body: JSON.stringify(body),
  })
  absorb(res)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function get(path) {
  const res = await fetch(BASE + path, { headers: { cookie: cookieHeader() } })
  absorb(res)
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(email, password, path, body) {
  const csrfRes = await fetch(BASE + "/api/auth/csrf")
  absorb(csrfRes)
  CSRF = (await csrfRes.json()).csrfToken
  const r = await post(path, body)
  if (!r.json.success) throw new Error(`вход ${email}: ${JSON.stringify(r.json).slice(0, 140)}`)
}

;(async () => {
  const env = fs.readFileSync(".env", "utf8")
  const adminPw = env.match(/^ADMIN_PASSWORD="(.*)"$/m)[1]
  const driverPw = env.match(/^DRIVER_DEFAULT_PASSWORD="(.*)"$/m)[1]

  console.log("=".repeat(72))
  console.log("СКВОЗНАЯ ПРИЁМКА ETA — рейс", ROUTE)
  console.log("=".repeat(72))

  // ── 1. Точки рейса ──────────────────────────────────────────────────────
  const route = await p.route.findUnique({
    where: { id: ROUTE },
    include: { orders: { orderBy: { routeSequence: "asc" } } },
  })
  const settings = await p.fleetSettings.findFirst({ where: { organizationId: route.organizationId } })
  console.log("\n── 1. ТОЧКИ РЕЙСА ──")
  console.log("база   :", settings?.baseAddress, "|", settings?.baseLat, settings?.baseLng)
  for (const o of route.orders) {
    console.log(`заказ ${o.routeSequence}: ${o.routeFrom}  →  ${o.routeTo} | км в карточке: ${o.distance}`)
  }

  // ── 2. Прогноз движком рейса (реальный OSRM) ────────────────────────────
  await login("admin@loginex.local", adminPw, "/api/auth/login", {
    email: "admin@loginex.local",
    password: adminPw,
  })
  const trip = await get(`/api/routes/${ROUTE}/trip`)
  if (trip.status !== 200) throw new Error("прогноз рейса: HTTP " + trip.status)
  const d = trip.json

  console.log("\n── 2. ПРОГНОЗ ПО РЕЙСУ (реальный OSRM) ──")
  console.log("источник маршрутов :", JSON.stringify(d.sources))
  console.log("modelVersion       :", d.modelVersion)

  const legs = (d.stages || []).filter((s) => s.kind === "driving" || s.kind === "return_to_base")
  const ops = (d.stages || []).filter((s) => s.kind === "loading" || s.kind === "unloading")
  const legSum = legs.reduce((a, s) => a + (s.distanceM || 0), 0)
  console.log("\nплеч:", legs.length)
  for (const s of legs) {
    console.log(`  ${String(s.kind).padEnd(14)} ${String(Math.round(s.distanceM || 0)).padStart(8)} м  ${String(s.address).slice(0, 58)}`)
  }
  console.log(`  ${"ИТОГО".padEnd(14)} ${String(Math.round(legSum)).padStart(8)} м  = ${(legSum / 1000).toFixed(1)} км`)
  console.log("операций (погрузка/выгрузка):", ops.length,
    "| расстояние у операций:", ops.every((s) => !s.distanceM) ? "0 у всех" : "ЕСТЬ НЕНУЛЕВОЕ")

  const rem = d.remaining
  console.log("\nвремя: движение", rem.drivingSec, "+ операции", rem.stopsSec, "+ перерывы", rem.restSec,
    "=", rem.drivingSec + rem.stopsSec + rem.restSec, "| totalSec", rem.totalSec,
    "|", rem.drivingSec + rem.stopsSec + rem.restSec === rem.totalSec ? "СХОДИТСЯ" : "РАСХОЖДЕНИЕ")
  const rp = d.restPlan || {}
  console.log("перерывов:", (rp.breaks || []).length, "| минут всего:", rp.totalMinutes,
    "| сумма:", (rp.breaks || []).reduce((a, b) => a + b.minutes, 0))
  console.log("dataQuality:", JSON.stringify(d.dataQuality))
  console.log("confidence:", d.confidence.level, d.confidence.score)

  // ── 3. Первоначальный прогноз сохраняется ───────────────────────────────
  const f1 = await post("/api/eta/forecast", { routeId: ROUTE })
  const d1 = f1.json.forecast || f1.json
  console.log("\n── 3. ПЕРВОНАЧАЛЬНЫЙ ПРОГНОЗ СОХРАНЁН ──")
  console.log("POST /api/eta/forecast →", f1.status, "| км", d1.distanceM ? (d1.distanceM / 1000).toFixed(1) : null)
  console.log("sources:", JSON.stringify(d1.sources))
  const initialArrival = d1.initialArrivalAt

  // ── 4. Проведение рейса по этапам ───────────────────────────────────────
  await login("driver", driverPw, "/api/m/login", { phone: DRIVER_PHONE, password: driverPw })
  console.log("\n── 4. ПРОВЕДЕНИЕ РЕЙСА ПО ЭТАПАМ ──")
  const before = await get("/api/m/route")
  const stages0 = (before.json.trip?.stages || []).length
  const total0 = before.json.trip?.remaining?.totalSec
  console.log("этапов в кабинете водителя:", stages0, "| начальный остаток:", total0, "с")

  let step = 0
  let stuck = 0
  let last = ""
  const remainingLog = []
  while (step < 30) {
    const cur = await get("/api/m/route")
    const tripNow = cur.json.trip
    if (!tripNow) throw new Error("кабинет водителя потерял рейс")
    const actions = (tripNow.actions || []).map((a) => a.command)
    const primary = (tripNow.actions || []).find((a) => a.primary && a.command !== "report_problem")
    if (tripNow.finished) {
      console.log(`  [${step}] рейс завершён`)
      break
    }
    const lastIdx = (tripNow.stages || []).length - 1
    if (actions.includes("finish_trip") && (tripNow.currentStageIndex ?? -1) >= lastIdx) {
      const r = await post("/api/m/route/stage", { routeId: ROUTE, command: "finish_trip" })
      console.log(`  [${step}] finish_trip → ${r.status} | факт: ${JSON.stringify(r.json.forecastFact)}`)
      break
    }
    if (!primary) {
      console.log(`  [${step}] нет доступного действия: ${actions.join(",")}`)
      break
    }
    if (primary.command === last) {
      if (++stuck >= 2) {
        console.log(`  [${step}] «${primary.command}» повторно недоступно — стоп`)
        break
      }
    } else stuck = 0
    last = primary.command

    const r = await post("/api/m/route/stage", { routeId: ROUTE, command: primary.command })
    if (r.status >= 400) {
      console.log(`  [${step}] ${primary.command} → ${r.status} | ${r.json.error}`)
      break
    }
    const after = await get("/api/m/route")
    const tp = after.json.trip || {}
    remainingLog.push(tp.remaining ? tp.remaining.totalSec : null)
    step++
  }
  console.log("  остаток по шагам:", remainingLog.join(" → "))
  console.log("  остаток не возрастает:",
    remainingLog.every((v, i) => i === 0 || v === null || remainingLog[i - 1] === null || v <= remainingLog[i - 1]))

  // ── 5. Новые версии прогноза после фактических отметок ──────────────────
  await login("admin@loginex.local", adminPw, "/api/auth/login", {
    email: "admin@loginex.local",
    password: adminPw,
  })
  for (let i = 0; i < 2; i++) {
    const r = await post("/api/eta/forecast", { routeId: ROUTE })
    console.log(`  прогноз после рейса #${i + 1} → ${r.status}`)
    await sleep(300)
  }

  // ── 6. Идемпотентность повторного finish_trip ───────────────────────────
  await login("driver", driverPw, "/api/m/login", { phone: DRIVER_PHONE, password: driverPw })
  const again = await post("/api/m/route/stage", { routeId: ROUTE, command: "finish_trip" })
  console.log("\n── 6. ПОВТОРНЫЙ finish_trip ──")
  console.log("  →", again.status, JSON.stringify(again.json).slice(0, 240))

  // ── 7. Что в базе ───────────────────────────────────────────────────────
  console.log("\n── 7. СОХРАНЕНО В БАЗЕ ──")
  const rows = await p.etaForecast.findMany({
    where: { routeId: ROUTE },
    orderBy: { calculatedAt: "asc" },
    select: {
      id: true, calculatedAt: true, recalcCount: true, initialArrivalAt: true,
      currentArrivalAt: true, totalSec: true, distanceM: true, sourcesJson: true,
      confidenceScore: true, confidenceLevel: true, stagesJson: true,
      actualArrivalAt: true, actualDrivingSec: true, actualStopsSec: true, errorMinutes: true,
    },
  })
  const initials = new Set()
  for (const f of rows) {
    let n = "нет"
    try { const sj = JSON.parse(f.stagesJson); n = Array.isArray(sj) ? sj.length : "объект" } catch {}
    initials.add(f.initialArrivalAt ? f.initialArrivalAt.getTime() : null)
    console.log("  ", f.id.slice(0, 10), "| recalc", f.recalcCount,
      "| км", f.distanceM ? +(f.distanceM / 1000).toFixed(1) : null,
      "| totalSec", f.totalSec, "| routing", f.sourcesJson,
      "| уверенность", f.confidenceScore, f.confidenceLevel,
      "| initialArrivalAt", f.initialArrivalAt ? f.initialArrivalAt.toISOString() : null,
      "| этапов", n,
      "| факт прибытия", f.actualArrivalAt ? f.actualArrivalAt.toISOString() : null,
      "| факт движения, с", f.actualDrivingSec,
      "| ошибка, мин", f.errorMinutes != null ? +f.errorMinutes.toFixed(1) : null)
  }
  console.log("  версий:", rows.length, "| уникальных initialArrivalAt:", initials.size,
    "(1 = первоначальный прогноз сохранён)")
  console.log("  recalcCount:", rows.map((f) => f.recalcCount).join(" → "))
  console.log("  initialArrivalAt из первого ответа API:", initialArrival)

  const evs = await p.routeEvent.findMany({ where: { routeId: ROUTE } })
  const byType = {}
  for (const e of evs) byType[e.type] = (byType[e.type] || 0) + 1
  console.log("\n  RouteEvent:", evs.length, JSON.stringify(byType))
  const stages = await p.routeStage.findMany({ where: { routeId: ROUTE }, orderBy: { sequence: "asc" } })
  console.log("  RouteStage:", stages.length,
    "| завершённых:", stages.filter((s) => s.status === "completed").length,
    "| с startedAt:", stages.filter((s) => s.startedAt).length,
    "| с endedAt:", stages.filter((s) => s.endedAt).length)

  const factRows = rows.filter((f) => f.actualArrivalAt)
  console.log("  прогнозов с записанным фактом:", factRows.length, "(1 = факт записан один раз)")

  await p.$disconnect()
  console.log("\n" + "=".repeat(72))
})().catch(async (e) => {
  console.error("ERR", e.message)
  await p.$disconnect()
  process.exit(1)
})
