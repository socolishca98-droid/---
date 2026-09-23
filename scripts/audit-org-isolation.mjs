// scripts/audit-org-isolation.mjs
//
// Статический аудит изоляции данных по организациям.
//
//   npm run audit:orgs                — отчёт по всем API-роутам
//   npm run audit:orgs -- --json      — то же в JSON (для скриптов)
//   npm run audit:orgs -- --markdown  — пофайловая таблица (для отчёта пользователю)
//
// Что проверяется в каждом app/**/route.ts:
//   1. есть ли guard авторизации (requireStaff / requireDriver / requireAnySession
//      или адаптеры requireStaffAuth / requireDriverAuth / getStaffSession);
//   2. берётся ли организация из сессии (requireOrganization из lib/org);
//   3. каждый вызов prisma.<модель>.<метод>(…) бизнес-таблицы — содержит ли он
//      organizationId (в where для чтения, в data для записи);
//   4. сырые запросы ($queryRaw/$executeRaw/$transaction) — помечаются на ручной разбор.
//
// Общие таблицы (GeoCache, AtiCache, AtiSession, Session, Organization, InviteCode)
// по организации не фильтруются — они либо технические, либо сами являются
// границей видимости.
//
// Аудит намеренно консервативный: «не вижу organizationId в вызове» = нарушение,
// даже если запрос на самом деле безопасен (например, идёт по id, уже
// проверенному на принадлежность организации). Такие места помечаются комментарием
// `// org-audit: ok — <причина>` прямо в коде, и аудит их пропускает.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const ARGS = process.argv.slice(2)
const AS_JSON = ARGS.includes("--json")
const AS_MARKDOWN = ARGS.includes("--markdown")

/** Бизнес-таблицы: у каждой записи есть organizationId. */
const ORG_MODELS = new Set([
  "user",
  "driver",
  "vehicle",
  "order",
  "route",
  "routeStage",
  "routeEvent",
  "photo",
  "maintenanceLog",
  "chatMessage",
  "notification",
  "sosAlert",
  "driverShift",
  "shiftEvent",
  "fleetSettings",
  "atiScanConfig",
  "auditLog",
])

/** Общие и служебные таблицы: фильтрация по организации не нужна. */
const SHARED_MODELS = new Set([
  "geoCache",
  "atiCache",
  "atiSession",
  "session",
  "organization",
  "inviteCode",
])

const GUARDS = [
  "requireStaff(",
  "requireDriver(",
  "requireAnySession(",
  "requireStaffAuth(",
  "requireDriverAuth(",
  "requireAnyAuth(",
  "getStaffSession(",
  "getDriverSession(",
]

/** Маршруты, где организация неприменима (вход, выдача токена, здоровье). */
const EXEMPT_FILES = new Set([
  "app/api/auth/login/route.ts",
  "app/api/auth/register/route.ts",
  "app/api/auth/logout/route.ts",
  "app/api/auth/session/route.ts",
  "app/api/auth/csrf/route.ts",
  "app/api/auth/change-password/route.ts",
  "app/api/m/login/route.ts",
  "app/api/health/route.ts",
  "app/api/docs/route.ts",
])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) walk(full, out)
    else if (entry === "route.ts") out.push(full)
  }
  return out
}

