/**
 * Страж мобильного контура: какие эндпоинты зовёт водитель.
 *
 * Дважды случалось одно и то же: страница водителя обращалась к штабному
 * эндпоинту (`/api/orders/[id]`, `/api/photos/upload`) и получала 401/403 —
 * функция не работала, хотя код был написан. Проверяем по правилам доступа:
 * всё, что зовёт мобильный контур, должно быть открыто роли водителя или
 * начинаться с /api/m.
 */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { classifyRoute } = require("../.test-build/lib/auth/access.js")

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const driverDirs = [path.join(root, "app", "m"), path.join(root, "components", "driver-mobile")]

function collectFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(absolute))
    else if (/\.tsx?$/.test(entry.name)) files.push(absolute)
  }
  return files
}

const calls = []

for (const dir of driverDirs) {
  for (const file of collectFiles(dir)) {
    const source = fs.readFileSync(file, "utf-8")
    for (const match of source.matchAll(/fetch\(\s*[`"'](\/api\/[^`"'\s?]*)/g)) {
      const rawPath = match[1]
        .replace(/\$\{[^}]*\}/g, "id")
        .split("?")[0]
        .replace(/\/$/, "")
      calls.push({ file: path.relative(root, file), pathname: rawPath })
    }
  }
}

test("мобильный контур действительно обращается к API", () => {
  assert.ok(calls.length >= 20, `вызовов найдено: ${calls.length}`)
})

test("водитель не зовёт штабные эндпоинты", () => {
  const forbidden = []

  for (const call of calls) {
    // Пути с подставленным id сверяем так же, как их увидит middleware
    const area = classifyRoute(call.pathname).area
    const isDriverApi = call.pathname.startsWith("/api/m/")
    const isShared = area === "any" || area === "public"

    if (!isDriverApi && !isShared) {
      forbidden.push(`${call.file} → ${call.pathname} (${area})`)
    }
  }

  assert.deepEqual(forbidden, [], `водителю закрыты: ${forbidden.join(", ")}`)
})

test("все мобильные вызовы имеют смысл: /api/m или общий эндпоинт", () => {
  for (const call of calls) {
    assert.match(call.pathname, /^\/api\//, `${call.file}: путь должен начинаться с /api/`)
  }
})
