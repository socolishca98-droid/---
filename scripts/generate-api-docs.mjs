// scripts/generate-api-docs.mjs
//
// Собирает список эндпоинтов в docs/api-endpoints.json.
//
// Зачем файл, а не чтение исходников на странице: в собранном образе
// (Docker/standalone) каталога app/ рядом нет, поэтому сканирование на месте
// вернуло бы пустой список. Манифест генерируется при сборке, попадает в
// бандл обычным импортом и потому доступен всегда.
//
// Запуск: npm run docs:api (он же — автоматически перед npm run build).
// Тест tests/api-docs.test.mjs следит, чтобы манифест не устарел: если
// эндпоинты изменились, тест укажет пересобрать файл.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const METHOD_ORDER = ["GET", "POST", "PATCH", "PUT", "DELETE"]

function collectEndpoints(dir, base = "") {
  if (!fs.existsSync(dir)) return []
  const found = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      found.push(...collectEndpoints(absolute, `${base}/${entry.name}`))
      continue
    }

    if (entry.name !== "route.ts" && entry.name !== "route.tsx") continue

    const source = fs.readFileSync(absolute, "utf-8")
    // ^ — метод должен быть объявлен кодом, а не упомянут в комментарии
    const methods = METHOD_ORDER.filter((method) =>
      new RegExp(`^export\\s+(async\\s+)?function\\s+${method}\\b`, "m").test(source),
    )

    if (methods.length === 0) continue

    const route = `/api${base}`.replace(/\/\[([^\]]+)\]/g, "/:$1")

    for (const method of methods) {
      found.push({
        method,
        route,
        group: route.split("/").filter(Boolean)[1] ?? "прочее",
      })
    }
  }

  return found.sort(
    (a, b) =>
      a.route.localeCompare(b.route) ||
      METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method),
  )
}

function readOpenApi(endpoints) {
  const yamlPath = path.join(root, "docs", "openapi.yaml")
  if (!fs.existsSync(yamlPath)) return null

  const yaml = fs.readFileSync(yamlPath, "utf-8")
  const specRoutes = Array.from(yaml.matchAll(/^ {2}(\/[\w/{}\-.:]+):/gm)).map((match) => match[1])
  const codeRoutes = new Set(endpoints.map((endpoint) => endpoint.route))

  return {
    title: yaml.match(/^\s{2}title:\s*(.+)$/m)?.[1]?.trim() ?? "OpenAPI",
    version: yaml.match(/^\s{2}version:\s*(.+)$/m)?.[1]?.trim() ?? "—",
    routes: specRoutes.length,
    methods: (yaml.match(/^ {4}(get|post|patch|put|delete):/gm) ?? []).length,
    covered: specRoutes.filter((route) => codeRoutes.has(route)).length,
  }
}

const endpoints = collectEndpoints(path.join(root, "app", "api"))

const manifest = {
  // Дата генерации видна на странице — понятно, насколько список свежий
  generatedAt: new Date().toISOString(),
  endpoints,
  openApi: readOpenApi(endpoints),
}

const target = path.join(root, "docs", "api-endpoints.json")
fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n", "utf-8")

console.log(
  `docs/api-endpoints.json: ${endpoints.length} эндпоинтов` +
    (manifest.openApi ? `, в спецификации ${manifest.openApi.routes} путей (${manifest.openApi.covered} из кода)` : ""),
)
