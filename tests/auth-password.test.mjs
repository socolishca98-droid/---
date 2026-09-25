/**
 * Тесты хеширования паролей (scrypt + соль).
 * Запуск: npm test
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  generateTemporaryPassword,
  MIN_PASSWORD_LENGTH,
} = require("../.test-build/lib/auth/password.js")

test("пароль проходит проверку по своему хэшу", async () => {
  const { hash, salt } = await hashPassword("СекретныйПароль2026")
  assert.equal(typeof hash, "string")
  assert.equal(typeof salt, "string")
  assert.equal(salt.length, 32, "соль — 16 байт в hex")
  assert.equal(hash.length, 128, "ключ — 64 байта в hex")
  assert.equal(await verifyPassword("СекретныйПароль2026", hash, salt), true)
})

test("неверный пароль не проходит", async () => {
  const { hash, salt } = await hashPassword("ПравильныйПароль1")
  assert.equal(await verifyPassword("НеправильныйПароль1", hash, salt), false)
  assert.equal(await verifyPassword("", hash, salt), false)
  assert.equal(await verifyPassword("правильныйпароль1", hash, salt), false)
})

test("одинаковые пароли дают разные хэши (соль случайная)", async () => {
  const a = await hashPassword("ОдинИТотЖеПароль1")
  const b = await hashPassword("ОдинИТотЖеПароль1")
  assert.notEqual(a.salt, b.salt)
  assert.notEqual(a.hash, b.hash)
  // при этом оба хэша валидны для исходного пароля
  assert.equal(await verifyPassword("ОдинИТотЖеПароль1", a.hash, a.salt), true)
  assert.equal(await verifyPassword("ОдинИТотЖеПароль1", b.hash, b.salt), true)
})

test("повреждённые данные не роняют проверку", async () => {
  assert.equal(await verifyPassword("Пароль123", "", ""), false)
  assert.equal(await verifyPassword("Пароль123", "не-hex", "не-hex"), false)
  assert.equal(await verifyPassword("Пароль123", "ab".repeat(64), "cd".repeat(16)), false)
})

test("пробелы в пароле значимы (не trim'ятся)", async () => {
  const { hash, salt } = await hashPassword("пароль с пробелами 1")
  assert.equal(await verifyPassword("пароль с пробелами 1", hash, salt), true)
  // тот же пароль с лишним пробелом в конце — это ДРУГОЙ пароль
  assert.equal(await verifyPassword("пароль с пробелами 1 ", hash, salt), false)
  // и с вырезанными внутренними пробелами — тоже другой
  assert.equal(await verifyPassword("парольспробелами1", hash, salt), false)
})

test("требования к паролю", () => {
  assert.equal(validatePasswordStrength("1234567").ok, false, "короче минимума")
  assert.equal(validatePasswordStrength("12345678").ok, false, "только цифры")
  assert.equal(validatePasswordStrength("abcdefgh").ok, false, "только буквы")
  assert.equal(validatePasswordStrength("abcd1234").ok, true)
  assert.equal(validatePasswordStrength("пароль12").ok, true, "кириллица допустима")
  assert.equal(validatePasswordStrength("").ok, false)
  assert.equal(
    validatePasswordStrength("a1".repeat(Math.ceil((MIN_PASSWORD_LENGTH + 200) / 2))).ok,
    false,
    "слишком длинный пароль отклоняется",
  )
  const result = validatePasswordStrength("1234567")
  assert.match(result.error, /не короче 8/)
})

test("временный пароль соответствует требованиям", () => {
  const password = generateTemporaryPassword()
  assert.equal(password.length, 12)
  assert.equal(validatePasswordStrength(password).ok, true)
  assert.notEqual(password, generateTemporaryPassword(), "каждый раз новый")
})
