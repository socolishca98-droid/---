/**
 * Проверка ссылок: каждый переход внутри приложения ведёт на существующую страницу.
 *
 * Зачем: мёртвая ссылка не роняет сборку и не видна в тестах — пользователь
 * просто попадает на 404. Так уже было с «Настройками» в боковом меню
 * (/settings) и вообще без ссылки — со страницей выбора машины у водителя.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Все страницы App Router: app/orders/[id]/page.tsx → /orders/:id */
function collectPages(dir, base = "") {
  const pages = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // Каталоги с «_» и «.» в App Router не являются маршрутами
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue
      pages.push(...collectPages(absolute, `${base}/${entry.name}`))
      continue
    }

    if (entry.name === "page.tsx" || entry.name === "page.ts") {
      pages.push(base || "/")
    }
  }

  return pages
}

function normalize(route) {
  const normalized = route.replace(/\[[^\]]+\]/g, ":id").replace(/\/$/, "")
  return normalized || "/"
}

const pages = new Set(collectPages(path.join(root, "app")).map(normalize))

function collectSources(dir) {
  const files = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", ".test-build", "public"].includes(entry.name)) continue
    const absolute = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectSources(absolute))
      continue
    }

    if (/\.tsx?$/.test(entry.name)) files.push(absolute)
  }

  return files
}

/** Внутренние переходы: href, router.push, router.replace, redirect */
function collectLinks(source) {
  const links = []
  const pattern = /(?:href=|router\.(?:push|replace)\(|redirect\()["'`](\/[A-Za-z0-9_\-/[\]${}.%]*)/g

  for (const match of source.matchAll(pattern)) {
    let route = match[1].split("?")[0].split("#")[0]
    if (route.startsWith("/api") || route.startsWith("/uploads") || route.startsWith("//")) continue

    // `${...}` в шаблонной строке — подстановка (id, статус), сверяем шаблон
    // Ссылка со строкой запроса внутри шаблона (/m/photo${action.status ? ...})
    route = route.split("${")[0]
    route = route.replace(/:id\/?$/, ":id")

    links.push(route)
  }

  return links
}

test("внутренние переходы ведут на существующие страницы", () => {
  const broken = []

  for (const file of collectSources(root)) {
    const source = fs.readFileSync(file, "utf-8")

    for (const route of collectLinks(source)) {
      const candidate = normalize(route)
      if (!pages.has(candidate)) {
        broken.push(`${path.relative(root, file)} → ${route}`)
      }
    }
  }

  assert.deepEqual(broken, [], `ссылки без страницы: ${broken.join(", ")}`)
})

test("в приложении есть ожидаемые разделы", () => {
  for (const route of ["/login", "/m/login", "/dashboard", "/orders", "/routes", "/reports"]) {
    assert.ok(pages.has(route), `нет страницы ${route}`)
  }
})
