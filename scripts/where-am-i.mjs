#!/usr/bin/env node
// scripts/where-am-i.mjs
//
// Диагностика локальной копии: что именно лежит на диске, из какого оно
// репозитория, на какой ветке, какие коммиты уже есть, а каких не хватает.
//
// Запуск из папки проекта:  node scripts/where-am-i.mjs
//
// Ничего не меняет — только читает и печатает. Нужен, когда непонятно:
// «это та копия проекта, где вся работа, или старая?».

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.status !== 0) return null
  return (result.stdout || "").trim()
}

function line(title) {
  console.log("\n" + title)
  console.log("─".repeat(Math.max(title.length, 40)))
}

const isRepo = git(["rev-parse", "--is-inside-work-tree"]) === "true"
if (!isRepo) {
  console.log("Это не git-репозиторий: в текущей папке нет .git")
  console.log("Скорее всего, проект просто скачан архивом — тогда git-команд не будет.")
  process.exit(0)
}

const root = git(["rev-parse", "--show-toplevel"]) || process.cwd()
process.chdir(root)

line("1. Где мы")
console.log("Папка проекта:   ", root)
const remotes = git(["remote", "-v"]) || "(нет ни одного remote — код никуда не отправлялся)"
console.log("Репозитории (remote):")
for (const row of remotes.split("\n")) console.log("  ", row)

line("2. Текущая ветка и её состояние")
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "(не определена)"
console.log("Ветка:           ", branch)
const head = git(["rev-parse", "HEAD"]) || "—"
const headInfo = git(["log", "-1", "--pretty=%h · %ad · %s", "--date=short"]) || "—"
console.log("Последний коммит:", headInfo)
const behind = git(["rev-list", "--left-right", "--count", `HEAD...@{u}`])
if (behind) {
  const [ahead, behindCount] = behind.split(/\s+/).map(Number)
  console.log(`Относительно удалённой ветки: впереди ${ahead}, отстаём ${behindCount}`)
}
const dirty = (git(["status", "--porcelain"]) || "").split("\n").filter(Boolean)
console.log(`Незакоммиченных изменений: ${dirty.length}`)
for (const row of dirty.slice(0, 15)) console.log("  ", row)
if (dirty.length > 15) console.log(`   … и ещё ${dirty.length - 15}`)

line("3. Какой это проект")
const markers = [
  ["proxy.ts", "наш проект (Loginex TMS)"],
  ["instrumentation.ts", "наш проект (Loginex TMS)"],
  ["lib/auth/constants.ts", "наша авторизация"],
  ["lib/client-cache.ts", "работа последней сессии (кеш)"],
  ["components/ui/data-table.tsx", "работа последней сессии (таблицы)"],
  ["docs/postgres-migration.md", "наша документация"],
  ["lib/session.ts", "файл, которого в нашем репозитории НЕТ"],
  ["create-admin.ts", "файл, которого в нашем репозитории НЕТ"],
]
for (const [file, meaning] of markers) {
  const there = existsSync(path.join(root, file))
  console.log(`  ${there ? "✓" : "·"} ${file.padEnd(34)} ${there ? meaning : ""}`)
}

line("4. Какие коммиты уже есть на диске")
const known = [
  ["40622a2", "main на GitHub (21 сентября, самое начало)"],
  ["b8f4e4e", "P0–P2: безопасность, Postgres, Docker, CI (22 сентября)"],
  ["3e49578", "сквозная проверка заказов и чата"],
  ["8df7e37", "последняя работа: кеш, скелетоны, таблицы, README"],
]
for (const [sha, about] of known) {
  const exists = git(["cat-file", "-e", `${sha}^{commit}`])
  let verdict = "нет в локальной копии"
  if (exists !== null) {
    const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"]).status === 0
    verdict = ancestor ? "ЕСТЬ в текущей ветке" : "есть в репозитории, но НЕ в этой ветке"
  }
  console.log(`  ${sha}  ${about}\n      → ${verdict}`)
}

line("5. Что делать дальше")
const hasSessionWork = git(["cat-file", "-e", "8df7e37^{commit}"]) !== null
const sessionIsHead = spawnSync("git", ["merge-base", "--is-ancestor", "8df7e37", "HEAD"]).status === 0

if (sessionIsHead) {
  console.log("Отлично: это копия с самой полной версией проекта (ветка содержит всю работу).")
  console.log("Дальше: npm install → .env → npm run db:push → npm run seed:auth → npm run dev")
} else if (hasSessionWork) {
  console.log("В репозитории есть свежие коммиты, но текущая ветка их не содержит.")
  console.log("Переключитесь на ветку с работой:")
  console.log("  git fetch --all --prune")
  console.log("  git checkout arena/01a0c0e1-repo")
  console.log("  git pull")
} else {
  console.log("Свежих коммитов в локальной копии нет — нужно забрать их с GitHub:")
  console.log("  git fetch --all --prune")
  console.log("  git checkout arena/01a0c0e1-repo")
  console.log("  git pull")
  console.log("Если ветки нет локально, git создаст её сам из удалённой.")
}
console.log("\nНичего не изменено: скрипт только читал данные.\n")
