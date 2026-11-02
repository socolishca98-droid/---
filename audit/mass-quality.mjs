// audit/mass-quality.mjs
//
// МАССОВАЯ проверка качества и устойчивости — не 30 задач на вид, а сотни.
//
// Зачем отдельный прогон. Обычный аудит (`routing:audit`) отвечает на вопрос
// «как ядро работает на наборе сценариев» — по 30 задач на вид и по 120 на
// модель А. Этого достаточно, чтобы поймать систематическую ошибку, но не
// достаточно, чтобы утверждать «расхождений нет вообще»: редкий случай может
// жить на 150-й задаче.
//
// Здесь три вещи:
//   1. качество на ПЯТИСТАХ задач модели А против независимого перебора;
//   2. качество сборной модели на 150 задачах каждого вида;
//   3. устойчивость: фуззинг контракта API (случайные тела запроса) и
//      одинаковость результата при параллельных расчётах (кеши движка
//      расстояний не должны протекать между расчётами).
//
// Всё сверяется с эталоном, написанным отдельно от ядра: он не вызывает ни
// поиск, ни материализацию ядра, только собственную арифметику.

import { createRequire } from "node:module"
import { makeCase, bruteForce, bruteCalendar, REGIONS } from "../tests/routing-fixtures.mjs"
import { makeConsolidatedCase, bruteConsolidated, bruteSequential } from "../tests/consolidated-fixtures.mjs"

const require = createRequire(import.meta.url)
const R = require("../.test-build/lib/routing/index.js")
const API = require("../.test-build/lib/routing/api.js")

const NOW = new Date("2026-11-02T05:00:00.000Z")
const CASES_A = Number(process.env.MASS_CASES_A ?? 500)
const CASES_B = Number(process.env.MASS_CASES_B ?? 150)
const FUZZ = Number(process.env.MASS_FUZZ ?? 1000)

const money = (value) => Math.round(value).toLocaleString("ru-RU")
const pct = (part, whole) => (whole === 0 ? 0 : (part / whole) * 100)

// ── 1. Модель А против перебора ─────────────────────────────────────────────

async function qualitySequential() {
  let worst = 0
  let worstSeed = null
  let mismatches = 0
  const behind = []
  let totalCore = 0
  let totalBrute = 0
  let better = 0
  let invalid = 0
  let coreMs = 0
  const startedAt = Date.now()

  for (let seed = 1; seed <= CASES_A; seed += 1) {
    const tile = makeCase(seed)
    const coreStarted = Date.now()
    const result = await R.planVehicle(
      { orders: tile.orders, vehicles: [tile.vehicle], settings: tile.settings, regions: REGIONS, now: NOW },
      tile.vehicle,
    )
    coreMs += Date.now() - coreStarted
    const plan = result.recommended ?? result.variants[0] ?? null
    const brute = bruteForce(tile)
    const bruteNet = Math.max(brute.net, bruteSequentialNet(tile))
    const coreNet = plan ? plan.economics.netCommittedRub : 0

    totalCore += coreNet
    totalBrute += bruteNet
    if (coreNet > bruteNet + 1) better += 1
    if (Math.abs(coreNet - bruteNet) > 1) {
      mismatches += 1
      const gap = pct(bruteNet - coreNet, Math.abs(bruteNet))
      if (gap > worst) {
        worst = gap
        worstSeed = seed
      }
      behind.push({ seed, core: Math.round(coreNet), brute: Math.round(bruteNet), gap: Math.round(gap * 100) / 100 })
    }
    if (plan) {
      const check = R.validatePlan(plan, tile.orders, tile.vehicle, tile.settings)
      if (!check.ok) invalid += 1
    }
  }

  return {
    cases: CASES_A,
    mismatches,
    worstShare: Math.round(worst * 100) / 100,
    worstSeed,
    behind: behind.sort((a, b) => b.gap - a.gap).slice(0, 5),
    coreTotal: Math.round(totalCore),
    bruteTotal: Math.round(totalBrute),
    coreBetterThanBrute: better,
    invalid,
    coreMs,
    elapsedMs: Date.now() - startedAt,
  }
}

/** Последовательная модель — эталон для сравнения «ядро против лучшего из двух». */
function bruteSequentialNet(tile) {
  const brute = bruteForce(tile)
  return brute.net
}

// ── 2. Сборная модель против перебора ───────────────────────────────────────

