/**
 * Тесты генерации PostgreSQL-схемы (scripts/make-postgres-schema.mjs):
 * продакшен-схема обязана совпадать с исходной по составу моделей, но быть
 * на провайдере postgresql и держать организацию обязательной — «ничейная»
 * запись бизнес-данных в проде это дыра, а не удобство отладки.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(root, "prisma", "schema.prisma")
const target = join(root, "prisma", "postgres", "schema.prisma")

function generate() {
  const result = spawnSync(process.execPath, [join(root, "scripts", "make-postgres-schema.mjs")], {
    cwd: root,
    encoding: "utf8",
  })
  assert.equal(result.status, 0, `генерация упала: ${result.stderr || result.stdout}`)
  return readFileSync(target, "utf8")
}

/** Модели → текст тела модели. */
function modelBodies(schemaText) {
  const bodies = new Map()
  const re = /^model (\w+) \{([\s\S]*?)^\}$/gm
  let match
  while ((match = re.exec(schemaText)) !== null) bodies.set(match[1], match[2])
  return bodies
}

// ---------------------------------------------------------------------------

test("генерация создаёт схему на провайдере postgresql", () => {
  const generated = generate()
  assert.ok(existsSync(target))
  assert.match(generated, /provider\s*=\s*"postgresql"/)
  assert.doesNotMatch(generated, /provider\s*=\s*"sqlite"/)
  assert.match(generated, /СГЕНЕРИРОВАННЫЙ ФАЙЛ/)
})

test("состав моделей не разъезжается с исходной схемой", () => {
  const generated = generate()
  const original = readFileSync(source, "utf8")
  const originalModels = [...modelBodies(original).keys()].sort()
  const generatedModels = [...modelBodies(generated).keys()].sort()
  assert.deepEqual(generatedModels, originalModels)
  assert.ok(originalModels.length >= 20, "схема должна содержать все модели проекта")
})

test("в бизнес-моделях организация обязательна (NOT NULL)", () => {
  const generated = generate()
  const bodies = modelBodies(generated)
  const strict = [
    "Order", "Route", "RouteExpense", "RouteStage", "RouteEvent",
    "Vehicle", "Driver", "DriverShift", "ShiftEvent", "SosAlert",
    "Notification", "ChatMessage", "Photo", "MaintenanceLog", "FleetSettings",
    "Client", "AtiCache", "AtiConnection", "AtiScanConfig", "OrderNegotiation",
  ]
  for (const model of strict) {
    const body = bodies.get(model)
    assert.ok(body, `модель ${model} должна быть в схеме`)
    assert.match(body, /organizationId\s+String(?!\?)/, `${model}: organizationId должен быть обязательным`)
    assert.match(body, /organization\s+Organization\s+@relation/, `${model}: связь organization обязательна`)
  }
})

test("исключения остаются nullable: User, AuditLog, PushSubscription", () => {
  const generated = generate()
  const bodies = modelBodies(generated)
  // Заявка без организации, действия владельца платформы и подписка на пуши
  for (const model of ["User", "AuditLog", "PushSubscription"]) {
    const body = bodies.get(model)
    assert.ok(body, `модель ${model} должна быть в схеме`)
    assert.match(body, /organizationId\s+String\?/, `${model}: организация остаётся необязательной`)
  }
})

test("генерация идемпотентна: повторный запуск даёт тот же файл", () => {
  const first = generate()
  const second = generate()
  assert.equal(first, second)
})
