// lib/backup/plan.mjs
//
// Чистая логика плана резервного копирования — без sqlite3 и pg_dump.
// Отдельный модуль, а не строки внутри скрипта: правила имён и хранения
// копий проверяются тестами, а сам скрипт (scripts/db-backup.mjs) остаётся
// тонким. Лежит в .mjs, потому что Node 20 не умеет импортировать
// TypeScript из обычных скриптов — а бэкап должен работать везде.
//
// Правила:
//   • копия называется loginex-2026-10-13T07-05-00.db (двоеточия недопустимы
//     в именах файлов на Windows, поэтому они заменены на тире);
//   • sqlite-копии — .db, postgres-копии — .sql;
//   • в prisma/backups храним BACKUP_KEEP последних копий, остальное — удалять;
//   • чужие файлы в этой папке скрипт не трогает.

/**
 * @typedef {"sqlite" | "postgres" | "unknown"} DbDriver
 * @typedef {{ name: string, at: Date }} BackupFileInfo
 */

/** Сколько копий храним по умолчанию: две недели ежедневных. */
export const DEFAULT_BACKUP_KEEP = 14

/** Куда складывать копии (в .gitignore — в репозиторий не попадают). */
export const BACKUP_DIR = "prisma/backups"

/**
 * Какой это драйвер базы — по строке подключения.
 * @param {string | null | undefined} databaseUrl
 * @returns {DbDriver}
 */
export function resolveDriver(databaseUrl) {
  const url = String(databaseUrl || "").trim()
  if (url.startsWith("file:")) return "sqlite"
  if (/^postgres(ql)?:\/\//i.test(url)) return "postgres"
  return "unknown"
}

/**
 * Расширение файла копии для драйвера.
 * @param {DbDriver} driver
 * @returns {string}
 */
export function backupExtension(driver) {
  return driver === "sqlite" ? "db" : "sql"
}

/** @param {number} value */
const pad = (value) => String(value).padStart(2, "0")

/**
 * Имя файла бэкапа: `loginex-2026-10-13T07-05-00.db`.
 * Двоеточия заменены на тире — они недопустимы в именах файлов на Windows.
 * Миллисекунды не пишем: в имени бэкапа они не нужны, а разбор проще.
 * @param {DbDriver} driver
 * @param {Date | string} at
 * @returns {string}
 */
export function backupFileName(driver, at) {
  const moment = new Date(at)
  const stamp = Number.isNaN(moment.getTime())
    ? "unknown"
    : `${moment.getUTCFullYear()}-${pad(moment.getUTCMonth() + 1)}-${pad(moment.getUTCDate())}T${pad(
        moment.getUTCHours(),
      )}-${pad(moment.getUTCMinutes())}-${pad(moment.getUTCSeconds())}`
  return `loginex-${stamp}.${backupExtension(driver)}`
}

/**
 * Разбор имени файла бэкапа обратно во времени. Ненаш формат — null,
 * такие файлы скрипт не трогает.
 * @param {string} name
 * @returns {BackupFileInfo | null}
 */
export function parseBackupFileName(name) {
  const match = /^loginex-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.(db|sql)$/.exec(name)
  if (!match) return null
  // Обратно во время: дата-тире, а внутри времени — снова двоеточия
  const [date, time] = match[1].split("T")
  const at = new Date(`${date}T${time.replace(/-/g, ":")}Z`)
  if (Number.isNaN(at.getTime())) return null
  return { name, at }
}

/**
 * Какие файлы удалить, чтобы осталось `keep` самых свежих.
 * Сортировка по времени съёма, а не по алфавиту: так копии не теряются.
 * @param {readonly string[]} files
 * @param {number} [keep]
 * @returns {string[]}
 */
export function planPrune(files, keep = DEFAULT_BACKUP_KEEP) {
  // Сортировка от старых к новым: удаляем самые старые, свежие не трогаем
  const parsed = files
    .map((name) => parseBackupFileName(name))
    .filter((file) => file !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime())

  const safeKeep = Math.max(0, Math.floor(keep))
  const excess = Math.max(0, parsed.length - safeKeep)
  return parsed.slice(0, excess).map((file) => file.name)
}
