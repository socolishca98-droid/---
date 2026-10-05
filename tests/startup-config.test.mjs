/**
 * Тесты проверки конфигурации при старте сервера (lib/auth/startup.ts).
 *
 * Смысл: сервер не должен подниматься без AUTH_SECRET — не «требовать его
 * в комментарии» и не падать на первом запросе, а отказываться стартовать.
 * instrumentation.ts вызывает collectStartupIssues() и делает process.exit(1).
 *
 * Запуск: npm test
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const {
  collectStartupIssues,
  formatStartupFailure,
  assertStartupConfig,
} = require("../.test-build/lib/auth/startup.js")
const { getAuthSecret, AuthSecretError } = require("../.test-build/lib/auth/token.js")

const VALID = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz"
const DB = "file:./dev.db"

test("без AUTH_SECRET старт запрещён: одна проблема с кодом auth_secret", () => {
  const issues = collectStartupIssues({ DATABASE_URL: DB })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, "auth_secret")
  assert.match(issues[0].message, /AUTH_SECRET не задан/)
  assert.throws(() => assertStartupConfig({ DATABASE_URL: DB }), /СЕРВЕР НЕ ЗАПУЩЕН/)
})

test("пустой AUTH_SECRET (пустая строка и пробелы) — тоже отказ", () => {
  for (const value of ["", "   ", "\t\n"]) {
    const issues = collectStartupIssues({ AUTH_SECRET: value, DATABASE_URL: DB })
    assert.equal(issues.length, 1, `значение ${JSON.stringify(value)} должно блокировать старт`)
    assert.equal(issues[0].code, "auth_secret")
  }
})

test("короткий AUTH_SECRET (<32 символов) — отказ с понятной причиной", () => {
  const issues = collectStartupIssues({ AUTH_SECRET: "короткий", DATABASE_URL: DB })
  assert.equal(issues.length, 1)
  assert.match(issues[0].message, /минимум 32 символа/)
})

test("с валидным AUTH_SECRET старт разрешён", () => {
  assert.deepEqual(collectStartupIssues({ AUTH_SECRET: VALID, DATABASE_URL: DB }), [])
  assert.doesNotThrow(() => assertStartupConfig({ AUTH_SECRET: VALID, DATABASE_URL: DB }))
})

test("без DATABASE_URL старт тоже запрещён: база нужна до первого запроса", () => {
  const issues = collectStartupIssues({ AUTH_SECRET: VALID })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].code, "database_url")
  assert.match(issues[0].message, /DATABASE_URL/)
  assert.throws(() => assertStartupConfig({ AUTH_SECRET: VALID }), /СЕРВЕР НЕ ЗАПУЩЕН/)
})

test("пробелы по краям секрета не ломают проверку (секрет тримится)", () => {
  assert.deepEqual(collectStartupIssues({ AUTH_SECRET: `  ${VALID}  `, DATABASE_URL: DB }), [])
  assert.equal(getAuthSecret({ AUTH_SECRET: `  ${VALID}  ` }), VALID)
})

test("getAuthSecret бросает AuthSecretError — его ловит middleware (503)", () => {
  assert.throws(() => getAuthSecret({}), AuthSecretError)
  assert.throws(() => getAuthSecret({ AUTH_SECRET: "x".repeat(31) }), AuthSecretError)
  assert.equal(getAuthSecret({ AUTH_SECRET: "x".repeat(32) }), "x".repeat(32))
})

test("текст отказа объясняет, что сделать (команда генерации и .env)", () => {
  const text = formatStartupFailure(collectStartupIssues({}))
  assert.match(text, /СЕРВЕР НЕ ЗАПУЩЕН/)
  assert.match(text, /randomBytes\(48\)/)
  assert.match(text, /\.env/)
  assert.match(text, /подделать cookie/)
})

test("collectStartupIssues по умолчанию читает process.env", () => {
  const saved = process.env.AUTH_SECRET
  const savedDb = process.env.DATABASE_URL
  try {
    process.env.DATABASE_URL = DB
    delete process.env.AUTH_SECRET
    assert.equal(collectStartupIssues().length, 1)
    process.env.AUTH_SECRET = VALID
    assert.deepEqual(collectStartupIssues(), [])
  } finally {
    if (saved === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = saved
    if (savedDb === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = savedDb
  }
})
