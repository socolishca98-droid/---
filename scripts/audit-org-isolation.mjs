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
//   4. сырые запросы ($queryRaw/$executeRaw/$transaction) — помечаются на ручной разбор;
//   5. организация НЕ должна приходить из запроса: любое organizationId, взятое
//      из body/query/params/заголовков, — нарушение (требование задачи:
//      «organizationId пользователя берётся из проверенного токена сессии»);
//   6. массовое присваивание: спред тела запроса внутри data у create/update
//      (`...body`, `...other`, `...payload`…) — нарушение. Именно так в
//      PATCH /api/orders/[id] можно было прислать organizationId и перенести
//      свой заказ в чужую организацию. Поля нужно перечислять явно.
//
// Общие таблицы (GeoCache, AtiCache, AtiSession, Session, Organization, InviteCode)
// по организации не фильтруются — они либо технические, либо сами являются
// границей видимости.
//
// Второй уровень — сервисный слой lib/**: роуты ходят в базу не только напрямую,
// но и через lib/routes/service, lib/fleet/assignment, lib/audit, lib/organizations,
// lib/invites, lib/auth/*. Такие модули проверяются тем же правилом: каждый вызов
// бизнес-модели (prisma|db|client|tx).<model>.<method>(…) обязан содержать
// organizationId или маркер `// org-audit: ok — причина`. Без этого уровня
// неизолированный запрос легко спрятать в библиотеке.
//
// Аудит намеренно консервативный: «не вижу organizationId в вызове» = нарушение,
// даже если запрос на самом деле безопасен (например, идёт по id, уже
// проверенному на принадлежность организации). Такие места помечаются комментарием
// прямо в коде. Маркеров два:
//
//   // org-audit: ok — <причина>
//       Цель проверена на принадлежность организации ВЫШЕ в этом же блоке кода.
//       Аудит это ПРОВЕРЯЕТ: ищет до вызова чтение одной записи
//       (findFirst/findUnique) со scopedWhere/scopedByOrg/organizationId.
//       Маркер без такого чтения = нарушение: иначе «ok» можно поставить на глаз.
//       (Так в PATCH /api/vehicles/[id] жил запрос, меняющий чужую машину.)
//
//   // org-audit: manual — <причина>
//       Проверено человеком, автоматически подтвердить нельзя (вход по
//       глобальному логину, запись, созданная этой же транзакцией, общие кэши).
//       Аудит такие места не прячет: выводит отдельным списком в отчёте.
//
// Оба маркера требуют указания причины после «—».

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

/**
 * Извлекает вызовы <клиент>.<model>.<method>(…) с полным текстом аргументов.
 * clientPattern — имена переменной клиента: в роутах это prisma и tx,
 * в сервисном слое ещё db и client (lib/fleet/assignment, lib/routes/service).
 */
function findPrismaCalls(source, clientPattern = "prisma") {
  const calls = []
  const re = new RegExp(`\\b(?:${clientPattern})\\.(\\w+)\\.(\\w+)\\s*\\(`, "g")
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
    calls.push({ model, method, argsText, line, index: match.index })
  }
  return calls
}

/** Имена переменных, которыми в роутах называют разобранный запрос. */
const REQUEST_LIKE = new Set([
  "other",
  "rest",
  "body",
  "payload",
  "json",
  "updates",
  "patch",
  "fields",
  "params",
])

/**
 * Массовое присваивание: спред переменной, похожей на тело запроса, внутри
 * аргументов записывающего вызова. Возвращает имя переменной или null.
 */
function massAssignment(argsText) {
  for (const spread of argsText.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) {
    if (REQUEST_LIKE.has(spread[1])) return spread[1]
  }
  return null
}

const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert"])

/** Чтение одной записи — то, чем проверяют принадлежность организации. */
const SINGLE_READS = new Set([
  "findFirst",
  "findUnique",
  "findFirstOrThrow",
  "findUniqueOrThrow",
])

/**
 * Есть ли в фрагменте кода выше вызова проверка принадлежности организации:
 * чтение одной записи со скоупом (scopedWhere/scopedByOrg/organizationId)
 * или where, собранный через scopedWhere / с обязательным organizationId.
 */
