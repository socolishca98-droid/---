#!/usr/bin/env node
// scripts/db-sql.mjs
//
// Применение SQL-миграций из prisma/sql/ с выбором ДИАЛЕКТА по DATABASE_URL.
//
// Зачем: в проекте две совместимые схемы Prisma — prisma/schema.prisma
// (SQLite, разработка) и prisma/schema.postgres.prisma (PostgreSQL, прод,
// генерируется скриптом make-postgres-schema.mjs). Миграции в prisma/sql/
// пишутся вручную, и раньше каждая команда жёстко передавала SQLite-схему:
// на боевой PostgreSQL такая команда падала ещё до SQL, на валидации
// datasource (P1012: the URL must start with the protocol `file:`).
//
// Этот скрипт делает три вещи:
//   1. по протоколу DATABASE_URL выбирает схему Prisma (как prisma-schema.mjs);
//   2. выбирает файл миграции: `<имя>.postgres.sql` для PostgreSQL,
//      `<имя>.sql` для SQLite;
//   3. запускает `prisma db execute` с явной схемой — Prisma не угадывает.
//
// Использование:
//   node scripts/db-sql.mjs 2026-10-14-eta-forecast
//   npm run db:sql:eta          (то же самое через package.json)
//
// Миграция НЕ выполняется автоматически: скрипт только применяет файл,
// который уже лежит в репозитории и проверен на тестовой базе.

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { loadDotEnv, isPostgresUrl, resolveSchemaPath } from "./prisma-schema.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

loadDotEnv()

const url = process.env.DATABASE_URL || ""
const postgres = isPostgresUrl(url)
const schemaPath = resolveSchemaPath(url)

const base = process.argv[2]
if (!base) {
  console.error("Укажите имя миграции, например: node scripts/db-sql.mjs 2026-10-14-eta-forecast")
  process.exit(1)
}

const candidates = postgres
  ? [join(root, "prisma", "sql", `${base}.postgres.sql`), join(root, "prisma", "sql", `${base}.sql`)]
  : [join(root, "prisma", "sql", `${base}.sql`)]

const file = candidates.find((path) => existsSync(path))

if (!file) {
  console.error(
    `Файл миграции не найден. Пробовал:\n${candidates.map((p) => `  ${p}`).join("\n")}`,
  )
  process.exit(1)
}

if (postgres && file.endsWith(".postgres.sql") === false) {
  console.error(
    `Для PostgreSQL найден только SQLite-вариант: ${file}\n` +
      "Нужен файл <имя>.postgres.sql — иначе миграция упадёт на типах DATETIME/BOOLEAN.",
  )
  process.exit(1)
}

console.log(`• DATABASE_URL: ${postgres ? "PostgreSQL" : "SQLite"}`)
console.log(`• схема Prisma: ${schemaPath}`)
console.log(`• файл миграции: ${file.replace(`${root}/`, "")}`)

// PostgreSQL-схема должна существовать: её генерирует make-postgres-schema.mjs
if (postgres && !existsSync(join(root, schemaPath))) {
  console.error(`Схема ${schemaPath} не найдена. Выполните: npm run schema:postgres`)
  process.exit(1)
}

const local = join(root, "node_modules", ".bin", "prisma")
const result = spawnSync(
  existsSync(local) ? local : "npx",
  ["db", "execute", "--file", file, "--schema", join(root, schemaPath)],
  { cwd: root, stdio: "inherit", env: process.env },
)

process.exit(result.status ?? 1)
