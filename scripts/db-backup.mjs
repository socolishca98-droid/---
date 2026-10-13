// scripts/db-backup.mjs
//
// Резервная копия базы: `npm run db:backup`.
//
// Зачем отдельный скрипт, а не «скопировать файл руками»: бэкап, который
// делают руками, не делают вообще. Скрипт одинаково работает и на разработке
// (SQLite — копируем файл), и на продакшене (Postgres — pg_dump), оставляет
// только последние N копий и печатает, что именно получилось.
//
// SQLite: пробуем `sqlite3 .backup` — это корректная копия даже при живых
// запросах (WAL). Если sqlite3 нет в системе, копируем файл плюс -wal/-shm
// и честно предупреждаем, что лучше поставить sqlite3.
// Postgres: `pg_dump` со строкой подключения из DATABASE_URL. Если pg_dump
// нет — говорим об этом и выходим с ошибкой: врать «бэкап готов» нельзя.
//
// Куда: prisma/backups/ (в .gitignore, в снапшоты рабочей области не попадает).
// Сколько: BACKUP_KEEP (по умолчанию 14) последних копий.

import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { loadDotEnv, resolveSchemaPath } from "./prisma-schema.mjs"
import {
  BACKUP_DIR,
  DEFAULT_BACKUP_KEEP,
  backupFileName,
  planPrune,
  resolveDriver,
} from "../lib/backup/plan.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

function log(message) {
  console.log(message)
}

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(1)
}

/**
 * Путь к файлу SQLite-базы из DATABASE_URL вида file:./verify.db.
 * Важно: Prisma резолвит относительный путь ОТ ПАПКИ СХЕМЫ (prisma/), а не от
 * корня проекта — иначе бэкап искал бы файл, которого нет, и «успешно» копировал
 * бы пустоту. Повторяем это правило здесь, чтобы копия бралась из той же базы,
 * которую использует приложение.
 */
function sqliteFilePath(databaseUrl) {
  const raw = databaseUrl
    .replace(/^file:/, "")
    .split("?")[0] // параметры подключения к файлу не относятся
  const isAbsolute = raw.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(raw)
  if (isAbsolute) return raw
  const schemaDir = dirname(resolveSchemaPath(databaseUrl)) // "prisma"
  return join(root, schemaDir, raw)
}

function commandExists(command) {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore" })
  return !probe.error && probe.status === 0
}

/** Копия SQLite: через sqlite3 .backup, иначе файлом с предупреждением. */
function backupSqlite(databaseUrl, targetPath) {
  const dbPath = sqliteFilePath(databaseUrl)
  if (!existsSync(dbPath)) {
    fail(`Файл базы не найден: ${dbPath}. Проверьте DATABASE_URL в .env`)
  }

  if (commandExists("sqlite3")) {
    const result = spawnSync("sqlite3", [dbPath, `.backup '${targetPath}'`], { stdio: "inherit" })
    if (result.status !== 0) fail("sqlite3 не смог сделать копию")
    return "sqlite3 .backup (корректно при живых запросах)"
  }

  // Фолбэк: копируем файл и сопутствующие -wal/-shm, иначе свежие данные
  // из журнала предзаписи потерялись бы.
  copyFileSync(dbPath, targetPath)
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${dbPath}${suffix}`
    if (existsSync(sidecar)) copyFileSync(sidecar, `${targetPath}${suffix}`)
  }
  return "копирование файла (поставьте sqlite3 для корректной копии при работе)"
}

/** Копия Postgres: pg_dump со строкой подключения. */
function backupPostgres(databaseUrl, targetPath) {
  if (!commandExists("pg_dump")) {
    fail(
      "pg_dump не найден. На продакшене бэкап делается им: " +
        "поставьте PostgreSQL client или запускайте бэкап на стороне провайдера базы.",
    )
  }

  const result = spawnSync("pg_dump", ["--dbname", databaseUrl, "--file", targetPath, "--no-owner"], {
    stdio: "inherit",
  })
  if (result.status !== 0) fail("pg_dump завершился ошибкой")
  return "pg_dump"
}

function main() {
  loadDotEnv()

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    fail("DATABASE_URL не задан: нечего копировать. Проверьте .env")
  }

  const driver = resolveDriver(databaseUrl)
  if (driver === "unknown") {
    fail(`Не понимаю DATABASE_URL (ожидаю file: или postgres://): ${databaseUrl}`)
  }

  const backupDir = join(root, BACKUP_DIR)
  mkdirSync(backupDir, { recursive: true })

  const now = new Date()
  const targetPath = join(backupDir, backupFileName(driver, now))

  const how = driver === "sqlite" ? backupSqlite(databaseUrl, targetPath) : backupPostgres(databaseUrl, targetPath)

  const keep = Number(process.env.BACKUP_KEEP) || DEFAULT_BACKUP_KEEP
  const stale = planPrune(readdirSync(backupDir), keep)
  for (const name of stale) {
    rmSync(join(backupDir, name), { force: true })
    // Сопутствующие файлы копии «файлом» удаляем вместе с ней
    rmSync(join(backupDir, `${name}-wal`), { force: true })
    rmSync(join(backupDir, `${name}-shm`), { force: true })
  }

  const sizeKb = Math.round(statSync(targetPath).size / 1024)
  log(`✔ Бэкап готов: ${BACKUP_DIR}/${backupFileName(driver, now)} (${sizeKb} КБ, ${how})`)
  if (stale.length > 0) {
    log(`  Удалено старых копий: ${stale.length} (храним ${keep})`)
  }
  log(`  Восстановление SQLite: sqlite3 ${targetPath} .dump > restore.sql`)
  log(`  Восстановление Postgres: psql <датабаза> -f ${targetPath}`)
}

main()