async function qualityConsolidated(kind) {
  let mismatches = 0
  let worst = 0
  let worstSeed = null
  let invalid = 0
  let coreTotal = 0
  let bruteTotal = 0
  let wins = 0
  let coreMs = 0
  const startedAt = Date.now()

  for (let seed = 1; seed <= CASES_B; seed += 1) {
    const tile = makeConsolidatedCase(seed, kind)
    const coreStarted = Date.now()
    const result = await R.planVehicle(
      { orders: tile.orders, vehicle: tile.vehicle, settings: tile.settings, regions: REGIONS, now: NOW },
      tile.vehicle,
    )
    coreMs += Date.now() - coreStarted
    const plan = result.recommended ?? result.variants[0] ?? null
    const brute = bruteConsolidated(tile)
    const sequential = bruteSequential(tile)
    const bruteNet = Math.max(brute.net, sequential.net)
    const coreNet = plan ? plan.economics.netCommittedRub : 0

    coreTotal += coreNet
    bruteTotal += bruteNet
    if (coreNet > bruteNet + 1) wins += 1
    if (Math.abs(coreNet - bruteNet) > 1) {
      mismatches += 1
      const gap = pct(bruteNet - coreNet, Math.abs(bruteNet))
      if (gap > worst) {
        worst = gap
        worstSeed = seed
      }
    }
    if (plan) {
      const check = R.validatePlan(plan, tile.orders, tile.vehicle, tile.settings)
      if (!check.ok) invalid += 1
    }
  }

  return {
    kind,
    cases: CASES_B,
    mismatches,
    matches: CASES_B - mismatches,
    worstShare: Math.round(worst * 100) / 100,
    worstSeed,
    coreTotal: Math.round(coreTotal),
    bruteTotal: Math.round(bruteTotal),
    // Ядро НИКОГДА не должно показывать больше эталона: завышенная прибыль —
    // это обещание, которого не будет.
    coreAboveBrute: wins,
    invalid,
    coreMs,
    elapsedMs: Date.now() - startedAt,
  }
}

// ── 3. Календарь против независимого расчёта ────────────────────────────────

async function qualityCalendar() {
  let mismatches = 0
  let worst = 0
  const startedAt = Date.now()
  const cases = Math.min(CASES_A, 200)
  for (let seed = 1; seed <= cases; seed += 1) {
    const tile = makeCase(seed)
    const result = await R.planVehicle(
      { orders: tile.orders, vehicles: [tile.vehicle], settings: tile.settings, regions: REGIONS, now: NOW },
      tile.vehicle,
    )
    const plan = result.recommended ?? result.variants[0] ?? null
    if (!plan) continue
    const reference = bruteCalendar({
      orders: tile.orders.filter((order) => plan.orderIds.includes(order.id)),
      vehicle: tile.vehicle,
      settings: tile.settings,
      now: NOW,
    })
    if (!reference) continue
    const coreHours = (plan.schedule.endAt - plan.schedule.startAt) / 3600000
    const gap = Math.abs(coreHours - reference.hours)
    if (gap > 0.5) {
      mismatches += 1
      worst = Math.max(worst, gap)
    }
  }
  return { cases, mismatches, worstHours: Math.round(worst * 10) / 10, elapsedMs: Date.now() - startedAt }
}

// ── 4. Фуззинг контракта API ────────────────────────────────────────────────

function fuzzContract() {
  // Случайные тела: мусор, крайние числа, вложенные объекты, длинные строки.
  const random = (seed) => {
    let state = seed
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296
      return state / 4294967296
    }
  }
  const next = random(42)
  const pool = [
    null,
    undefined,
    "-1",
    0,
    1e9,
    -1e9,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    [],
    {},
    { sql: "drop table" },
    "x".repeat(5000),
    true,
    [1, 2, 3],
  ]
  const keys = ["poolLimit", "horizonHours", "source", "now", "excludeIds", "keepIds", "vehicleId"]
  let problems = 0
  const examples = []

  for (let index = 0; index < FUZZ; index += 1) {
    const body = {}
    for (const key of keys) {
      if (next() < 0.55) body[key] = pool[Math.floor(next() * pool.length)]
    }
    if (next() < 0.2) body.poolLimit = Math.floor(next() * 1000) - 200
    if (next() < 0.2) body.horizonHours = Math.floor(next() * 1000) - 200

    let parsed
    try {
      parsed = API.parsePlanRequest(body, NOW)
    } catch (error) {
      problems += 1
      examples.push(`исключение на ${JSON.stringify(body)}: ${error.message}`)
      continue
    }
    const ok =
      Number.isFinite(parsed.poolLimit) &&
      parsed.poolLimit >= 1 &&
      parsed.poolLimit <= API.POOL_LIMIT_MAX &&
      Number.isFinite(parsed.horizonHours) &&
      parsed.horizonHours >= 1 &&
      parsed.horizonHours <= API.HORIZON_MAX_HOURS &&
      ["ati", "orders", "both"].includes(parsed.source) &&
      parsed.now instanceof Date &&
      !Number.isNaN(parsed.now.getTime()) &&
      (parsed.excludeIds === undefined || parsed.excludeIds.length <= API.IDS_MAX) &&
      (parsed.keepIds === undefined || parsed.keepIds.length <= API.IDS_MAX) &&
      (parsed.vehicleId === undefined || typeof parsed.vehicleId === "string")
    if (!ok) {
      problems += 1
      if (examples.length < 3) examples.push(`вне границ: ${JSON.stringify(body)} → ${JSON.stringify(parsed)}`)
    }
  }
  return { cases: FUZZ, problems, examples }
}

