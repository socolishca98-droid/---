/**
 * Тесты чистых правил редактирования профиля (lib/profile.ts).
 *
 * Проверяем ровно то, что должен гарантировать роут PATCH /api/auth/profile:
 * имя нормализуется, телефон приводится к каноническому виду («79112223344»),
 * мусор отвергается, а пустой телефон — это «убрать» (value: null), и уже роут
 * решает по роли, можно ли.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  normalizeProfileName,
  normalizeProfilePhone,
  validateProfileName,
  validateProfilePhone,
} = require("../.test-build/lib/profile.js")

test("имя: края и лишние пробелы убираются", () => {
  assert.equal(normalizeProfileName("  Иван   Иванов "), "Иван Иванов")
  assert.equal(normalizeProfileName(null), "")
  assert.equal(normalizeProfileName(42), "42")
})

test("имя: нормальное проходит, пустое и короткое — нет", () => {
  assert.deepEqual(validateProfileName("Иван Иванов"), { ok: true, value: "Иван Иванов" })
  assert.equal(validateProfileName("").ok, false)
  assert.equal(validateProfileName("   ").ok, false)
  assert.equal(validateProfileName("Я").ok, false)
  assert.equal(validateProfileName("Я".repeat(80)).ok, true)
  assert.equal(validateProfileName("Я".repeat(81)).ok, false)
})

test("имя: сообщение об ошибке есть всегда", () => {
  const result = validateProfileName("")
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.error.length > 0)
})

test("телефон: любые разделители дают один канонический номер", () => {
  assert.equal(normalizeProfilePhone("+7 (911) 222-33-44"), "79112223344")
  assert.equal(normalizeProfilePhone("89112223344"), "79112223344")
  assert.equal(normalizeProfilePhone(" 8 911 222 33 44 "), "79112223344")
})

test("телефон: пустое поле — «убрать телефон», а не ошибка", () => {
  assert.deepEqual(validateProfilePhone(""), { ok: true, value: null })
  assert.deepEqual(validateProfilePhone("   "), { ok: true, value: null })
  assert.deepEqual(validateProfilePhone(undefined), { ok: true, value: null })
})

test("телефон: слишком короткий и слишком длинный отвергаются", () => {
  assert.equal(validateProfilePhone("+7 911 222").ok, false)
  assert.equal(validateProfilePhone("1234567890123456").ok, false)
  assert.deepEqual(validateProfilePhone("79112223344"), { ok: true, value: "79112223344" })
  assert.deepEqual(validateProfilePhone("+7 911 222-33-44"), {
    ok: true,
    value: "79112223344",
  })
})
