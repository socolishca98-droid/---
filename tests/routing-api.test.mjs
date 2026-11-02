// tests/routing-api.test.mjs
//
// Контракт эндпоинта плана: что принимаем и что отдаём.
//
// Ядро проверяется отдельно и подробно, но между ним и логистом стоит ещё
// разбор тела запроса и сборка ответа. Ошибка там не видна ни в аудите
// качества, ни в тестах поиска: ядро считает верно, а экран получает не то.
// Живой пример из этой же работы: сервер отдавал по семь вариантов на машину
// (143 КБ на пять машин, до 1,8 МБ в худшем случае), а экран показывал три.
//
// Ничего не считаем «на глазок»: проверяем границы значений, отбраковку
// мусора, форматы дат и два исхода — «план есть» и «плана нет, вот причина».

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const api = require("../.test-build/lib/routing/api.js")

const NOW = new Date("2026-11-02T05:00:00.000Z")

const place = (city) => ({
  id: city.toLowerCase(),
  city,
  region: "Ярославская область",
  point: { lat: 57.6, lng: 39.9 },
  timeZone: "Europe/Moscow",
})

/** Минимальный план, достаточный для проверки сериализации. */
function plan(overrides = {}) {
  const at = new Date("2026-11-02T06:00:00.000Z")
  return {
    id: "plan-1",
    organisationId: "org-1",
    vehicleId: "veh-1",
    model: "sequential",
    orderIds: ["A", "B"],
    stops: [
      {
        kind: "load",
        orderId: "A",
        place: place("Ярославль"),
        arriveAt: at,
        startAt: at,
        endAt: at,
        waitingHours: 0,
        handlingHours: 1,
      },
      {
        kind: "return",
        orderId: null,
        place: place("Ярославль"),
        arriveAt: at,
        startAt: at,
        endAt: at,
        waitingHours: 0,
        handlingHours: 0,
      },
    ],
    segments: [],
    schedule: {
      events: [{ kind: "depart", at, place: place("Ярославль"), note: null }],
      startAt: at,
      endAt: at,
      drivingHours: 10,
      restHours: 0,
      shifts: 1,
    },
    economics: {
      revenue: 100000,
      fuelRub: 20000,
      driverRub: 0,
      maintenanceRub: 10000,
      tiresRub: 0,
      tollsRub: null,
      otherRub: 0,
      fixedContributionRub: 0,
      netRub: 70000,
      netCommittedRub: 65000,
      netPerKm: 100,
      netPerHour: 1000,
      totalKm: 700,
      loadedKm: 600,
      emptyKm: 100,
      emptyShare: 0.14,
      unknown: ["платные участки не размечены"],
    },
    capacity: [],
    returned: { kind: "empty", deadheadKm: 100, costRub: 5000, satisfiesMode: true },
    warnings: [],
    assumptions: [],
    reasons: [],
    confidence: "measured",
    exact: true,
    ...overrides,
  }
}

// ── Вход ────────────────────────────────────────────────────────────────────

test("пустое тело даёт безопасные значения по умолчанию", () => {
  const input = api.parsePlanRequest({}, NOW)
  assert.equal(input.poolLimit, api.POOL_LIMIT_DEFAULT)
  assert.equal(input.horizonHours, api.HORIZON_DEFAULT_HOURS)
  assert.equal(input.source, "both")
  assert.equal(input.now.getTime(), NOW.getTime())
  assert.equal(input.excludeIds, undefined)
  assert.equal(input.vehicleId, undefined)
})

test("мусор вместо тела не ломает разбор", () => {
  for (const body of [null, undefined, "строка", 42, []]) {
    const input = api.parsePlanRequest(body, NOW)
    assert.equal(input.poolLimit, api.POOL_LIMIT_DEFAULT, `тело ${JSON.stringify(body)}`)
    assert.equal(input.source, "both")
  }
})

test("размеры пула и горизонта зажаты в допустимые пределы", () => {
  assert.equal(api.parsePlanRequest({ poolLimit: -5 }, NOW).poolLimit, 1)
  assert.equal(api.parsePlanRequest({ poolLimit: 0 }, NOW).poolLimit, 1)
  assert.equal(api.parsePlanRequest({ poolLimit: 100000 }, NOW).poolLimit, api.POOL_LIMIT_MAX)
  assert.equal(api.parsePlanRequest({ poolLimit: 120.7 }, NOW).poolLimit, 121)
  assert.equal(api.parsePlanRequest({ horizonHours: 0 }, NOW).horizonHours, 1)
  assert.equal(api.parsePlanRequest({ horizonHours: 99999 }, NOW).horizonHours, api.HORIZON_MAX_HOURS)
  assert.equal(api.parsePlanRequest({ horizonHours: "48" }, NOW).horizonHours, 48)
  // Не число — значение по умолчанию, а не NaN в расчёте.
  assert.equal(api.parsePlanRequest({ horizonHours: "много" }, NOW).horizonHours, api.HORIZON_DEFAULT_HOURS)
})

test("источник пула принимается только известный", () => {
  assert.equal(api.parsePlanRequest({ source: "ati" }, NOW).source, "ati")
  assert.equal(api.parsePlanRequest({ source: "orders" }, NOW).source, "orders")
  assert.equal(api.parsePlanRequest({ source: "both" }, NOW).source, "both")
  // Чужое значение не должно уехать в запрос к базе.
  assert.equal(api.parsePlanRequest({ source: "all" }, NOW).source, "both")
  assert.equal(api.parsePlanRequest({ source: { sql: "drop" } }, NOW).source, "both")
})