/** Извлекает вызовы prisma.<model>.<method>(…) с полным текстом аргументов. */
function findPrismaCalls(source) {
  const calls = []
  const re = /prisma\.(\w+)\.(\w+)\s*\(/g
  let match
  while ((match = re.exec(source))) {
    const model = match[1]
    const method = match[2]
    let depth = 1
    let index = re.lastIndex
    while (index < source.length && depth > 0) {
      const char = source[index]
      if (char === "(") depth++
      else if (char === ")") depth--
      else if (char === '"' || char === "'" || char === "`") {
        const quote = char
        index++
        while (index < source.length && source[index] !== quote) {
          if (source[index] === "\\") index++
          index++
        }
      }
      index++
    }
    const argsText = source.slice(re.lastIndex, index - 1)
    const line = source.slice(0, match.index).split("\n").length
    calls.push({ model, method, argsText, line })
  }
  return calls
}

/** Комментарий-исключение рядом с вызовом: `// org-audit: ok — причина`. */
function hasExemption(source, line) {
  const lines = source.split("\n")
  const window = lines.slice(Math.max(0, line - 2), line + 2)
  return window.some((text) => text.includes("org-audit: ok"))
}

function analyze(file) {
  const source = readFileSync(file, "utf8")
  const path = relative(ROOT, file)
  const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)].map(
    (m) => m[1],
  )
  const guard = GUARDS.find((g) => source.includes(g)) || null
  const hasOrgContext =
    source.includes("requireOrganization(") ||
    source.includes("requireStaffOrganization(") ||
    source.includes("requireDriverOrganization(")
  const hasCronSecret = source.includes("CRON_SECRET")
  const calls = findPrismaCalls(source)

  const violations = []
  const raw = []

  for (const call of calls) {
    if (call.model === "$queryRaw" || call.model === "$executeRaw" || call.model === "$transaction") {
      // prisma.$transaction(async (tx) => …) — модели внутри не видны этим регэкспом
      raw.push(`строка ${call.line}: prisma.${call.model}.${call.method} — проверить вручную`)
      continue
    }
    if (call.model.startsWith("$")) continue
    if (SHARED_MODELS.has(call.model)) continue
    if (!ORG_MODELS.has(call.model)) {
      raw.push(`строка ${call.line}: неизвестная модель prisma.${call.model} — проверить вручную`)
      continue
    }
    if (call.argsText.includes("organizationId")) continue
    if (hasExemption(source, call.line)) continue
    violations.push(
      `строка ${call.line}: prisma.${call.model}.${call.method}(…) без organizationId`,
    )
  }

  // tx-колбэки внутри $transaction: ищем обращения tx.<model>
  const txRe = /\btx\.(\w+)\.(\w+)\s*\(/g
  let txMatch
  while ((txMatch = txRe.exec(source))) {
    const model = txMatch[1]
    if (!ORG_MODELS.has(model)) continue
    let depth = 1
    let index = txRe.lastIndex
    while (index < source.length && depth > 0) {
      const char = source[index]
      if (char === "(") depth++
      else if (char === ")") depth--
      index++
    }
    const argsText = source.slice(txRe.lastIndex, index - 1)
    const line = source.slice(0, txMatch.index).split("\n").length
    if (argsText.includes("organizationId")) continue
    if (hasExemption(source, line)) continue
    violations.push(`строка ${line}: tx.${model}.${txMatch[2]}(…) без organizationId`)
  }

  const exempt = EXEMPT_FILES.has(path)

  return {
    path,
    handlers,
    guard,
    hasOrgContext,
    hasCronSecret,
    prismaCalls: calls.length,
    orgModels: calls.filter((c) => ORG_MODELS.has(c.model)).length,
    // какие бизнес-модели трогает роут (для пофайлового отчёта)
    models: [...new Set(calls.filter((c) => ORG_MODELS.has(c.model)).map((c) => c.model))],
    // В освобождённых роутах (вход, регистрация, смена своего пароля) запросы
    // намеренно глобальные: организация там ещё неизвестна или не применима.
    violations: exempt ? [] : violations,
    raw: exempt ? [] : raw,
    exempt,
  }
}

const files = walk(join(ROOT, "app")).sort()
const reports = files.map(analyze)

const problems = reports.filter(
  (r) => !r.exempt && (r.violations.length > 0 || (!r.guard && !r.hasCronSecret)),
)

if (AS_JSON) {
  console.log(JSON.stringify(reports, null, 2))
  process.exit(problems.length > 0 ? 1 : 0)
}

if (AS_MARKDOWN) {
  const rows = reports.map((r) => {
    const verdict = r.exempt
      ? "общий (организация не применяется)"
      : r.hasCronSecret && !r.orgModels
        ? "служебный (cron-секрет)"
        : r.violations.length > 0
          ? `**НАРУШЕНИЯ: ${r.violations.length}**`
          : "изолирован"
    return [
      "`" + r.path + "`",
      r.handlers.length ? r.handlers.join(", ") : "—",
      r.guard ? "`" + r.guard.replace(/\($/, "") + "`" : "—",
      r.exempt ? "—" : r.hasOrgContext ? "да" : "нет",
      String(r.orgModels),
      r.models.length ? r.models.map((m) => "`" + m + "`").join(", ") : "—",
      verdict,
    ]
  })
  console.log("| Файл | Методы | Гард доступа | Организация из сессии | Бизнес-запросов | Модели | Статус |")
  console.log("|---|---|---|---|---|---|---|")
  for (const row of rows) console.log("| " + row.join(" | ") + " |")
  process.exit(problems.length > 0 ? 1 : 0)
}

console.log("═".repeat(78))
console.log("АУДИТ ИЗОЛЯЦИИ ДАННЫХ ПО ОРГАНИЗАЦИЯМ")
console.log("═".repeat(78))
console.log(`API-роутов проверено: ${reports.length}`)
console.log(
  `С контекстом организации (requireOrganization): ${reports.filter((r) => r.hasOrgContext).length}`,
)
console.log(`Роутов с нарушениями: ${problems.length}`)

for (const report of reports) {
  const status = report.exempt
    ? "—"
    : report.violations.length === 0 && (report.guard || report.hasCronSecret)
      ? "✓"
      : "✗"
  console.log("")
  console.log(
    `${status} ${report.path}  [${report.handlers.join(",") || "нет обработчиков"}]` +
      (report.exempt ? "  (организация не применяется)" : ""),
  )
  console.log(
    `    guard: ${report.guard || (report.hasCronSecret ? "CRON_SECRET" : "НЕТ")}` +
      ` · организация из сессии: ${report.hasOrgContext ? "да" : "нет"}` +
      ` · вызовов prisma: ${report.prismaCalls} (бизнес-таблиц: ${report.orgModels})`,
  )
  for (const violation of report.violations) console.log(`    ✗ ${violation}`)
  for (const item of report.raw) console.log(`    ? ${item}`)
}

console.log("")
console.log("═".repeat(78))
if (problems.length === 0) {
  console.log("Нарушений нет: все бизнес-запросы ограничены организацией из сессии.")
} else {
  console.log(`Требуют правки: ${problems.length} файлов`)
  for (const problem of problems) console.log(`  • ${problem.path}`)
}
console.log("═".repeat(78))

process.exit(problems.length > 0 ? 1 : 0)
