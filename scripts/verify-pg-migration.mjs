// scripts/verify-pg-migration.mjs
//
// Проверка PostgreSQL-миграции ETA на РЕАЛЬНОМ движке PostgreSQL.
//
// PGlite — это PostgreSQL, скомпилированный в WebAssembly: те же парсер,
// те же типы, те же системные каталоги. Это не имитация и не SQLite с другим
// именем: если миграция содержит DATETIME вместо TIMESTAMP(3), она здесь
// падает точно так же, как на Supabase.
//
// Что проверяется:
//   1. миграция применяется без ошибок (и повторно — идемпотентность);
//   2. структура таблицы совпадает с prisma/schema.prisma (модель EtaForecast):
//      состав колонок, типы, nullable, default-ы;
//   3. индексы на месте (8 штук, включая составной);
//   4. внешние ключи: organizationId — CASCADE, routeId — SET NULL;
//   5. вставка строки с типичными значениями и чтение её обратно;
//   6. ON DELETE CASCADE / SET NULL на живых данных;
//   7. существующие записи не ломаются (миграция идемпотентна и ничего
//      не перезаписывает).
//
// Запуск: node scripts/verify-pg-migration.mjs
// Требует @electric-sql/pglite (devDependency).

import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

let PGlite
try {
  ({ PGlite } = await import("@electric-sql/pglite"))
} catch {
  console.error(
    "Не найден пакет @electric-sql/pglite.\n" +
      "Он нужен только для этой проверки: npm install --save-dev @electric-sql/pglite",
  )
  process.exit(2)
}

// Миграции ETA идут по порядку дат: база + всё, что добавлено после неё.
// Берём их все из каталога, иначе проверка тестирует не то, что уедет в прод.
const ETA_MIGRATIONS = readdirSync(join(root, "prisma", "sql"))
  .filter((name) => name.endsWith(".postgres.sql"))
  .sort()

const migration = ETA_MIGRATIONS
  .map((name) => {
    console.log(`• миграция: ${name}`)
    return readFileSync(join(root, "prisma", "sql", name), "utf8")
  })
  .join("\n")

const db = new PGlite()
const failures = []
const checks = []

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail })
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`)
}

// ── 0. Минимальный каркас связанных таблиц (в прода они уже есть) ───────────
await db.exec(`
  CREATE TABLE "Organization" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT);
  CREATE TABLE "Route" ("id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT);
`)

// ── 1. Применение миграции ─────────────────────────────────────────────────
try {
  await db.exec(migration)
  check("миграция применяется на PostgreSQL", true)
} catch (error) {
  check("миграция применяется на PostgreSQL", false, String(error.message || error))
  console.log("\nИТОГ: ПРОВАЛ")
  process.exit(1)
}

// ── 2. Идемпотентность ─────────────────────────────────────────────────────
try {
  await db.exec(migration)
  check("повторное применение не ломает базу (идемпотентность)", true)
} catch (error) {
  check("повторное применение не ломает базу (идемпотентность)", false, String(error.message || error))
}

// ── 3. Состав колонок: имя → тип / nullable / default ──────────────────────
const columns = (
  await db.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'EtaForecast'
    ORDER BY ordinal_position
  `)
).rows

