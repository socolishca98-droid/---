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
import { createRequire } from "node:module"
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

test("ключевые страницы не остаются без единой ссылки", () => {
  // Мёртвая ссылка — не единственная болезнь: страница может существовать и
  // работать, но попасть на неё нельзя. Так было с /m/vehicle (выбор машины
  // у водителя) и /drivers (полный список водителей).
  const sources = collectSources(root).map((file) => fs.readFileSync(file, "utf-8"))
  const blob = sources.join("\n")

  const mustBeReachable = ["/drivers", "/m/vehicle", "/reports", "/photos", "/organization"]

  for (const route of mustBeReachable) {
    const referenced =
      blob.includes(`"${route}"`) ||
      blob.includes(`'${route}'`) ||
      blob.includes("`" + route) ||
      blob.includes(`href="${route}"`)
    assert.ok(referenced, `на ${route} никто не ссылается — страница недостижима`)
  }
})

test("в приложении есть ожидаемые разделы", () => {
  for (const route of ["/login", "/m/login", "/dashboard", "/orders", "/routes", "/reports"]) {
    assert.ok(pages.has(route), `нет страницы ${route}`)
  }
})

/**
 * Навигация мобильной панели: у каждого экрана /lm один родитель, и он есть.
 *
 * Проверяем дерево целиком, а не отдельные переходы: раздел, у которого
 * родитель не существует или не указан на «Ещё», — это экран, куда можно
 * попасть, но откуда стрелка «назад» уводит в никуда.
 */
test("дерево разделов /lm: у каждого экрана есть родитель", () => {
  const require = createRequire(import.meta.url)
  const { mobileParentPath } = require("../.test-build/lib/logist-mobile/routing.js")

  const moreSource = fs.readFileSync(path.join(root, "app/lm/more/page.tsx"), "utf-8")
  const broken = []

  for (const route of pages) {
    if (!route.startsWith("/lm/") || route.includes(":id")) continue

    const parent = mobileParentPath(route)
    if (!pages.has(parent)) {
      broken.push(`${route} → ${parent} (такой страницы нет)`)
      continue
    }

    // Родитель «Ещё» — значит раздел обязан быть в списке на «Ещё», иначе
    // на экран можно попасть только по прямой ссылке.
    if (parent === "/lm/more" && !moreSource.includes(`"${route}"`)) {
      broken.push(`${route} → /lm/more, но в «Ещё» его нет`)
    }
  }

  assert.deepEqual(broken, [], `сломано дерево разделов: ${broken.join(", ")}`)
})

test("«Ещё»: 8–10 строк в двух группах и ничего из нижнего меню", () => {
  const source = fs.readFileSync(path.join(root, "app/lm/more/page.tsx"), "utf-8")
  const rows = [...source.matchAll(/href: "(\/lm\/[a-z-]+)"/g)].map((match) => match[1])
  const groups = [...source.matchAll(/<SectionGroup title="([^"]+)"/g)].map((match) => match[1])

  assert.ok(
    rows.length >= 8 && rows.length <= 10,
    `в «Ещё» должно быть 8–10 разделов, а их ${rows.length}: ${rows.join(", ")}`,
  )
  assert.equal(groups.length, 2, `групп на «Ещё» должно быть две, а их ${groups.length}`)

  const navSource = fs.readFileSync(
    path.join(root, "components/logist-mobile/bottom-nav.tsx"),
    "utf-8",
  )
  const tabs = [...navSource.matchAll(/href: "(\/lm[^"]*)"/g)].map((match) => match[1])

  for (const row of rows) {
    assert.ok(!tabs.includes(row), `${row} уже есть в нижнем меню — на «Ещё» это дубль`)
  }

  for (const row of rows) {
    assert.ok(pages.has(row), `в «Ещё» есть строка на несуществующую страницу: ${row}`)
  }
})
