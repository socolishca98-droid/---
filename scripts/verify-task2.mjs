#!/usr/bin/env node
/**
 * Автоматическая проверка задачи 2 (схема данных) — статическая часть.
 *
 * Сервер и база НЕ нужны: скрипт проверяет схему Prisma и код.
 * Данные проверяются отдельно:  npm run db:migrate-task2 -- --check
 * Логика рейсов:                 npm test
 *
 * Запуск:  npm run verify:task2
 * Код возврата: 0 — всё чисто, 1 — есть провалы.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")

const results = []

function check(name, fn) {
  try {
    const note = fn()
    results.push({ name, ok: true, note: note || "" })
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ""}`)
  } catch (e) {
    results.push({ name, ok: false, note: e.message })
    console.log(`  ✗ ${name}\n      → ${e.message}`)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function read(rel) {
  const full = path.join(ROOT, rel)
  assert(existsSync(full), `нет файла ${rel}`)
  return readFileSync(full, "utf8")
}

/** Рекурсивно собирает .ts/.tsx файлы, пропуская служебные каталоги. */
function walk(dir, out = []) {
  const skip = new Set([
    "node_modules", ".next", ".git", ".test-build", "dist", "build", "coverage",
  ])
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (p) => path.relative(ROOT, p)

/**
 * Достаёт тела вызовов Prisma-делегатов с балансировкой скобок:
 *   prisma.vehicle.update({ ... })  →  содержимое между внешними скобками.
 * Так проверка смотрит на реальные обращения к БД, а не на типы, DTO
 * и ответы API, где те же имена полей вполне законны.
 */
function extractCalls(text, delegate, methods) {
  const re = new RegExp(
    `\\b(?:prisma|tx|client|db)\\.${delegate}\\.(?:${methods.join("|")})\\s*\\(`,
    "g",
  )
  const out = []
  let m
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1
    let depth = 0
    let i = open
    for (; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === "(") depth += 1
      else if (ch === ")") {
        depth -= 1
        if (depth === 0) break
      }
    }
    out.push({
      body: text.slice(open + 1, i),
      line: text.slice(0, m.index).split("\n").length,
      method: m[0].replace(/\s*\($/, ""),
    })
  }
  return out
}

const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert"]

/**
 * Возвращает содержимое `data: { ... }` из тела вызова (только верхний уровень).
 * Фильтры в `where: { vehicleId }` — это чтение, а не запись связи,
 * поэтому в проверку они попадать не должны.
 */
function dataSection(body) {
  const chunks = []
  let depth = 0
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === "{" || ch === "(" || ch === "[") {
      depth += 1
      continue
    }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1
      continue
    }
    if (depth > 1) continue
    if (!body.startsWith("data:", i)) continue
    const prev = body.slice(0, i).trimEnd()
    if (prev.length > 0 && !/[{(,]$/.test(prev)) continue

    const open = body.indexOf("{", i)
    if (open < 0) continue
    let inner = 0
    let j = open
    for (; j < body.length; j += 1) {
      if (body[j] === "{") inner += 1
      else if (body[j] === "}") {
        inner -= 1
        if (inner === 0) break
      }
    }
    chunks.push(body.slice(open + 1, j))
    i = j
  }
  return chunks.join("\n")
}

console.log("\n═══ Задача 2: схема данных ═══\n")

// ══════════════════════════════ 1. Схема Prisma ══════════════════════════════

console.log("1. Схема prisma/schema.prisma")

const schema = read("prisma/schema.prisma")

function modelBlock(name) {
  const re = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m")
  const m = schema.match(re)
  assert(m, `в схеме нет модели ${name}`)
  return m[1]
}

check("модель Route существует", () => {
  const body = modelBlock("Route")
  for (const field of ["status", "driverId", "vehicleId", "startedAt", "completedAt", "orders"]) {
    assert(body.includes(field), `в Route нет поля ${field}`)
  }
  return "status, driver, vehicle, времена, заказы"
})

check("у Route настоящие отношения, а не строки", () => {
  const body = modelBlock("Route")
  assert(/driver\s+Driver\?\s+@relation/.test(body), "Route.driver без @relation")
  assert(/vehicle\s+Vehicle\?\s+@relation/.test(body), "Route.vehicle без @relation")
  assert(/orders\s+Order\[\]/.test(body), "нет обратной связи Route.orders")
  assert(/onDelete: SetNull/.test(body), "при удалении водителя/машины рейс должен оставаться (SetNull)")
  return "Driver?/Vehicle? c onDelete: SetNull, Order[] обратно"
})

