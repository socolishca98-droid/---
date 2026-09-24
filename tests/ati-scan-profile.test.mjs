/**
 * Тесты профилей расписания сканирования ATI (задача 2, F4):
 * города, типы кузова, периодичность и фильтры скана.
 * База данных не нужна — проверяются чистые функции lib/ati/scan-profile.ts.
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  parseProfileCities,
  parseProfileTruckTypes,
  isProfileDue,
  buildProfileFilters,
  describeProfileSchedule,
  minutesUntilNextScan,
} = require("../.test-build/lib/ati/scan-profile.js")

const profile = (overrides = {}) => ({
  id: "p1",
  name: "default",
  cities: "[151, 153]",
  radius: 100,
  truckTypes: "any",
  minWeight: null,
  autoScanInterval: 15,
  isActive: true,
  lastScanAt: null,
  ...overrides,
})

// ---------------------------------------------------------------------------
// Города и типы кузова
// ---------------------------------------------------------------------------

test("города профиля читаются из JSON-массива", () => {
  assert.deepEqual(parseProfileCities("[151, 153]"), [151, 153])
  assert.deepEqual(parseProfileCities("[151,153]"), [151, 153])
  assert.deepEqual(parseProfileCities("[151, 153]"), [151, 153])
})

test("города профиля читаются и как список через запятую", () => {
  assert.deepEqual(parseProfileCities("151, 153"), [151, 153])
  assert.deepEqual(parseProfileCities("151 153 78"), [151, 153, 78])
})

test("мусор в городах не превращается в город", () => {
  assert.deepEqual(parseProfileCities(""), [])
  assert.deepEqual(parseProfileCities(null), [])
  assert.deepEqual(parseProfileCities("[]"), [])
  assert.deepEqual(parseProfileCities("[\"Москва\"]"), [])
  assert.deepEqual(parseProfileCities("не число"), [])
  assert.deepEqual(parseProfileCities([151, "153", null]), [151, 153])
})

test("типы кузова: any — значит любой", () => {
  assert.deepEqual(parseProfileTruckTypes("any"), [])
  assert.deepEqual(parseProfileTruckTypes("Any"), [])
  assert.deepEqual(parseProfileTruckTypes(""), [])
  assert.deepEqual(parseProfileTruckTypes(null), [])
  assert.deepEqual(parseProfileTruckTypes("Тент, Изотермический"), ["Тент", "Изотермический"])
  assert.deepEqual(parseProfileTruckTypes("рефрижератор ; фургон"), ["рефрижератор", "фургон"])
})

// ---------------------------------------------------------------------------
// Периодичность
// ---------------------------------------------------------------------------

test("пора сканировать: профиль без прошлого скана", () => {
  assert.equal(isProfileDue(profile({ lastScanAt: null })), true)
})

test("выключенный профиль и нулевой интервал не запускаются сами", () => {
  assert.equal(isProfileDue(profile({ isActive: false })), false)
  assert.equal(isProfileDue(profile({ autoScanInterval: 0 })), false)
  // даже если прошло много времени
  assert.equal(
    isProfileDue(
      profile({ autoScanInterval: 0, lastScanAt: new Date(Date.now() - 10 * 86400000) }),
    ),
    false,
  )
})

test("интервал соблюдается", () => {
  const now = new Date("2026-09-24T12:00:00.000Z")

  // 5 минут назад при интервале 15 — ещё рано
  assert.equal(
    isProfileDue(profile({ autoScanInterval: 15, lastScanAt: new Date("2026-09-24T11:55:00Z") }), now),
    false,
  )
  // ровно 15 минут — пора
  assert.equal(
    isProfileDue(profile({ autoScanInterval: 15, lastScanAt: new Date("2026-09-24T11:45:00Z") }), now),
    true,
  )
  // 20 минут при интервале 15 — пора
  assert.equal(
    isProfileDue(profile({ autoScanInterval: 15, lastScanAt: new Date("2026-09-24T11:40:00Z") }), now),
    true,
  )
})

test("дата последнего скана как строка (из JSON/базы) тоже понимается", () => {
  const now = new Date("2026-09-24T12:00:00.000Z")
  assert.equal(
    isProfileDue(profile({ autoScanInterval: 30, lastScanAt: "2026-09-24T11:00:00.000Z" }), now),
    true,
  )
  assert.equal(
    isProfileDue(profile({ autoScanInterval: 30, lastScanAt: "2026-09-24T11:45:00.000Z" }), now),
    false,
  )
  // битая дата — считаем, что скана не было
  assert.equal(isProfileDue(profile({ lastScanAt: "не дата" }), now), true)
})

test("сколько минут до следующего скана", () => {
  const now = new Date("2026-09-24T12:00:00.000Z")

  assert.equal(minutesUntilNextScan(profile({ isActive: false }), now), null)
  assert.equal(minutesUntilNextScan(profile({ autoScanInterval: 0 }), now), null)
  assert.equal(minutesUntilNextScan(profile({ lastScanAt: null }), now), 0)
  assert.equal(
    minutesUntilNextScan(
      profile({ autoScanInterval: 15, lastScanAt: new Date("2026-09-24T11:50:00Z") }),
      now,
    ),
    5,
  )
  // время пришло — не отрицательное число
  assert.equal(
    minutesUntilNextScan(
      profile({ autoScanInterval: 15, lastScanAt: new Date("2026-09-24T11:00:00Z") }),
      now,
    ),
    0,
  )
})

// ---------------------------------------------------------------------------
// Фильтры и подписи
// ---------------------------------------------------------------------------

test("фильтры скана собираются из профиля", () => {
  assert.deepEqual(buildProfileFilters(profile()), {})

  assert.deepEqual(buildProfileFilters(profile({ minWeight: 5000 })), { minWeight: 5000 })
  assert.deepEqual(buildProfileFilters(profile({ minWeight: 0 })), {})
  assert.deepEqual(buildProfileFilters(profile({ minWeight: null })), {})

  assert.deepEqual(buildProfileFilters(profile({ truckTypes: "Тент" })), {
    truckTypes: ["Тент"],
  })
  assert.deepEqual(
    buildProfileFilters(profile({ minWeight: 20000, truckTypes: "Тент, Фургон" })),
    { minWeight: 20000, truckTypes: ["Тент", "Фургон"] },
  )
})

test("расписание читается человеком", () => {
  assert.equal(describeProfileSchedule(profile({ isActive: false })), "выключен")
  assert.equal(describeProfileSchedule(profile({ autoScanInterval: 0 })), "только вручную")
  assert.equal(describeProfileSchedule(profile({ autoScanInterval: 5 })), "каждые 5 мин")
  assert.equal(describeProfileSchedule(profile({ autoScanInterval: 60 })), "каждый час")
  assert.equal(describeProfileSchedule(profile({ autoScanInterval: 120 })), "каждые 2 ч")
  assert.equal(describeProfileSchedule(profile({ autoScanInterval: 90 })), "каждые 90 мин")
})
