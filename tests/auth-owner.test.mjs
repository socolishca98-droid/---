/**
 * Тесты правила «кто может войти в любой аккаунт» (lib/auth/owner.ts).
 *
 * Правило простое и намеренно узкое: это не роль в базе, а конкретный email.
 * Значит проверять надо две вещи — что владелец узнаётся и что никто другой
 * им не притворится (регистр, лишние пробелы, пустое значение, чужой email).
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { isOwnerEmail, ownerEmails, DEFAULT_OWNER_EMAIL } = require("../.test-build/lib/auth/owner.js")

test("владелец узнаётся по своему email", () => {
  assert.equal(isOwnerEmail("socolishca98@gmail.com"), true)
  assert.equal(isOwnerEmail(DEFAULT_OWNER_EMAIL), true)
})

test("регистр и пробелы не помогают чужим, но не мешают владельцу", () => {
  assert.equal(isOwnerEmail("  Socolishca98@Gmail.com  "), true)
  assert.equal(isOwnerEmail("socolishca98@gmail.com "), true)
})

test("любой другой email — не владелец", () => {
  assert.equal(isOwnerEmail("admin@loginex.local"), false)
  assert.equal(isOwnerEmail("socolishca98@gmail.com.evil.ru"), false)
  assert.equal(isOwnerEmail("socolishca98+другой@gmail.com"), false)
})

test("пустое значение — не владелец, без исключений", () => {
  assert.equal(isOwnerEmail(null), false)
  assert.equal(isOwnerEmail(undefined), false)
  assert.equal(isOwnerEmail(""), false)
  assert.equal(isOwnerEmail("   "), false)
})

test("OWNER_EMAIL из окружения добавляет владельца, а не заменяет основного", () => {
  const env = { OWNER_EMAIL: "boss@example.com" }
  assert.equal(isOwnerEmail("boss@example.com", env), true)
  // значение по умолчанию остаётся владельцем даже при своём OWNER_EMAIL
  assert.equal(isOwnerEmail(DEFAULT_OWNER_EMAIL, env), true)
  assert.equal(isOwnerEmail("чужой@example.com", env), false)
})

test("несколько владельцев задаются через запятую", () => {
  const env = { OWNER_EMAIL: "a@x.ru, b@y.ru" }
  const list = ownerEmails(env)
  assert.ok(list.includes("a@x.ru"))
  assert.ok(list.includes("b@y.ru"))
  assert.equal(isOwnerEmail("a@x.ru", env), true)
})
