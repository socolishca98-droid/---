/**
 * Тесты тарифов (lib/billing/plans.ts): планы, пробный период и склонение
 * дней для интерфейса. Чистые функции, база не нужна.
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { PLANS, TRIAL_DAYS, isPlanKey, resolvePlan, pluralDays } = require("../.test-build/lib/billing/plans.js")

// Фиксированное «сейчас»: 5 октября 2026, полдень
const NOW = new Date(2026, 9, 5, 12, 0, 0)

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

// ---------------------------------------------------------------------------
// Склонение дней
// ---------------------------------------------------------------------------

test("pluralDays: 1 день, 3 дня, 5 дней, 11 дней, 21 день", () => {
  assert.equal(pluralDays(1), "1 день")
  assert.equal(pluralDays(2), "2 дня")
  assert.equal(pluralDays(3), "3 дня")
  assert.equal(pluralDays(4), "4 дня")
  assert.equal(pluralDays(5), "5 дней")
  assert.equal(pluralDays(11), "11 дней")
  assert.equal(pluralDays(12), "12 дней")
  assert.equal(pluralDays(14), "14 дней")
  assert.equal(pluralDays(21), "21 день")
  assert.equal(pluralDays(22), "22 дня")
  assert.equal(pluralDays(25), "25 дней")
  assert.equal(pluralDays(0), "0 дней")
  assert.equal(pluralDays(-3), "0 дней")
})
