#!/usr/bin/env node
// scripts/prisma-schema.mjs
//
// Запускает любую команду Prisma с ПРАВИЛЬНОЙ схемой, выбранной по DATABASE_URL.
//
// Зачем это нужно
// ---------------
// В репозитории каноническая схема — prisma/schema.prisma с provider = "sqlite"
// (удобно для локальной разработки). Для PostgreSQL рядом генерируется
// prisma/schema.postgres.prisma. Если запустить `prisma generate` без --schema,
// Prisma всегда берёт schema.prisma (SQLite) — и клиент собирается под SQLite.
// В рантайме такой клиент падает на Postgres-URL:
//
//   Error validating datasource `db`: the URL must start with the protocol `file:`.
//
// Именно это и происходило на Vercel: `npm run build` перегенерировал клиент под
// SQLite и затирал вручную сгенерированный Postgres-клиент.
//
// Как работает
// ------------
// 1. Читает DATABASE_URL (сначала process.env, потом .env).
// 2. Если URL начинается с postgres:// или postgresql:// — перегенерирует
//    prisma/schema.postgres.prisma из канонической схемы и использует её.
//    Иначе — использует prisma/schema.prisma (SQLite).
// 3. Запускает переданную команду prisma с явным --schema.
//
// Использование:
//   node scripts/prisma-schema.mjs generate
//   node scripts/prisma-schema.mjs db push
//   node scripts/prisma-schema.mjs studio
//   node scripts/prisma-schema.mjs --print     (только показать выбранную схему)

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Минимальный парсер .env — без зависимости от dotenv (нужен и на прод-сборке). */
export function loadDotEnv(dir = root) {
  const path = join(dir, ".env")
  if (!existsSync(path)) return
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

/** postgres:// и postgresql:// — оба указывают на PostgreSQL. */
export function isPostgresUrl(url) {
  return /^postgres(ql)?:\/\//i.test(String(url || "").trim())
}

/** Путь к схеме, соответствующей DATABASE_URL. */
export function resolveSchemaPath(url = process.env.DATABASE_URL) {
  return isPostgresUrl(url)
    ? "prisma/schema.postgres.prisma"
    : "prisma/schema.prisma"
}

/** Запуск команды: локальный бинарь из node_modules/.bin, иначе npx / node. */
function run(command) {
  const [bin, ...rest] = command
  if (bin === "node") {
    return spawnSync(process.execPath, rest, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    })
  }
  const local = join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${bin}.cmd` : bin,
  )
  const executable = existsSync(local)
    ? local
    : process.platform === "win32"
      ? "npx.cmd"
      : "npx"
  return spawnSync(executable, rest, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  })
}

function cli(argv = process.argv.slice(2)) {
  loadDotEnv()

  const url = process.env.DATABASE_URL || ""
  const schemaPath = resolveSchemaPath(url)

  if (argv[0] === "--print" || argv.length === 0) {
    console.log(schemaPath)
    return 0
  }

  // Пользователь явно указал схему — не вмешиваемся.
  if (argv.includes("--schema") || argv.some((a) => a.startsWith("--schema="))) {
    return run(["prisma", ...argv]).status ?? 1
  }

  if (isPostgresUrl(url)) {
    const gen = run(["node", join(root, "scripts", "make-postgres-schema.mjs")])
    if (gen.status !== 0) return gen.status ?? 1
  } else if (url) {
    console.log(`• DATABASE_URL не PostgreSQL — использую ${schemaPath}`)
  } else {
    console.log(
      `• DATABASE_URL не задан — использую ${schemaPath} (только генерация клиента)`,
    )
  }

  return run(["prisma", ...argv, "--schema", schemaPath]).status ?? 1
}

// CLI запускается только при прямом вызове файла, не при импорте из других скриптов.
const isMain =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))

if (isMain) process.exit(cli())