function hasScopedLookup(head) {
  if (/where\.organizationId\s*=/.test(head)) return true
  if (/=\s*scopedWhere\s*\(/.test(head)) return true
  for (const call of findPrismaCalls(head, "prisma|db|client|tx")) {
    if (!SINGLE_READS.has(call.method)) continue
    if (/scopedWhere\s*\(|scopedByOrg\s*\(/.test(call.argsText)) return true
    if (/organizationId/.test(call.argsText)) return true
  }
  return false
}

/**
 * Есть ли проверка организации выше вызова.
 *
 * Смотрим от внутреннего блока к внешнему, но не выше функции модуля:
 * вызов может жить в колбэке `prisma.$transaction(async (tx) => …)` или
 * в ветке обработчика, а проверка цели — в начале этого же обработчика.
 */
function scopedLookupAbove(source, index) {
  const moduleRe = /^(?:export\s+)?(?:async\s+)?function\s+\w+|^const\s+\w+\s*=\s*(?:async\s*)?\(/gm
  const moduleStarts = [...source.matchAll(moduleRe)]
    .map((m) => m.index)
    .filter((i) => i <= index)
  const floor = moduleStarts.length ? moduleStarts[moduleStarts.length - 1] : 0
  const openers = [...source.slice(0, index).matchAll(/\bfunction\b|=>\s*\{/g)]
    .map((m) => m.index)
    .filter((i) => i >= floor)
  const starts = [...new Set([...openers, floor])].sort((a, b) => b - a)
  return starts.some((start) => hasScopedLookup(source.slice(start, index)))
}

/**
 * Маркер-исключение рядом с вызовом (строка вызова или две строки выше).
 *
 * Возвращает:
 *   { kind: "ok" }      — подтверждено автоматически (hasScopedLookup);
 *   { kind: "manual", reason } — проверено человеком, попадёт в отчёт;
 *   { kind: "unverified", reason } — маркер «ok», но подтверждения в коде нет;
 *   null                — маркера нет.
 */
function exemptionAt(source, line, index) {
  const lines = source.split("\n")
  const window = lines.slice(Math.max(0, line - 3), line).join("\n")
  const match = window.match(/org-audit:\s*(ok|manual)\s*[—-]\s*(.+)/)
  if (!match) return null
  const [, kind, reason] = match
  if (kind === "manual") return { kind: "manual", reason: reason.trim() }
  if (scopedLookupAbove(source, index)) return { kind: "ok", reason: reason.trim() }
  return { kind: "unverified", reason: reason.trim() }
}

/** Файлы сервисного слоя: все lib/**\/*.ts кроме клиента БД. */
function walkLib(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walkLib(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full)
  }
  return out
}

/** Модули, которые legitimately работают с базой без организации. */
const LIB_SKIP_FILES = new Set([
  "lib/prisma.ts", // создание клиента
])

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
  const manuals = []
  const spreads = []

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
    const exemption = exemptionAt(source, call.line, call.index)
    if (exemption?.kind === "ok") continue
    if (exemption?.kind === "manual") {
      manuals.push(
        `строка ${call.line}: prisma.${call.model}.${call.method}(…) — ${exemption.reason}`,
      )
      continue
    }
    if (exemption?.kind === "unverified") {
      violations.push(
        `строка ${call.line}: prisma.${call.model}.${call.method}(…) — маркер «org-audit: ok» ` +
          `не подтверждён: выше в этом блоке нет чтения записи со скоупом организации`,
      )
      continue
    }
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
    // Массовое присваивание проверяется до маркеров: маркер «ok» подтверждает
    // принадлежность ЦЕЛИ, но не состав полей в data
    if (WRITE_METHODS.has(txMatch[2])) {
      const spread = massAssignment(argsText)
      if (spread) {
        spreads.push(
          `строка ${line}: tx.${model}.${txMatch[2]}(…) — спред ...${spread} в data (массовое присваивание)`,
        )
      }
    }
    if (argsText.includes("organizationId")) continue
    const exemption = exemptionAt(source, line, txMatch.index)
    if (exemption?.kind === "ok") continue
    if (exemption?.kind === "manual") {
      manuals.push(`строка ${line}: tx.${model}.${txMatch[2]}(…) — ${exemption.reason}`)
      continue
    }
    if (exemption?.kind === "unverified") {
      violations.push(
        `строка ${line}: tx.${model}.${txMatch[2]}(…) — маркер «org-audit: ok» не подтверждён`,
      )
      continue
    }
    violations.push(`строка ${line}: tx.${model}.${txMatch[2]}(…) без organizationId`)
  }

  const exempt = EXEMPT_FILES.has(path)

  // Массовое присваивание: тело запроса спредом в data у записи
  for (const call of calls) {
    if (!WRITE_METHODS.has(call.method)) continue
    const name = massAssignment(call.argsText)
    if (!name) continue
    spreads.push(
      `строка ${call.line}: prisma.${call.model}.${call.method}(…) — спред ...${name} в data (массовое присваивание)`,
    )
  }

  // Организация из запроса (тело, query, динамический сегмент, заголовки) — нарушение:
  // значение обязано приходить из проверенной сессии.
  const leaks = []
  const leakRe =
    /\borganizationId\b\s*[:=]\s*(body|payload|json|searchParams|params|request|req|headers)\b|\b(body|payload|json|searchParams|params|request|req|headers)\s*(?:\.\s*organizationId|\.get\(\s*["'`]organizationId)/g
  for (const m of source.matchAll(leakRe)) {
    const line = source.slice(0, m.index).split("\n").length
    leaks.push(`строка ${line}: organizationId берётся из запроса (${m[0].trim()})`)
  }

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
    // Утечки организации из запроса и массовое присваивание — нарушения даже в
    // «освобождённых» роутах: организация не должна приходить из тела никогда
    violations: exempt ? [...leaks, ...spreads] : [...violations, ...leaks, ...spreads],
    raw: exempt ? [] : raw,
    // Места, помеченные «org-audit: manual»: скрыть их нельзя, видно в отчёте
    manuals: exempt ? [] : manuals,
    leaks: exempt ? [] : leaks,
    spreads: exempt ? [] : spreads,
    exempt,
  }
}

/** Проверка одного файла сервисного слоя. */
function analyzeLib(file) {
  const source = readFileSync(file, "utf8")
  const path = relative(ROOT, file)
  const calls = findPrismaCalls(source, "prisma|db|client|tx")
  const violations = []
  const raw = []
  const manuals = []

  for (const call of calls) {
    if (call.model.startsWith("$")) {
      if (call.model === "$queryRaw" || call.model === "$executeRaw") {
        raw.push(`строка ${call.line}: ${call.model} — проверить вручную`)
      }
      continue
    }
    if (SHARED_MODELS.has(call.model)) continue
    if (!ORG_MODELS.has(call.model)) {
      raw.push(`строка ${call.line}: неизвестная модель ${call.model} — проверить вручную`)
      continue
    }
    if (call.argsText.includes("organizationId")) continue
    const exemption = exemptionAt(source, call.line, call.index)
    if (exemption?.kind === "ok") continue
    if (exemption?.kind === "manual") {
      manuals.push(`строка ${call.line}: ${call.model}.${call.method}(…) — ${exemption.reason}`)
      continue
    }
    if (exemption?.kind === "unverified") {
      violations.push(
        `строка ${call.line}: ${call.model}.${call.method}(…) — маркер «org-audit: ok» ` +
          `не подтверждён: выше в этом блоке нет чтения записи со скоупом организации`,
      )
      continue
    }
    violations.push(`строка ${call.line}: ${call.model}.${call.method}(…) без organizationId`)
  }

  const spreads = []
  for (const call of calls) {
    if (!WRITE_METHODS.has(call.method)) continue
    const name = massAssignment(call.argsText)
    if (!name) continue
    spreads.push(
      `строка ${call.line}: ${call.model}.${call.method}(…) — спред ...${name} в data (массовое присваивание)`,
    )
  }

  return {
    path,
    handlers: [],
    guard: null,
    hasOrgContext: source.includes("organizationId"),
    hasCronSecret: false,
    prismaCalls: calls.length,
    orgModels: calls.filter((c) => ORG_MODELS.has(c.model)).length,
    models: [...new Set(calls.filter((c) => ORG_MODELS.has(c.model)).map((c) => c.model))],
    violations: [...violations, ...spreads],
    raw,
    manuals,
    leaks: [],
    spreads,
    exempt: false,
  }
}

const files = walk(join(ROOT, "app")).sort()
const reports = files.map(analyze)

const libDir = join(ROOT, "lib")
const libReports = statSync(libDir).isDirectory()
  ? walkLib(libDir)
      .sort()
      .map((file) => relative(ROOT, file))
      .filter((path) => !LIB_SKIP_FILES.has(path))
      .map((path) => analyzeLib(join(ROOT, path)))
      .filter((report) => report.orgModels > 0)
  : []
const libProblems = libReports.filter((r) => r.violations.length > 0)

const problems = reports.filter(
  (r) => !r.exempt && (r.violations.length > 0 || (!r.guard && !r.hasCronSecret)),
)

if (AS_JSON) {
  console.log(JSON.stringify({ routes: reports, lib: libReports }, null, 2))
  process.exit(problems.length > 0 || libProblems.length > 0 ? 1 : 0)
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
  const manuals = [
    ...reports.flatMap((r) => r.manuals.map((text) => [r.path, text])),
    ...libReports.flatMap((r) => r.manuals.map((text) => [r.path, text])),
  ]
  console.log("")
  console.log("### Проверено вручную (маркер «org-audit: manual»)")
  console.log("")
  if (manuals.length === 0) {
    console.log("Таких мест нет.")
  } else {
    console.log("| Файл | Запрос и причина |")
    console.log("|---|---|")
    for (const [path, text] of manuals) console.log(`| \`${path}\` | ${text} |`)
  }
  console.log("")
  console.log("### Сервисный слой (lib/**)")
  console.log("")
  console.log("| Файл | Бизнес-запросов | Модели | Статус |")
  console.log("|---|---|---|---|")
  for (const report of libReports) {
    const verdict = report.violations.length
      ? `**НАРУШЕНИЯ: ${report.violations.length}**`
      : "изолирован"
    console.log(
      `| \`${report.path}\` | ${report.orgModels} | ${report.models.map((m) => "\`" + m + "\`").join(", ") || "—"} | ${verdict} |`,
    )
  }
  process.exit(problems.length > 0 || libProblems.length > 0 ? 1 : 0)
}

console.log("═".repeat(78))
console.log("АУДИТ ИЗОЛЯЦИИ ДАННЫХ ПО ОРГАНИЗАЦИЯМ")
console.log("═".repeat(78))
console.log(`API-роутов проверено: ${reports.length}`)
console.log(`Модулей сервисного слоя с бизнес-запросами: ${libReports.length}`)
console.log(
  `С контекстом организации (requireOrganization): ${reports.filter((r) => r.hasOrgContext).length}`,
)
console.log(`Роутов с нарушениями: ${problems.length}`)
console.log(
  `Мест, проверенных вручную (org-audit: manual): ${
    reports.reduce((n, r) => n + r.manuals.length, 0) +
    libReports.reduce((n, r) => n + r.manuals.length, 0)
  }`,
)

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
console.log("─".repeat(78))
console.log("СЕРВИСНЫЙ СЛОЙ (lib/**)")
console.log("─".repeat(78))
for (const report of libReports) {
  const status = report.violations.length === 0 ? "✓" : "✗"
  console.log(`${status} ${report.path} · бизнес-запросов: ${report.orgModels}`)
  for (const violation of report.violations) console.log(`    ✗ ${violation}`)
  for (const item of report.raw) console.log(`    ? ${item}`)
}

const allManuals = [
  ...reports.flatMap((r) => r.manuals.map((text) => `${r.path} · ${text}`)),
  ...libReports.flatMap((r) => r.manuals.map((text) => `${r.path} · ${text}`)),
]
console.log("")
console.log("─".repeat(78))
console.log("ПРОВЕРЕНО ВРУЧНУЮ (маркер «org-audit: manual») — автоматического подтверждения нет")
console.log("─".repeat(78))
if (allManuals.length === 0) {
  console.log("нет")
} else {
  for (const item of allManuals) console.log(`  • ${item}`)
}

console.log("")
console.log("═".repeat(78))
const totalProblems = problems.length + libProblems.length
if (totalProblems === 0) {
  console.log("Нарушений нет: все бизнес-запросы ограничены организацией из сессии.")
} else {
  console.log(`Требуют правки: ${totalProblems} файлов`)
  for (const problem of problems) console.log(`  • ${problem.path}`)
  for (const problem of libProblems) console.log(`  • ${problem.path} (сервисный слой)`)
}
console.log("═".repeat(78))

process.exit(totalProblems > 0 ? 1 : 0)
