/**
 * Тесты списка эндпоинтов для страницы /docs (lib/api-docs/endpoints.ts).
 *
 * Смысл: страница документации должна описывать код, а не то, что кто-то
 * вписал руками. Проверяем на настоящем каталоге app/api: список полон,
 * методы настоящие, динамические сегменты читаемы, удалённые роуты исчезают,
 * и в спецификации не осталось пароля.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { collectEndpoints, groupEndpoints, readOpenApiSummary, sortEndpoints } = require(
  "../.test-build/lib/api-docs/endpoints.js"
)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const apiDir = path.join(root, "app", "api")
const endpoints = collectEndpoints(apiDir)

function find(route, method) {
  return endpoints.find((endpoint) => endpoint.route === route && endpoint.method === method)
}

test("список эндпоинтов читается из кода, а не из рукописного текста", () => {
  assert.ok(endpoints.length > 50, `ожидалось много эндпоинтов, найдено ${endpoints.length}`)
  // У каждой записи есть метод и путь — иначе её некуда показывать
  for (const endpoint of endpoints) {
    assert.match(endpoint.method, /^(GET|POST|PATCH|PUT|DELETE)$/)
    assert.match(endpoint.route, /^\/api\//)
    assert.equal(endpoint.group, endpoint.route.split("/").filter(Boolean)[1])
  }
})

test("методы берутся из экспортов обработчика, посторонний текст им не считается", () => {
  assert.deepEqual(
    sortEndpoints(endpoints)
      .filter((endpoint) => endpoint.route === "/api/photos/upload")
      .map((endpoint) => endpoint.method),
    ["POST"],
  )

  assert.deepEqual(
    sortEndpoints(endpoints)
      .filter((endpoint) => endpoint.route === "/api/m/photos")
      .map((endpoint) => endpoint.method),
    ["GET", "DELETE"],
  )
})

test("динамические сегменты читаются как :параметр", () => {
  assert.ok(find("/api/routes/:routeId/expenses", "POST"), "расходы рейса должны быть в списке")
  assert.ok(find("/api/orders/:id/negotiation", "POST"), "согласование заказа должно быть в списке")
  assert.ok(find("/api/reports/export", "GET"), "выгрузка отчёта должна быть в списке")

  for (const endpoint of endpoints) {
    assert.ok(
      !endpoint.route.includes("["),
      `в пути остались квадратные скобки: ${endpoint.route}`,
    )
  }
})

test("роуты удалённых файлов не показываются, новые появляются сами", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-docs-"))

  try {
    fs.mkdirSync(path.join(tempDir, "billing", "[invoiceId]"), { recursive: true })

    // Только комментарий про метод — не метод: в списке его быть не должно
    fs.mkdirSync(path.join(tempDir, "comments"), { recursive: true })
    fs.writeFileSync(
      path.join(tempDir, "comments", "route.ts"),
      "// export async function DELETE(request) {}\n",
      "utf-8",
    )

    fs.writeFileSync(
      path.join(tempDir, "billing", "[invoiceId]", "route.ts"),
      "export async function GET() {}\nexport function PATCH() {}\n",
      "utf-8",
    )

    const found = collectEndpoints(tempDir)

    assert.deepEqual(
      found.map((endpoint) => `${endpoint.method} ${endpoint.route}`),
      ["GET /api/billing/:invoiceId", "PATCH /api/billing/:invoiceId"],
    )
    assert.equal(groupEndpoints(found).get("billing").length, 2)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test("несуществующий каталог не роняет страницу", () => {
  assert.deepEqual(collectEndpoints(path.join(root, "app", "нет-такого-каталога")), [])
})

test("спецификация измеряется по факту, а не на слово", () => {
  const specPath = path.join(root, "docs", "openapi.yaml")
  const spec = readOpenApiSummary(specPath, endpoints)

  assert.ok(spec, "docs/openapi.yaml должен читаться")
  assert.ok(spec.routes > 0, "в спецификации должны быть пути")
  assert.ok(spec.methods > 0, "в спецификации должны быть методы")
  assert.ok(spec.covered <= spec.routes, "покрытие не может быть больше числа путей")
  assert.ok(spec.covered > 0, "хотя бы часть путей спецификации должна существовать в коде")
})

test("манифест docs/api-endpoints.json не устарел", () => {
  // Страница /docs берёт список импортом из манифеста (в собранном образе
  // исходников рядом нет). Значит, манифест обязан совпадать с кодом, иначе
  // документация начнёт врать — именно от этого её и лечили.
  const manifestPath = path.join(root, "docs", "api-endpoints.json")
  assert.ok(fs.existsSync(manifestPath), "нет docs/api-endpoints.json — запустите npm run docs:api")

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
  const fromCode = endpoints.map(({ method, route }) => `${method} ${route}`)
  const fromManifest = manifest.endpoints.map(({ method, route }) => `${method} ${route}`)

  assert.deepEqual(
    fromManifest,
    fromCode,
    "манифест разошёлся с кодом: обновите его командой npm run docs:api",
  )
  assert.ok(manifest.generatedAt, "в манифесте должна быть дата сборки")
})

test("в документации и спецификации нет пароля администратора", () => {
  assert.ok(!fs.readFileSync(path.join(root, "docs", "openapi.yaml"), "utf-8").includes("demo_dev_only"))
  assert.ok(!fs.readFileSync(path.join(root, "app", "docs", "page.tsx"), "utf-8").includes("demo_dev_only"))
})
