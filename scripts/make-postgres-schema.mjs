// scripts/make-postgres-schema.mjs
//
// Единый источник истины по схеме — prisma/schema.prisma (SQLite, разработка).
// Для PostgreSQL-развёртывания этот скрипт генерирует prisma/schema.postgres.prisma:
// тот же набор моделей, только provider = "postgresql".
//
// Зачем генерация, а не второй файл в репозитории: две схемы, которые правятся
// вручную, неизбежно разъезжаются. Сгенерированный файл в git не коммитится.
//
// Использование:
//   npm run schema:postgres

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(root, "prisma", "schema.prisma")
const target = join(root, "prisma", "schema.postgres.prisma")

const original = readFileSync(source, "utf8")

if (!/provider\s*=\s*"sqlite"/.test(original)) {
  console.error(
    "Ожидали provider = \"sqlite\" в prisma/schema.prisma — проверьте схему, генерация отменена.",
  )
  process.exit(1)
}

const postgres = original.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')

const banner = [
  "// prisma/schema.postgres.prisma — СГЕНЕРИРОВАННЫЙ ФАЙЛ, не править вручную.",
  "// Источник истины: prisma/schema.prisma. Перегенерация: npm run schema:postgres",
  "",
].join("\n")

writeFileSync(target, banner + postgres, "utf8")

const models = (postgres.match(/^model\s+\w+/gm) || []).length
console.log(`✓ prisma/schema.postgres.prisma: ${models} моделей, provider = postgresql`)
