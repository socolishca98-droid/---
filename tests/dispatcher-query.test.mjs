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
const { PLANS, TRIAL_DAYS, isPlanKey, resolvePlan } = require("../.test-build/lib/billing/plans.js")

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

// ---------------------------------------------------------------------------
// Тарифы
// ---------------------------------------------------------------------------

test("планы: цены, лимиты, длительность триала", () => {
  assert.equal(TRIAL_DAYS, 14)
  assert.equal(PLANS.trial.vehicleLimit, null)
  assert.equal(PLANS.free.vehicleLimit, 2)
  assert.equal(PLANS.start.priceRubPerMonth, 3500)
  assert.equal(PLANS.start.vehicleLimit, 3)
  assert.equal(PLANS.park.vehicleLimit, 15)
  assert.equal(PLANS.company.vehicleLimit, 50)
  assert.equal(isPlanKey("trial"), true)
  assert.equal(isPlanKey("company"), true)
  assert.equal(isPlanKey("gold"), false)
  assert.equal(isPlanKey(42), false)
  assert.equal(isPlanKey(null), false)
})

test("resolvePlan: триал идёт, пока не прошло 14 дней", () => {
  const active = resolvePlan({
    storedPlan: "trial",
    organizationCreatedAt: new Date(2026, 9, 1),
    now: NOW,
  })
  assert.equal(active.plan, "trial")
  assert.equal(active.isTrialing, true)
  assert.equal(active.trialDaysLeft, 10)
  assert.equal(active.vehicleLimit, null)

  const boundary = resolvePlan({
    storedPlan: "trial",
    organizationCreatedAt: new Date(2026, 8, 22, 12, 0, 0),
    now: NOW,
  })
  assert.equal(boundary.plan, "trial")
  assert.equal(boundary.trialDaysLeft, 1)
})

test("resolvePlan: истёкший триал без выбранного плана — «Бесплатный»", () => {
  const expired = resolvePlan({
    storedPlan: "trial",
    organizationCreatedAt: new Date(2026, 8, 1),
    now: NOW,
  })
  assert.equal(expired.plan, "free")
  assert.equal(expired.storedPlan, "trial")
  assert.equal(expired.isTrialing, false)
  assert.equal(expired.trialDaysLeft, 0)
  assert.equal(expired.vehicleLimit, 2)

  const exactly14 = resolvePlan({
    storedPlan: "trial",
    organizationCreatedAt: new Date(2026, 8, 21, 12, 0, 0),
    now: NOW,
  })
  assert.equal(exactly14.plan, "free")

  const noDate = resolvePlan({ storedPlan: "trial", organizationCreatedAt: null, now: NOW })
  assert.equal(noDate.plan, "free")
})

test("resolvePlan: выбранный план действует независимо от триала", () => {
  const park = resolvePlan({
    storedPlan: "park",
    organizationCreatedAt: new Date(2020, 0, 1),
    now: NOW,
  })
  assert.equal(park.plan, "park")
  assert.equal(park.isTrialing, false)
  assert.equal(park.trialDaysLeft, null)
  assert.equal(park.vehicleLimit, 15)
  assert.equal(park.priceRubPerMonth, 12000)

  const garbage = resolvePlan({ storedPlan: "oligarch", organizationCreatedAt: null, now: NOW })
  assert.equal(garbage.plan, "free")
})