check("заказ привязан к рейсу внешним ключом", () => {
  const body = modelBlock("Order")
  assert(/route\s+Route\?\s+@relation\(fields: \[routeId\]/.test(body), "Order.route без @relation на routeId")
  assert(/driver\s+Driver\?\s+@relation/.test(body), "Order.driver без @relation")
  assert(/vehicle\s+Vehicle\?\s+@relation/.test(body), "Order.vehicle без @relation")
  return "Order.routeId → Route.id"
})

check("связь «водитель ↔ машина» хранится один раз", () => {
  const vehicle = modelBlock("Vehicle")
  assert(!/^\s*driverId\s/m.test(vehicle), "Vehicle.driverId всё ещё в схеме — связь дублируется")
  assert(/drivers\s+Driver\[\]/.test(vehicle), "нет обратной связи Vehicle.drivers")
  const driver = modelBlock("Driver")
  assert(/vehicle\s+Vehicle\?\s+@relation\(fields: \[vehicleId\]/.test(driver), "Driver.vehicle без @relation")
  return "источник правды — Driver.vehicleId"
})

check("телефон водителя уникальный (это его логин)", () => {
  const driver = modelBlock("Driver")
  const phoneLine = driver.split("\n").find((l) => /^\s*phone\s/.test(l)) || ""
  assert(phoneLine.includes("@unique"), `Driver.phone без @unique: ${phoneLine.trim()}`)
  return phoneLine.trim()
})

check("каждая модель с routeId связана с Route", () => {
  for (const name of ["RouteStage", "RouteEvent"]) {
    const body = modelBlock(name)
    assert(/route\s+Route\s+@relation/.test(body), `${name}.route без @relation`)
    assert(/onDelete: Cascade/.test(body), `${name} должен удаляться вместе с рейсом`)
  }
  return "RouteStage, RouteEvent → Cascade"
})

// ═══════════════════════════ 2. Зачистка кода от старых полей ═══════════════════════════

console.log("\n2. Код не использует удалённые поля")

const files = walk(ROOT).filter((f) => !/scripts\/verify-/.test(f))
const docs = new Map(files.map((f) => [f, readFileSync(f, "utf8")]))

check("никто не читает и не пишет Vehicle.driverId в базе", () => {
  const bad = []
  for (const [file, text] of docs) {
    for (const call of extractCalls(text, "vehicle", ["findUnique", "findFirst", "findMany", "count", ...WRITE_METHODS])) {
      if (/\bdriverId\b/.test(call.body)) {
        bad.push(`${rel(file)}:${call.line}: ${call.method}(... driverId ...)`)
      }
    }
  }
  assert(bad.length === 0, `обращения к несуществующей колонке Vehicle.driverId:\n      ${bad.join("\n      ")}`)
  return "ни один запрос к Vehicle не упоминает driverId"
})

check("связь и кэш машины пишутся только через lib/fleet/assignment", () => {
  const allowed = new Set([
    "lib/fleet/assignment.ts",   // единая точка записи
    "scripts/migrate-task2.ts",  // перенос данных
  ])
  const bad = []
  for (const [file, text] of docs) {
    const r = rel(file).split(path.sep).join("/")
    if (allowed.has(r)) continue
    for (const call of extractCalls(text, "driver", WRITE_METHODS)) {
      const data = dataSection(call.body)
      const hit = data.match(/\b(vehicleId|vehiclePlate|vehicleType)\s*:/)
      if (hit) bad.push(`${r}:${call.line}: ${call.method}(data: { ${hit[1]} ... })`)
    }
  }
  assert(
    bad.length === 0,
    `запись связи/кэша в обход единого пути:\n      ${bad.join("\n      ")}`,
  )
  return "Driver.vehicleId + vehiclePlate/vehicleType меняются в одном месте"
})

check("события рейса пишутся через logRouteEvent", () => {
  const bad = []
  for (const [file, text] of docs) {
    const r = rel(file).split(path.sep).join("/")
    if (r === "lib/routes/service.ts") continue // там и живёт logRouteEvent
    if (/routeEvent\s*\.\s*create/.test(text)) bad.push(r)
  }
  assert(bad.length === 0, `прямой routeEvent.create остался в:\n      ${bad.join("\n      ")}`)
  return "иначе FK на Route может не пустить событие"
})

check("routeId в заказах пишется только вместе со строкой Route", () => {
  const bad = []
  for (const [file, text] of docs) {
    const r = rel(file).split(path.sep).join("/")
    if (!r.startsWith("app/api/") && !r.startsWith("app/m/")) continue
    for (const call of extractCalls(text, "order", WRITE_METHODS)) {
      const hit = call.body.match(/\brouteId\s*:\s*([^,\n]+)/)
      if (!hit) continue
      if (/null/.test(hit[1])) continue // снятие с рейса — законно
      const createsRoute = /(?:prisma|tx|client)\.route\.create|ensureRouteRow/.test(text)
      if (!createsRoute) bad.push(`${r}:${call.line}: routeId: ${hit[1].trim().slice(0, 40)}`)
    }
  }
  assert(
    bad.length === 0,
    `заказ получает routeId без строки Route (FK упадёт после db push):\n      ${bad.join("\n      ")}`,
  )
  return "рейс создаётся раньше, чем в него кладут заказы"
})

// ═══════════════════════════ 3. Инфраструктура задачи 2 ═══════════════════════════

console.log("\n3. Файлы и команды")

check("есть доменная модель, сервис и единый путь записи", () => {
  for (const f of [
    "lib/routes/model.ts",
    "lib/routes/service.ts",
    "lib/fleet/assignment.ts",
    "scripts/migrate-task2.ts",
    "prisma/sql/2026-09-22-route-model.sql",
    "tests/routes-model.test.mjs",
  ]) {
    assert(existsSync(path.join(ROOT, f)), `нет ${f}`)
  }
  return "6 файлов на месте"
})

check("модель рейсов покрыта тестами", () => {
  const tsconfig = JSON.parse(read("tests/tsconfig.json"))
  const include = (tsconfig.include || []).map((x) => x.replace("../", ""))
  assert(include.includes("lib/routes/model.ts"), "lib/routes/model.ts не компилируется для тестов")
  const tests = read("tests/routes-model.test.mjs")
  const count = (tests.match(/^test\(/gm) || []).length
  assert(count >= 20, `мало тестов: ${count}`)
  return `${count} тестов`
})

check("в package.json есть команды применения схемы и миграции", () => {
  const pkg = JSON.parse(read("package.json"))
  for (const name of ["db:push", "db:generate", "db:sql:routes", "db:migrate-task2"]) {
    assert(pkg.scripts?.[name], `нет скрипта ${name}`)
  }
  return "db:push · db:sql:routes · db:migrate-task2"
})

check("снимок связей не попадёт в git", () => {
  const ignore = read(".gitignore")
  assert(ignore.includes(".task2-vehicle-links.json"), "prisma/.task2-vehicle-links.json не в .gitignore")
  return "prisma/.task2-vehicle-links.json игнорируется"
})

check("фреймворк без известных критичных уязвимостей", () => {
  const pkg = JSON.parse(read("package.json"))
  const next = String(pkg.dependencies?.next || "")
  const m = next.replace(/[^0-9.]/g, "").split(".").map(Number)
  const version = m[0] * 1000 + (m[1] || 0) * 10 + (m[2] || 0)
  // CVE-2025-66478 (RCE) + CVE-2025-55184/67779 (DoS) + CVE-2025-55183 (утечка кода):
  // для ветки 16.0.x исправлено в 16.0.10, для 16.3.x — в 16.3.3
  const fixed = version >= 16 * 1000 + 3 * 10 + 3 || (m[0] === 16 && m[1] === 0 && (m[2] || 0) >= 10)
  assert(fixed, `next ${next} — нужна версия не ниже 16.3.3 (или 16.0.10 в ветке 16.0.x)`)
  return `next ${next}, react ${pkg.dependencies?.react}`
})

// ══════════════════════════════════ Итог ══════════════════════════════════

const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok)

console.log("\n" + "─".repeat(64))
console.log(`Проверок пройдено: ${passed} · провалено: ${failed.length}`)

if (failed.length) {
  console.log("\nПровалы:")
  for (const item of failed) console.log(`  ✗ ${item.name}\n      → ${item.note}`)
  console.log("")
  process.exit(1)
}

console.log("\nСхема и код согласованы. Дальше:")
console.log("  1. npm run db:push                     — применить схему к базе")
console.log("  2. npm run db:generate                 — перегенерировать клиент")
console.log("  3. npm run db:migrate-task2 -- --check — диагностика данных")
console.log("  4. npm run db:migrate-task2            — перенос данных\n")
process.exit(0)
