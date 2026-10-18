/**
 * Тесты обвязки резервного копирования (package.json + .gitignore + скрипт).
 *
 * Зачем: чистая логика плана бэкапа покрыта в __tests__/backup/plan.test.ts,
 * но «бэкап есть» — это ещё и команда `npm run db:backup`, и папка копий,
 * не утёкшая в git. Без этих трёх вещей бэкап не делают: скрипт лежит,
 * но про него никто не знает, а копии баз оказываются в коммитах.
 *
 * Запуск: npm test
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")

const read = (relative) => readFileSync(path.join(root, relative), "utf8")

test("в package.json есть команда db:backup", () => {
  const pkg = JSON.parse(read("package.json"))
  assert.equal(pkg.scripts["db:backup"], "node scripts/db-backup.mjs")
})

test("папка копий не попадает в git", () => {
  const gitignore = read(".gitignore")
  assert.ok(
    gitignore.split("\n").some((line) => line.trim() === "prisma/backups/"),
    "в .gitignore нужна строка prisma/backups/ — иначе копии баз уедут в репозиторий",
  )
})

test("скрипт бэкапа делает копию, чистит старые и падает с ошибкой", () => {
  const script = read("scripts/db-backup.mjs")

  // sqlite и postgres — два разных способа снять копию
  assert.match(script, /sqlite3/, "ожидаю копию SQLite через sqlite3 .backup")
  assert.match(script, /pg_dump/, "ожидаю копию Postgres через pg_dump")

  // Ошибки не должны выглядеть успехом
  assert.match(script, /process\.exit\(1\)/, "при ошибке нужен ненулевой код возврата")

  // Старые копии удаляются, иначе диск кончится
  assert.match(script, /planPrune\(/, "ожидаю вызов planPrune для чистки старых копий")
  assert.match(script, /BACKUP_KEEP/, "лимит хранимых копий должен переопределяться")
})

test("скрипт ищет sqlite-файл так же, как Prisma — от папки схемы", () => {
  const script = read("scripts/db-backup.mjs")
  // Prisma резолвит file:./verify.db относительно prisma/, а не корня проекта.
  // Если здесь ошибиться, бэкап будет «успешно» копировать несуществующий файл.
  assert.match(script, /resolveSchemaPath/, "ожидаю определение пути схемы")
  assert.match(script, /dirname\(/, "ожидаю разрешение относительного пути от папки схемы")
})
