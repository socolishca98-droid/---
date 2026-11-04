// scripts/routing-real-osrm.mjs
//
// ЭТАП 6 — приёмка на ЖИВОМ маршрутизаторе.
//
// Что проверяется (и чем):
//   1. движок расстояний действительно получает дорожные километры от OSRM;
//   2. НЕЗАВИСИМАЯ сверка: те же пары считаются другим сервисом (Valhalla —
//      другой код, другие данные о скорости, другой профиль). Расхождение
//      больше допуска — дефект, а не «так бывает»;
//   3. чем оценка «прямая × 1,2» отличается от дороги — чтобы было видно, чего
//      стоило бы оставить экономику на догадке;
//   4. постоянный кэш: второй прогон не ходит в сеть и помечает участки как
//      взятые из кэша;
//   5. падение маршрутизатора понижает точность, но не роняет расчёт.

import { createRequire } from "node:module"
import { writeFileSync } from "node:fs"

const require = createRequire(import.meta.url)
const D = require("/home/user/repo/.test-build/lib/routing/distance.js")

const arg = (name, fallback) => {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}
const jsonPath = arg("json", null)
const TOLERANCE_PCT = Number(arg("tolerance", 15))

const CITIES = [
  ["Ярославль", 57.6261, 39.8845, "Ярославская область"],
  ["Москва", 55.7558, 37.6173, "Москва"],
  ["Казань", 55.7963, 49.1088, "Республика Татарстан"],
  ["Рыбинск", 58.0446, 38.8428, "Ярославская область"],
  ["Краснодар", 45.0355, 38.9753, "Краснодарский край"],
  ["Сочи", 43.5855, 39.7231, "Краснодарский край"],
  ["Екатеринбург", 56.8389, 60.6057, "Свердловская область"],
  ["Симферополь", 44.9521, 34.1024, "Республика Крым"],
]

const place = ([city, lat, lng, region]) => ({
  id: city.toLowerCase(),
  city,
  region,
  point: { lat, lng },
  timeZone: null,
})

const PAIRS = [
  [0, 1],
  [0, 3],
  [1, 2],
  [1, 4],
  [4, 5],
  [6, 1],
  [7, 5],
  [0, 6],
]

