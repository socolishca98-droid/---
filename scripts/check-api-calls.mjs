// scripts/check-api-calls.mjs
//
// Проверка: всё, к чему обращается клиентский и серверный код через fetch,
// существует как обработчик роута. Такой класс ошибок тихий — страница просто
// получает 404 и показывает пустоту; найти его глазами сложно.
//
// Запуск: node scripts/check-api-calls.mjs
// Выход: список путей, которых нет в app/api (пустой список — всё в порядке).

import fs from "node:fs"
import path from "node:path"

const root = process.cwd()

/** Собираем существующие роуты (копия логики lib/api-docs, но без TS) */
function collectRoutes(dir, base = "") {
  if (!fs.existsSync(dir)) return []
  const routes = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      routes.push(...collectRoutes(absolute, `${base}/${entry.name}`))
      continue
    }
    if (entry.name !== "route.ts" && entry.name !== "route.tsx") continue
    routes.push(`/api${base}`.replace(/\/\[([^\]]+)\]/g, "/:$1"))
  }

  return routes
}

const routes = new Set(collectRoutes(path.join(root, "app", "api")))

// Путь с любым динамическим сегментом совпадает, если совпадают остальные части
function exists(candidate) {
  if (routes.has(candidate)) return true

  const parts = candidate.split("/").filter(Boolean)
  for (const route of routes) {
    const routeParts = route.split("/").filter(Boolean)
    if (routeParts.length !== parts.length) continue
    const same = routeParts.every(
      (segment, index) =>
        segment.startsWith(":") || parts[index].startsWith(":") || segment === parts[index],
    )
    if (same) return true
  }

  return false
}

const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (["node_modules", ".next", ".test-build", ".git", "public"].includes(entry.name)) continue
      walk(absolute)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry.name)) files.push(absolute)
  }
}
walk(root)

const problems = []

for (const file of files) {
  const source = fs.readFileSync(file, "utf-8")

  for (const match of source.matchAll(/fetch\(\s*[`"'](\/api\/[^`"'\s?]*)/g)) {
    const raw = match[1]
    const candidate = raw
      // `${query}` в шаблонной строке — это строка запроса, а не часть пути
      .replace(/\$\{(query|qs|params|searchParams)[^}]*\}/g, "")
      // `/api/orders/${id}` → /api/orders/:id
      .replace(/\$\{[^}]*\}/g, ":id")
      .split("?")[0]
      .replace(/\/$/, "")

    // Хвост вида `/api/photos${query.size > 0 ? ... : ""}` — путь без параметров
    const head = raw.split("${")[0].split("?")[0].replace(/\/$/, "")

    if (!exists(candidate) && !(head && exists(head))) {
      problems.push(`${path.relative(root, file)} → ${raw}`)
    }
  }
}

if (problems.length === 0) {
  console.log(`Проверено файлов: ${files.length}. Все вызовы /api/* существуют (${routes.size} роутов).`)
} else {
  console.log(`Найдены вызовы несуществующих роутов (${problems.length}):`)
  for (const problem of problems) console.log("  " + problem)
  process.exitCode = 1
}
