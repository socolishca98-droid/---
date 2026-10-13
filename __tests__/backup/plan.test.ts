// __tests__/backup/plan.test.ts
//
// План резервного копирования: имена файлов, разбор обратно, какие копии
// удалять. Чистые функции — бэкап проверяется без запуска sqlite3/pg_dump.

import { describe, expect, it } from "vitest"

import {
  BACKUP_DIR,
  DEFAULT_BACKUP_KEEP,
  backupExtension,
  backupFileName,
  parseBackupFileName,
  planPrune,
  resolveDriver,
} from "@/lib/backup/plan.mjs"

describe("resolveDriver", () => {
  it("узнаёт sqlite и postgres по строке подключения", () => {
    expect(resolveDriver("file:./verify.db")).toBe("sqlite")
    expect(resolveDriver("postgres://user:pass@host:5432/db")).toBe("postgres")
    expect(resolveDriver("postgresql://user:pass@host:5432/db")).toBe("postgres")
    expect(resolveDriver("")).toBe("unknown")
    expect(resolveDriver(null)).toBe("unknown")
  })

  it("расширение файла соответствует драйверу", () => {
    expect(backupExtension("sqlite")).toBe("db")
    expect(backupExtension("postgres")).toBe("sql")
  })
})

describe("имена файлов бэкапа", () => {
  it("в имени есть момент съёма, двоеточия заменены", () => {
    const name = backupFileName("sqlite", new Date("2026-10-13T07:05:00.000Z"))
    expect(name).toBe("loginex-2026-10-13T07-05-00.db")
    expect(name).not.toMatch(/[:]/)
  })

  it("postgres-копия — sql-файл", () => {
    expect(backupFileName("postgres", new Date("2026-10-13T07:05:00.000Z"))).toMatch(/\.sql$/)
  })

  it("мусорная дата не роняет имя", () => {
    expect(backupFileName("sqlite", new Date("не дата"))).toBe("loginex-unknown.db")
  })
})

describe("разбор имени обратно", () => {
  it("восстанавливает время съёма", () => {
    const name = backupFileName("sqlite", new Date("2026-10-13T07:05:00.000Z"))
    const parsed = parseBackupFileName(name)
    expect(parsed?.at.toISOString()).toBe(new Date("2026-10-13T07:05:00.000Z").toISOString())
  })

  it("чужие файлы скрипт не трогает", () => {
    expect(parseBackupFileName("verify.db")).toBeNull()
    expect(parseBackupFileName("loginex-backup.db")).toBeNull()
    expect(parseBackupFileName("loginex-2026-10-13.db")).toBeNull()
  })
})

describe("planPrune", () => {
  const names = [
    "loginex-2026-10-01T00-00-00.db",
    "loginex-2026-10-05T00-00-00.db",
    "loginex-2026-10-09T00-00-00.db",
    "loginex-2026-10-12T00-00-00.db",
  ]

  it("оставляет самые свежие, остальное — на удаление", () => {
    // Сначала самые старые: их удаляем, чтобы не удалить свежие по ошибке
    expect(planPrune(names, 2)).toEqual([
      "loginex-2026-10-01T00-00-00.db",
      "loginex-2026-10-05T00-00-00.db",
    ])
  })

  it("если копий меньше лимита — удалять нечего", () => {
    expect(planPrune(names, 10)).toEqual([])
  })

  it("keep=0 удаляет все наши копии", () => {
    expect(planPrune(names, 0)).toHaveLength(4)
  })

  it("сортировка по времени, а не по алфавиту", () => {
    const mixed = ["loginex-2026-10-12T00-00-00.db", "loginex-2026-10-01T00-00-00.db"]
    expect(planPrune(mixed, 1)).toEqual(["loginex-2026-10-01T00-00-00.db"])
  })

  it("чужие файлы не попадают в список на удаление", () => {
    expect(planPrune(["verify.db", ...names], 1)).toEqual([
      "loginex-2026-10-01T00-00-00.db",
      "loginex-2026-10-05T00-00-00.db",
      "loginex-2026-10-09T00-00-00.db",
    ])
  })
})

describe("настройки по умолчанию", () => {
  it("храним две недели копий в prisma/backups", () => {
    expect(DEFAULT_BACKUP_KEEP).toBe(14)
    expect(BACKUP_DIR).toBe("prisma/backups")
  })
})