test("момент расчёта: свежий принимается, далёкое прошлое — нет", () => {
  // Воспроизводимость нужна: по одному и тому же «сейчас» считают тесты и разбор.
  assert.equal(
    api.parsePlanRequest({ now: "2026-11-02T03:00:00.000Z" }, NOW).now.toISOString(),
    "2026-11-02T03:00:00.000Z",
  )
  // Позавчерашний момент — это не воспроизводимость, а сломанный план.
  assert.equal(api.parsePlanRequest({ now: "2026-10-01T00:00:00.000Z" }, NOW).now.getTime(), NOW.getTime())
  // Мусор в дате — тоже «сейчас», а не Invalid Date в расчёте.
  assert.equal(api.parsePlanRequest({ now: "не дата" }, NOW).now.getTime(), NOW.getTime())
  assert.equal(api.parsePlanRequest({ now: 12345 }, NOW).now.getTime(), NOW.getTime())
})

test("списки идентификаторов: только строки, только разумная длина", () => {
  const input = api.parsePlanRequest(
    { excludeIds: ["a", "", 42, null, "b"], keepIds: "строка вместо списка" },
    NOW,
  )
  assert.deepEqual(input.excludeIds, ["a", "b"])
  assert.equal(input.keepIds, undefined, "список должен быть списком")

  const many = api.parsePlanRequest({ excludeIds: Array.from({ length: 500 }, (_, i) => `id-${i}`) }, NOW)
  assert.equal(many.excludeIds.length, api.IDS_MAX, "длинный список обрезается, а не отклоняется целиком")
})

test("идентификатор машины пустой строкой не принимается", () => {
  assert.equal(api.parsePlanRequest({ vehicleId: "" }, NOW).vehicleId, undefined)
  assert.equal(api.parsePlanRequest({ vehicleId: "veh-1" }, NOW).vehicleId, "veh-1")
  assert.equal(api.parsePlanRequest({ vehicleId: 7 }, NOW).vehicleId, undefined)
})

// ── Выход ───────────────────────────────────────────────────────────────────

test("даты уходят строками ISO — и в расписании, и в остановках", () => {
  const json = api.serializePlan(plan())
  assert.equal(typeof json.schedule.startAt, "string")
  assert.equal(json.schedule.startAt, "2026-11-02T06:00:00.000Z")
  assert.equal(typeof json.schedule.events[0].at, "string")
  assert.equal(typeof json.stops[0].arriveAt, "string")
  assert.equal(typeof json.stops[0].endAt, "string")
  // Остальное не должно пострадать при сериализации.
  assert.equal(json.orderIds.length, 2)
  assert.equal(json.economics.netCommittedRub, 65000)
})

test("на машину отдаём три варианта, но говорим, сколько нашлось", () => {
  const variants = Array.from({ length: 7 }, (_, index) => plan({ id: `p${index}` }))
  const out = api.serializeVehiclePlan({
    organisationId: "org-1",
    vehicleId: "veh-1",
    variants,
    recommended: variants[0],
    rejected: [{ orderId: "X", reason: "не подходит" }],
    stats: {},
  })
  assert.equal(out.variants.length, api.VARIANTS_PER_VEHICLE)
  assert.equal(out.variantsTotal, 7, "счётчик найденного не должен врать")
  assert.equal(out.recommended.id, "p0")
  assert.equal(out.rejected.length, 1)
})

test("плана нет — в ответе есть причина, а не пустота", () => {
  const out = api.planResponse({
    readiness: { ok: false, blockers: ["нет базы организации в настройках"], warnings: ["нет ставки"] },
    plan: null,
    summary: { ordersInPool: 0, ordersUsable: 0, ordersExcluded: 0, skipped: [], geocoded: [], vehicles: 0, horizonHours: 72, now: NOW.toISOString(), elapsedMs: 1 },
  })
  assert.equal(out.ok, false)
  assert.equal(out.message, "нет базы организации в настройках", "первый блокер — в поле message")
  assert.equal(out.perVehicle, undefined, "машин без плана быть не должно")
  assert.deepEqual(out.readiness.warnings, ["нет ставки"])
})

test("план есть — в ответе машины, проверка валидатором и сводка", () => {
  const out = api.planResponse({
    readiness: { ok: true, blockers: [], warnings: [] },
    plan: {
      organisationId: "org-1",
      perVehicle: [
        {
          organisationId: "org-1",
          vehicleId: "veh-1",
          variants: [plan()],
          recommended: plan(),
          rejected: [],
          stats: {},
        },
      ],
      plans: [plan()],
      validations: [{ planId: "plan-1", result: { ok: true, issues: [] } }],
      stats: {},
    },
    summary: { ordersInPool: 1, ordersUsable: 1, ordersExcluded: 0, skipped: [], geocoded: [], vehicles: 1, horizonHours: 72, now: NOW.toISOString(), elapsedMs: 5 },
  })
  assert.equal(out.ok, true)
  assert.equal(out.perVehicle.length, 1)
  assert.equal(out.perVehicle[0].recommended.id, "plan-1")
  // Проверка независимым валидатором — в ответе, а не только в логах сервера.
  assert.equal(out.validations[0].ok, true)
  assert.equal(out.organisationId, "org-1")
})