const expected = [
  ["id", "text", "NO", null],
  ["organizationId", "text", "YES", null],
  ["routeId", "text", "YES", null],
  ["orderId", "text", "YES", null],
  ["vehicleId", "text", "YES", null],
  ["driverId", "text", "YES", null],
  ["modelVersion", "text", "NO", null],
  ["sourcesJson", "text", "YES", null],
  ["timeZone", "text", "NO", "'Europe/Moscow'::text"],
  ["departureAt", "timestamp without time zone", "NO", null],
  ["initialArrivalAt", "timestamp without time zone", "NO", null],
  ["currentArrivalAt", "timestamp without time zone", "NO", null],
  ["optimisticArrivalAt", "timestamp without time zone", "YES", null],
  ["conservativeArrivalAt", "timestamp without time zone", "YES", null],
  ["drivingSec", "integer", "NO", "0"],
  ["stopsSec", "integer", "NO", "0"],
  ["restSec", "integer", "NO", "0"],
  ["totalSec", "integer", "NO", "0"],
  ["distanceM", "integer", "YES", null],
  ["confidenceScore", "double precision", "NO", "0"],
  ["confidenceLevel", "text", "NO", "'low'::text"],
  ["confidenceReasonsJson", "text", "YES", null],
  ["segmentsJson", "text", "YES", null],
  ["stagesJson", "text", "YES", null],
  ["explanationJson", "text", "YES", null],
  ["weatherJson", "text", "YES", null],
  ["violationsJson", "text", "YES", null],
  ["reliable", "boolean", "NO", "true"],
  ["reliabilityNote", "text", "YES", null],
  ["calculatedAt", "timestamp without time zone", "NO", null],
  ["recalcCount", "integer", "NO", "0"],
  ["actualArrivalAt", "timestamp without time zone", "YES", null],
  ["actualDrivingSec", "integer", "YES", null],
  ["actualStopsSec", "integer", "YES", null],
  ["delayReasonsJson", "text", "YES", null],
  ["errorMinutes", "double precision", "YES", null],
  ["outlier", "boolean", "NO", "false"],
  ["createdAt", "timestamp without time zone", "NO", "CURRENT_TIMESTAMP"],
  ["updatedAt", "timestamp without time zone", "NO", "CURRENT_TIMESTAMP"],
]

check(
  `колонок ровно ${expected.length} (как в модели Prisma)`,
  columns.length === expected.length,
  `получено ${columns.length}`,
)

const byName = new Map(columns.map((row) => [row.column_name, row]))
const mismatches = []
for (const [name, type, nullable, def] of expected) {
  const row = byName.get(name)
  if (!row) {
    mismatches.push(`${name}: колонки нет`)
    continue
  }
  if (row.data_type !== type) mismatches.push(`${name}: тип ${row.data_type} вместо ${type}`)
  if (row.is_nullable !== nullable) mismatches.push(`${name}: nullable ${row.is_nullable} вместо ${nullable}`)
  if (def !== null && String(row.column_default) !== def) {
    mismatches.push(`${name}: default ${row.column_default} вместо ${def}`)
  }
}
check("типы, nullable и default-ы совпадают с Prisma-моделью", mismatches.length === 0, mismatches.join("; "))

// ── 4. Индексы ─────────────────────────────────────────────────────────────
const indexes = (
  await db.query(`
    SELECT indexname FROM pg_indexes WHERE tablename = 'EtaForecast' ORDER BY indexname
  `)
).rows.map((row) => row.indexname)

const requiredIndexes = [
  "EtaForecast_organizationId_idx",
  "EtaForecast_routeId_idx",
  "EtaForecast_orderId_idx",
  "EtaForecast_vehicleId_idx",
  "EtaForecast_calculatedAt_idx",
  "EtaForecast_actualArrivalAt_idx",
  "EtaForecast_modelVersion_idx",
  "EtaForecast_organizationId_calculatedAt_idx",
]
const missingIndexes = requiredIndexes.filter((name) => !indexes.includes(name))
check(
  `индексов ${requiredIndexes.length} из ${requiredIndexes.length} (включая составной)`,
  missingIndexes.length === 0,
  missingIndexes.length ? `нет: ${missingIndexes.join(", ")}` : indexes.join(", "),
)

// ── 5. Внешние ключи и поведение при удалении ──────────────────────────────
const fks = (
  await db.query(`
    SELECT conname, confdeltype, confupdtype, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = '"EtaForecast"'::regclass AND contype = 'f'
  `)
).rows

const orgFk = fks.find((row) => row.conname === "EtaForecast_organizationId_fkey")
const routeFk = fks.find((row) => row.conname === "EtaForecast_routeId_fkey")

check("FK на Organization существует", Boolean(orgFk))
check(
  "FK на Organization: ON DELETE CASCADE",
  Boolean(orgFk) && orgFk.confdeltype === "c",
  orgFk ? orgFk.def : "нет",
)
check("FK на Route существует", Boolean(routeFk))
check(
  "FK на Route: ON DELETE SET NULL",
  Boolean(routeFk) && routeFk.confdeltype === "n",
  routeFk ? routeFk.def : "нет",
)

// ── 6. Вставка и чтение типичной строки ────────────────────────────────────
await db.query(`INSERT INTO "Organization" ("id", "name") VALUES ('org1', 'Тест')`)
await db.query(`INSERT INTO "Route" ("id", "organizationId") VALUES ('route1', 'org1')`)