/** Независимый источник: Valhalla, профиль auto. */
async function valhallaKm(a, b) {
  const body = JSON.stringify({
    locations: [
      { lat: a.point.lat, lon: a.point.lng },
      { lat: b.point.lat, lon: b.point.lng },
    ],
    costing: "auto",
    units: "kilometers",
  })
  const started = Date.now()
  try {
    const response = await fetch(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(body)}`, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Loginex/1.0 (stage 6 verification)" },
    })
    if (!response.ok) return { km: null, error: `HTTP ${response.status}`, ms: Date.now() - started }
    const data = await response.json()
    const km = data?.trip?.summary?.length
    return {
      km: typeof km === "number" ? km : null,
      error: typeof km === "number" ? null : "нет summary.length",
      ms: Date.now() - started,
    }
  } catch (error) {
    return { km: null, error: String(error?.name ?? error), ms: Date.now() - started }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  tolerancePct: TOLERANCE_PCT,
  pairs: [],
  cache: null,
  outage: null,
  summary: {},
}

function memoryStore() {
  const rows = new Map()
  return {
    rows,
    load: async (keys) =>
      keys
        .map((key) => rows.get(`${key.from}|${key.to}|${key.mode}`))
        .filter(Boolean)
        .map((row) => ({ ...row })),
    save: async (list) => {
      for (const row of list) rows.set(`${row.from}|${row.to}|${row.mode}`, row)
    },
  }
}

// ── 1–3. Живой OSRM + независимая сверка ────────────────────────────────────
const store = memoryStore()
const engine = new D.DistanceEngine({
  osrmUrl: null,
  fallbackEndpoints: [{ name: "osrm-public", url: "https://router.project-osrm.org" }],
  regions: [],
  store,
  requestBudget: 200,
})

const pairs = PAIRS.map(([from, to]) => ({
  a: place(CITIES[from]),
  b: place(CITIES[to]),
  mode: "deadhead",
}))
await engine.prefetch(pairs)

let worse = 0
for (const pair of pairs) {
  const segment = engine.segment(pair.a, pair.b, "deadhead")
  const estimate = engine.estimate(pair.a, pair.b, "deadhead")
  const independent = await valhallaKm(pair.a, pair.b)
  const diffPct =
    independent.km && segment.source === "osrm"
      ? Number((((segment.km - independent.km) / independent.km) * 100).toFixed(1))
      : null
  const estimateErrorPct = independent.km
    ? Number((((estimate.km - independent.km) / independent.km) * 100).toFixed(1))
    : null
  const ok = diffPct === null ? false : Math.abs(diffPct) <= TOLERANCE_PCT
  if (!ok) worse += 1
  report.pairs.push({
    from: pair.a.city,
    to: pair.b.city,
    osrmKm: Number(segment.km.toFixed(1)),
    osrmMinutes: segment.osrmHours ? Math.round(segment.osrmHours * 60) : null,
    source: segment.source,
    provider: segment.provider,
    valhallaKm: independent.km,
    valhallaError: independent.error,
    diffPct,
    withinTolerance: ok,
    estimateKm: estimate.km,
    estimateErrorPct,
  })
  console.log(
    `${pair.a.city} → ${pair.b.city}: OSRM ${segment.km.toFixed(1)} км (${segment.provider}), ` +
      `Valhalla ${independent.km === null ? "—" : independent.km.toFixed(0)} км, ` +
      `расхождение ${diffPct ?? "—"} %; оценка «прямая×1,2» ${estimate.km} км (${estimateErrorPct ?? "—"} %)`,
  )
  await new Promise((resolve) => setTimeout(resolve, 400))
}

// ── 4. Постоянный кэш: второй прогон без сети ───────────────────────────────
const second = new D.DistanceEngine({
  osrmUrl: null,
  fallbackEndpoints: [{ name: "osrm-public", url: "https://router.project-osrm.org" }],
  regions: [],
  store,
  requestBudget: 200,
})
await second.prefetch(pairs)
const fromCache = pairs.every((pair) => second.segment(pair.a, pair.b, "deadhead").fromCache === true)
report.cache = {
  storeRows: store.rows.size,
  requestsSecondRun: second.osrmRequests,
  allFromCache: fromCache,
}
console.log(
  `\nкэш: записей ${store.rows.size}, во втором прогоне запросов к сети ${second.osrmRequests}, ` +
    `всё из кэша: ${fromCache ? "да" : "НЕТ"}`,
)

// ── 5. Падение маршрутизатора: точность понижается, расчёт живёт ────────────
const broken = new D.DistanceEngine({
  osrmUrl: "http://osrm-own.invalid:5000",
  fallbackEndpoints: [{ name: "osrm-public", url: "https://router.project-osrm.org" }],
  regions: [],
  requestBudget: 8,
})
await broken.prefetch(pairs.slice(0, 2))
const brokenSegment = broken.segment(pairs[0].a, pairs[0].b, "deadhead")
report.outage = {
  ownEndpoint: "http://osrm-own.invalid:5000",
  fellBackTo: brokenSegment.provider,
  source: brokenSegment.source,
  confidence: brokenSegment.confidence,
  stats: broken.routerStats,
}
console.log(
  `\nмёртвая своя точка входа: ответ пришёл от ${brokenSegment.provider}, ` +
    `источник ${brokenSegment.source}, достоверность ${brokenSegment.confidence}`,
)

report.summary = {
  pairs: report.pairs.length,
  measured: report.pairs.filter((item) => item.source === "osrm").length,
  withinTolerance: report.pairs.filter((item) => item.withinTolerance).length,
  outsideTolerance: worse,
  minEstimateErrorPct: Math.min(...report.pairs.map((item) => item.estimateErrorPct ?? 0)),
  maxEstimateErrorPct: Math.max(...report.pairs.map((item) => item.estimateErrorPct ?? 0)),
}

console.log(
  `\nитог: измерено ${report.summary.measured} из ${report.summary.pairs}, ` +
    `в допуске ${TOLERANCE_PCT} % — ${report.summary.withinTolerance}, вне допуска — ${worse}`,
)
console.log(
  `ошибка оценки «прямая×1,2»: от ${report.summary.minEstimateErrorPct} % до ${report.summary.maxEstimateErrorPct} %`,
)

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  console.log(`→ ${jsonPath}`)
}
if (worse > 0 || !fromCache) process.exitCode = 1
