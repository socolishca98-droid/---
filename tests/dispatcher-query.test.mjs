/**
 * Тесты умного диспетчера (чистые модули, БД не нужна):
 *  — parseDispatcherQuery: разбор запроса словами в фильтры;
 *  — cityStemMatch: сравнение городов по основе (падежи);
 *  — resolvePlan / PLANS: тарифные планы и истечение пробного периода.
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { parseDispatcherQuery, cityStemMatch } = require("../.test-build/lib/dispatcher/query.js")

// Фиксированное «сейчас»: 5 октября 2026, полдень
const NOW = new Date(2026, 9, 5, 12, 0, 0)

// ---------------------------------------------------------------------------
// Разбор запроса
// ---------------------------------------------------------------------------

test("полная фраза: дата, город, кузов, вес, цена и ₽/км", () => {
  const q = parseDispatcherQuery(
    "Найди завтра из Ярославля тент 20 т, от 65 000 ₽ и 45 ₽/км",
    NOW,
  )
  assert.equal(q.dateLabel, "завтра")
  assert.deepEqual(q.dateFrom, new Date(2026, 9, 6))
  assert.deepEqual(q.dateTo, new Date(2026, 9, 7))
  assert.equal(q.cityFrom, "Ярославля")
  assert.equal(q.cityTo, null)
  assert.deepEqual(q.truckTypes, ["тент"])
  assert.equal(q.weightMaxT, 20)
  assert.equal(q.weightMinT, null)
  assert.equal(q.priceMinRub, 65000)
  assert.equal(q.rubPerKmMin, 45)
})

test("«в Москву до 3 т реф»: направление, верхний вес, рефрижератор", () => {
  const q = parseDispatcherQuery("груз в Москву до 3 т реф", NOW)
  assert.equal(q.cityFrom, null)
  assert.equal(q.cityTo, "Москву")
  assert.equal(q.weightMaxT, 3)
  assert.equal(q.weightMinT, null)
  assert.deepEqual(q.truckTypes, ["рефрижератор"])
  assert.equal(q.dateLabel, null)
})

test("«сегодня бортовой 10 тонн от 25000 руб»", () => {
  const q = parseDispatcherQuery("сегодня бортовой 10 тонн от 25000 руб", NOW)
  assert.equal(q.dateLabel, "сегодня")
  assert.deepEqual(q.dateFrom, new Date(2026, 9, 5))
  assert.deepEqual(q.dateTo, new Date(2026, 9, 6))
  assert.equal(q.weightMaxT, 10)
  assert.equal(q.priceMinRub, 25000)
  assert.deepEqual(q.truckTypes, ["бортовой"])
})

test("диапазон веса «от 5 т до 10 т» и изотерм", () => {
  const q = parseDispatcherQuery("от 5 т до 10 т изотерм", NOW)
  assert.equal(q.weightMinT, 5)
  assert.equal(q.weightMaxT, 10)
  assert.deepEqual(q.truckTypes, ["изотерм"])
})

test("числовая дата «12.10» — день с полуночи до полуночи", () => {
  const q = parseDispatcherQuery("груз 12.10 из Казани", NOW)
  assert.deepEqual(q.dateFrom, new Date(2026, 9, 12))
  assert.deepEqual(q.dateTo, new Date(2026, 9, 13))
  assert.equal(q.dateLabel, "12.10.2026")
  assert.equal(q.cityFrom, "Казани")
})

test("«3 января» в прошлом — переносится на следующий год", () => {
  const q = parseDispatcherQuery("рейс 3 января", NOW)
  assert.deepEqual(q.dateFrom, new Date(2027, 0, 3))
  assert.equal(q.dateLabel, "03.01.2027")
})

test("₽/км забирается раньше цены и не путается с ней", () => {
  const q = parseDispatcherQuery("от 50 ₽/км", NOW)
  assert.equal(q.rubPerKmMin, 50)
  assert.equal(q.priceMinRub, null)
})

test("мелкое «от 50 ₽» ценой не считается (порог 500)", () => {
  const q = parseDispatcherQuery("груз от 50 ₽", NOW)
  assert.equal(q.priceMinRub, null)
})

test("строчные слова городом не становятся, пустой запрос — пустые фильтры", () => {
  const empty = parseDispatcherQuery("", NOW)
  assert.equal(empty.cityFrom, null)
  assert.equal(empty.cityTo, null)
  assert.equal(empty.dateLabel, null)
  assert.deepEqual(empty.truckTypes, [])
  const text = parseDispatcherQuery("просто текст в никуда", NOW)
  assert.equal(text.cityFrom, null)
  assert.equal(text.cityTo, null)
  assert.equal(text.priceMinRub, null)
})

// ---------------------------------------------------------------------------
// Города по основе
// ---------------------------------------------------------------------------

test("cityStemMatch: падежи совпадают, разные города — нет", () => {
  assert.equal(cityStemMatch(null, "что угодно"), true)
  assert.equal(cityStemMatch("Москва", null), false)
  assert.equal(cityStemMatch("Ярославля", "Ярославль"), true)
  assert.equal(cityStemMatch("Москву", "Москва"), true)
  assert.equal(cityStemMatch("Санкт-Петербург", "Санкт-Петербурга"), true)
  assert.equal(cityStemMatch("Казань", "Москва"), false)
})
