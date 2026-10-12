/**
 * Тесты мониторинга ошибок (Sentry) и экранов ошибок.
 *
 * Зачем: мониторинг был подключён «на бумаге» — обёртка lib/sentry.ts есть, а
 * captureException не вызывал никто, и у приложения не было своих экранов
 * ошибок (пользователь видел английский экран Next). Оба факта легко потерять
 * при правках, поэтому проверяем их тестом.
 *
 * Запуск: npm test
 */
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, "..")

function read(relative) {
  return readFileSync(path.join(root, relative), "utf8")
}

test("обёртка Sentry работает и без DSN: не бросает и пишет в консоль", () => {
  const sentry = require("../.test-build/lib/sentry.js")

  const originalError = console.error
  const lines = []
  console.error = (...args) => lines.push(args.map(String).join(" "))
  try {
    delete process.env.SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN

    assert.doesNotThrow(() => sentry.captureException(new Error("тест"), { route: "test" }))
    assert.doesNotThrow(() => sentry.captureMessage("тест", "warning"))
    assert.doesNotThrow(() => sentry.setUser(null))
  } finally {
    console.error = originalError
  }

  assert.ok(
    lines.some((line) => line.includes("Sentry disabled") && line.includes("тест")),
    `ожидали лог о том, что мониторинг выключен, получили: ${JSON.stringify(lines)}`,
  )
})

test("captureRouteError добавляет маршрут в контекст ошибки", () => {
  const sentry = require("../.test-build/lib/sentry.js")

  const originalError = console.error
  const calls = []
  console.error = (...args) => calls.push(args)
  try {
    delete process.env.SENTRY_DSN
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    sentry.captureRouteError("api/orders", new Error("сломалось"), { orderId: "o-1" })
  } finally {
    console.error = originalError
  }

  // контекст уходит отдельным аргументом — проверяем его как есть
  const context = calls.flat().find((arg) => arg && typeof arg === "object" && "route" in arg)
  assert.ok(context, "ожидали аргумент с контекстом ошибки")
  assert.equal(context.route, "api/orders", "в отчёт должен попасть маршрут")
  assert.equal(context.orderId, "o-1", "и контекст вызова")
})

test("у приложения есть свой экран ошибки (app/error.tsx)", () => {
  const source = read("app/error.tsx")

  assert.match(source, /^"use client"/m, "граница ошибок обязана быть клиентской")
  assert.match(source, /reset\s*:\s*\(\)\s*=>\s*void/, "кнопка «попробовать снова»")
  assert.match(source, /captureException/, "ошибка уходит в мониторинг")
  assert.match(source, /Попробовать снова/, "текст на русском")
  assert.match(source, /digest/, "показываем код ошибки — по нему ищут в логах")
})

test("есть и последняя граница — app/global-error.tsx", () => {
  const source = read("app/global-error.tsx")

  assert.match(source, /^"use client"/m)
  assert.match(source, /<html/, "корневой layout сломан — нужен свой html")
  assert.match(source, /<body/, "и свой body")
  assert.match(source, /Попробовать снова/, "текст на русском")
})

test("ключевые маршруты отправляют ошибки в мониторинг", () => {
  const routes = [
    ["app/api/photos/upload/route.ts", "api/photos/upload"],
    ["app/api/auth/login/route.ts", "api/auth/login"],
    ["app/api/auth/register/route.ts", "api/auth/register"],
    ["app/api/m/login/route.ts", "api/m/login"],
    ["app/api/orders/route.ts", "api/orders"],
    ["app/api/routes/route.ts", "api/routes"],
    ["app/api/ati/cron/route.ts", "api/ati/cron"],
    ["app/api/chat/route.ts", "api/chat"],
  ]

  for (const [file, route] of routes) {
    const source = read(file)
    // кавычки в файле могут быть любыми — важно имя маршрута
    assert.match(
      source,
      new RegExp(`captureRouteError\\(['"]${route.replace(/\//g, "\\/")}['"]`),
      `${file} должен отправлять ошибки в мониторинг`,
    )
    assert.match(source, /from "@\/lib\/sentry"/, `${file} должен импортировать обёртку`)
  }
})
