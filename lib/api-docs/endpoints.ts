// lib/api-docs/endpoints.ts
//
// Список эндпоинтов прямо из кода приложения.
//
// Зачем это отдельным модулем: страница /docs раньше показывала вручную
// вписанный список и расходилась с реальностью (ссылки на несуществующие
// файлы, устаревшие цифры). Источник правды — каталог `app/api`: если
// обработчик есть, он попадёт в список; если его удалили, он исчезнет.
// Модуль не зависит от React, поэтому проверяется тестами.

import fs from "node:fs"
import path from "node:path"

export type Endpoint = {
  /** HTTP-метод: GET, POST, PATCH, PUT, DELETE */
  method: string
  /** Путь в стиле спецификации: /api/routes/:routeId/expenses */
  route: string
  /** Первый сегмент после /api — для группировки в интерфейсе */
  group: string
}

export const METHOD_ORDER = ["GET", "POST", "PATCH", "PUT", "DELETE"]

export function groupOf(route: string): string {
  const segments = route.split("/").filter(Boolean)
  return segments[1] ?? "прочее"
}

/** Для читаемости: методы идут в привычном порядке, пути — по алфавиту */
export function sortEndpoints(endpoints: Endpoint[]): Endpoint[] {
  return [...endpoints].sort(
    (a, b) =>
      a.route.localeCompare(b.route) ||
      METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method),
  )
}

export function groupEndpoints(endpoints: Endpoint[]): Map<string, Endpoint[]> {
  const groups = new Map<string, Endpoint[]>()
  for (const endpoint of endpoints) {
    const list = groups.get(endpoint.group) ?? []
    list.push(endpoint)
    groups.set(endpoint.group, list)
  }
  return groups
}

/**
 * Обход каталога `app/api` и разбор обработчиков.
 *
 * Метод считаем существующим только если в файле есть его экспорт-функция:
 * комментарий или строка в тексте за метод не считаются (иначе в списке
 * появлялись бы методы, которых нет).
 */
export function collectEndpoints(dir: string, base = ""): Endpoint[] {
  if (!fs.existsSync(dir)) return []

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const found: Endpoint[] = []

  for (const entry of entries) {
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

    // [routeId] → :routeId — так путь читается и совпадает со стилем спецификации
    const route = `/api${base}`.replace(/\/\[([^\]]+)\]/g, "/:$1")

    for (const method of methods) {
      found.push({ method, route, group: groupOf(route) })
    }
  }

  return sortEndpoints(found)
}

export type OpenApiSummary = {
  title: string
  version: string
  routes: number
  methods: number
  /** Сколько путей спецификации из существующих в коде (грубая, но честная оценка) */
  covered: number
}

/** Что описано в docs/openapi.yaml — без YAML-парсера, по структуре файла. */
export function readOpenApiSummary(
  filePath = path.join(process.cwd(), "docs", "openapi.yaml"),
  endpoints: Endpoint[] = [],
): OpenApiSummary | null {
  if (!fs.existsSync(filePath)) return null

  const yaml = fs.readFileSync(filePath, "utf-8")
  const specRoutes = Array.from(yaml.matchAll(/^ {2}(\/[\w/{}\-.:]+):/gm)).map((match) => match[1])
  const methods = (yaml.match(/^ {4}(get|post|patch|put|delete):/gm) ?? []).length
  const title = yaml.match(/^\s{2}title:\s*(.+)$/m)?.[1]?.trim() ?? "OpenAPI"
  const version = yaml.match(/^\s{2}version:\s*(.+)$/m)?.[1]?.trim() ?? "—"

  const codeRoutes = new Set(endpoints.map((endpoint) => endpoint.route))
  const covered = specRoutes.filter((route) => codeRoutes.has(route)).length

  return { title, version, routes: specRoutes.length, methods, covered }
}