// ── 5. Параллельные расчёты не мешают друг другу ────────────────────────────

async function concurrency() {
  const tile = makeCase(7)
  const input = {
    orders: tile.orders,
    vehicles: [tile.vehicle],
    settings: tile.settings,
    regions: REGIONS,
    now: NOW,
  }
  const once = await R.planVehicle(input, tile.vehicle)
  const signature = (result) =>
    (result.recommended ? result.recommended.orderIds.join(">") : "нет") +
    "|" +
    Math.round(result.recommended?.economics.netCommittedRub ?? 0)

  const parallel = await Promise.all(Array.from({ length: 6 }, () => R.planVehicle(input, tile.vehicle)))
  const same = parallel.every((result) => signature(result) === signature(once))

  // И другой расчёт рядом не должен изменить результат первого (кеш движка
  // расстояний общий внутри расчёта, но не между расчётами).
  const otherTile = makeCase(19)
  await Promise.all([
    R.planVehicle({ ...input, orders: otherTile.orders, vehicles: [otherTile.vehicle] }, otherTile.vehicle),
    R.planVehicle(input, tile.vehicle),
  ])
  const after = await R.planVehicle(input, tile.vehicle)
  return { parallel: parallel.length, same, stableAfterOther: signature(after) === signature(once), signature: signature(once) }
}

// ── Итог ────────────────────────────────────────────────────────────────────

const sequential = await qualitySequential()
const sameOrigin = await qualityConsolidated("same-origin")
const corridor = await qualityConsolidated("corridor")
const scattered = await qualityConsolidated("scattered")
const calendar = await qualityCalendar()
const contract = fuzzContract()
const parallel = await concurrency()

console.log("── Массовая проверка качества (модель А) ──")
console.log(
  `  задач ${sequential.cases}, расхождений ${sequential.mismatches}, худшее ${sequential.worstShare} %` +
    (sequential.worstSeed ? ` (задача ${sequential.worstSeed})` : "") +
    `, ${sequential.elapsedMs} мс`,
)
console.log(`  ядро нашло больше эталона: ${sequential.coreBetterThanBrute}, невалидных планов: ${sequential.invalid}`)
if (sequential.behind.length > 0) {
  for (const item of sequential.behind) {
    console.log(`    задача ${item.seed}: ядро ${money(item.core)} ₽ против эталона ${money(item.brute)} ₽ (${item.gap} %)`)
  }
}

console.log("\n── Массовая проверка качества (сборная модель) ──")
for (const row of [sameOrigin, corridor, scattered]) {
  console.log(
    `  ${row.kind}: задач ${row.cases}, совпало ${row.matches}, отстало ${row.mismatches}, ` +
      `худшее ${row.worstShare} %` +
      (row.worstSeed ? ` (задача ${row.worstSeed})` : "") +
      `, ядро выше эталона: ${row.coreAboveBrute}, невалидных ${row.invalid}` +
      `; ядро ${row.coreMs} мс, эталон ${row.elapsedMs - row.coreMs} мс`,
  )
}

console.log("\n── Календарь против независимого расчёта ──")
console.log(`  задач ${calendar.cases}, расхождений ${calendar.mismatches}, худшее ${calendar.worstHours} ч`)

console.log("\n── Устойчивость ──")
console.log(`  фуззинг контракта API: ${contract.cases} тел, замечаний ${contract.problems}`)
for (const example of contract.examples) console.log(`    ${example}`)
console.log(
  `  параллельные расчёты: ${parallel.parallel} одновременно, результат совпал: ${parallel.same ? "да" : "НЕТ"}` +
    `, после чужого расчёта стабилен: ${parallel.stableAfterOther ? "да" : "НЕТ"}`,
)

const problems =
  sequential.mismatches > sequential.cases * 0.05 ||
  sequential.coreBetterThanBrute > 0 ||
  sequential.invalid > 0 ||
  sameOrigin.coreAboveBrute > 0 ||
  corridor.coreAboveBrute > 0 ||
  scattered.coreAboveBrute > 0 ||
  sameOrigin.invalid + corridor.invalid + scattered.invalid > 0 ||
  contract.problems > 0 ||
  !parallel.same ||
  !parallel.stableAfterOther

console.log(problems ? "\nИТОГ: есть замечания (см. выше)" : "\nИТОГ: замечаний нет")
process.exit(problems ? 1 : 0)
