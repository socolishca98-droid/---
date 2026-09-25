/**
 * Тесты правил проверки сессии (lib/auth/refresh-policy.ts).
 *
 * История: и кабинет, и мобильное приложение на любой не-2xx ответ считали,
 * что сессии нет. Разовый 429 (rate limit), 500 или короткий обрыв сети
 * выбрасывали человека на экран входа при живой сессии в базе — это выглядело
 * как «само разлогинило». Здесь проверяем, что выход возможен только тогда,
 * когда сервер прямо сказал: сессии нет.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { classifySessionStatus, retryDelayMs, isSessionPayload } = require(
  "../.test-build/lib/auth/refresh-policy.js"
)

test("успешный ответ — сессия есть", () => {
  assert.equal(classifySessionStatus(200), "ok")
  assert.equal(classifySessionStatus(204), "ok")
})

test("401 и 403 — сессии действительно нет: выходим", () => {
  assert.equal(classifySessionStatus(401), "unauthorized")
  assert.equal(classifySessionStatus(403), "unauthorized")
})

test("429 и 5xx — не повод терять сессию: ждём и повторяем", () => {
  // Ровно эти коды раньше выкидывали логиста и водителя на экран входа
  assert.equal(classifySessionStatus(429), "transient")
  assert.equal(classifySessionStatus(500), "transient")
  assert.equal(classifySessionStatus(502), "transient")
  assert.equal(classifySessionStatus(503), "transient")
  assert.equal(classifySessionStatus(504), "transient")
})

test("прочие 4xx — повторять бессмысленно, считаем что сессии нет", () => {
  assert.equal(classifySessionStatus(400), "unauthorized")
  assert.equal(classifySessionStatus(404), "unauthorized")
})

test("паузы перед повторами растут и не бесконечны", () => {
  const first = retryDelayMs(0)
  const second = retryDelayMs(1)
  const third = retryDelayMs(2)
  const fourth = retryDelayMs(3)

  assert.ok(first > 0, "первая пауза должна быть ненулевой")
  assert.ok(second > first, "пауза должна расти")
  assert.equal(third, fourth, "дальше пауза фиксированная, без бесконечного роста")
  assert.ok(fourth <= 30000, "пауза не должна быть длиннее разумного")
  assert.equal(retryDelayMs(-1), first, "отрицательная попытка не ломает расчёт")
})

test("данные сессии проверяются по существу, а не по факту ответа", () => {
  assert.equal(isSessionPayload({ success: true, session: { user: { id: "u1" } } }), true)
  assert.equal(isSessionPayload({ success: false }), false)
  assert.equal(isSessionPayload({ success: true, session: {} }), false)
  assert.equal(isSessionPayload({ success: true, session: null }), false)
  assert.equal(isSessionPayload(null), false)
  assert.equal(isSessionPayload("текст"), false)
})