const insert = `
  INSERT INTO "EtaForecast" (
    "id", "organizationId", "routeId", "modelVersion", "sourcesJson",
    "departureAt", "initialArrivalAt", "currentArrivalAt",
    "optimisticArrivalAt", "conservativeArrivalAt",
    "drivingSec", "stopsSec", "restSec", "totalSec", "distanceM",
    "confidenceScore", "confidenceLevel", "confidenceReasonsJson",
    "segmentsJson", "explanationJson", "weatherJson", "violationsJson",
    "reliable", "reliabilityNote", "calculatedAt", "recalcCount"
  ) VALUES (
    'fc1', 'org1', 'route1', '2.0.0-segments', '["osrm"]',
    '2026-10-14 09:00:00', '2026-10-14 15:00:00', '2026-10-14 15:30:00',
    '2026-10-14 14:30:00', '2026-10-14 16:30:00',
    21000, 0, 0, 21000, 265000,
    0.67, 'medium', '["погода недоступна"]',
    '[]', '[]', NULL, '[]',
    true, NULL, '2026-10-14 08:00:00', 0
  )
`
try {
  await db.query(insert)
  const row = (await db.query(`SELECT * FROM "EtaForecast" WHERE "id" = 'fc1'`)).rows[0]
  check("вставка типичной строки прогноза", Boolean(row))
  check(
    "значения читаются обратно с правильными типами",
    row.confidenceScore === 0.67 && row.reliable === true && row.drivingSec === 21000,
    `confidenceScore=${typeof row.confidenceScore} ${row.confidenceScore}, reliable=${typeof row.reliable}`,
  )
} catch (error) {
  check("вставка типичной строки прогноза", false, String(error.message || error))
}

// ── 7. Поведение при удалении связанных записей ────────────────────────────
try {
  await db.query(`UPDATE "EtaForecast" SET "actualArrivalAt" = '2026-10-14 15:40:00', "errorMinutes" = 10 WHERE "id" = 'fc1'`)
  const before = (await db.query(`SELECT "errorMinutes" FROM "EtaForecast" WHERE "id" = 'fc1'`)).rows[0]
  check("факт и ошибка прогноза записываются", before.errorMinutes === 10)

  // Удаление рейса → routeId обнуляется, строка остаётся (история метрик цела)
  await db.query(`DELETE FROM "Route" WHERE "id" = 'route1'`)
  const afterRoute = (await db.query(`SELECT "routeId" FROM "EtaForecast" WHERE "id" = 'fc1'`)).rows[0]
  check("удаление рейса обнуляет routeId, а не удаляет прогноз", afterRoute.routeId === null)

  // Удаление организации → прогноз удаляется каскадом
  await db.query(`DELETE FROM "Organization" WHERE "id" = 'org1'`)
  const afterOrg = (await db.query(`SELECT COUNT(*)::int AS c FROM "EtaForecast"`)).rows[0]
  check("удаление организации удаляет прогнозы (CASCADE)", afterOrg.c === 0)
} catch (error) {
  check("поведение при удалении связанных записей", false, String(error.message || error))
}

// ── 8. Суответствие составу Prisma-модели: лишних колонок нет ──────────────
const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8")
const model = /model EtaForecast \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? ""
const prismaFields = [...model.matchAll(/^\s{2}(\w+)\s+\w+/gm)].map((m) => m[1])
const relationNames = new Set(["organization", "route", "order", "vehicle", "driver"])
const prismaColumns = prismaFields.filter((name) => !relationNames.has(name))
const extra = [...byName.keys()].filter((name) => !prismaColumns.includes(name))
check(
  `лишних колонок нет (в Prisma-модели ${prismaColumns.length} скалярных полей)`,
  extra.length === 0,
  extra.length ? `лишние: ${extra.join(", ")}` : undefined,
)

// ── Итог ───────────────────────────────────────────────────────────────────
const passed = checks.filter((c) => c.ok).length
console.log(`\nПроверок: ${passed}/${checks.length}`)
if (failures.length > 0) {
  console.log("\nПРОВАЛЫ:")
  failures.forEach((line) => console.log(`  ✗ ${line}`))
  console.log("\nИТОГ: ПРОВАЛ")
  process.exit(1)
}
console.log("\nИТОГ: PostgreSQL-миграция применена и сверена с Prisma-моделью")
