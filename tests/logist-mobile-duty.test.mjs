/**
 * Тесты дежурного логиста (lib/logist-mobile/duty.ts).
 *
 * Дежурный обещает логисту конкретные вещи, и каждое обещание проверяется
 * здесь:
 *   1) он не бегает ночью и говорит словами, почему тихо и когда снова;
 *   2) интервал соблюдается: раньше срока биржу не дёргаем;
 *   3) мусор в настройках не ломает график (часы, интервал);
 *   4) в ленту попадает только то, что влезает в машину, свежо, со ставкой и
 *      оставляет деньги после топлива и работы машины;
 *   5) уже показанный груз не возвращается, но подорожавший — возвращается;
 *   6) обратка из города, где стоит или окажется машина, идёт первой;
 *   7) подсказка «в Казани грузы есть, но ни один не влезает» — правда.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  DEFAULT_DUTY,
  buildDutyFeed,
  dutyHeadline,
  dutyIsDue,
  isInsideWorkingHours,
  nextWorkingStart,
  normalizeDutySettings,
  vehicleHints,
  inCity,
  fromCity,
  InCity,
  FromCity,
} = require("../.test-build/lib/logist-mobile/duty.js")
const { estimateFuelL } = require("../.test-build/lib/fleet/fuel.js")

const FUEL = 70
const WORK = 24

function load(overrides = {}) {
  return {
    id: "cl-1",
    loadId: "ati-load-1",
    fromCity: "Москва",
    toCity: "Воронеж",
    weightKg: 18000,
    volumeM3: null,
    cargoType: "Палеты",
    priceRub: 52000,
    priceWithNds: null,
    distanceKm: 526,
    firmName: "ООО «Ромашка»",
    contactPhone: null,
    loadingDate: null,
    status: "new",
    ...overrides,
  }
}

function vehicle(overrides = {}) {
  return {
    id: "vh-1",
    plate: "E774OP750",
    type: "фура",
    capacity: 20000,
    volume: 90,
    status: "available",
    fuelConsumptionPer100: 30,
    ...overrides,
  }
}

function feedInput(overrides = {}) {
  return {
    loads: [],
    seen: [],
    vehicles: [vehicle()],
    basePoint: null,
    baseCity: "Москва",
    fuelPriceRubPerL: FUEL,
    operatingCostPerKm: WORK,
    away: [],
    radiusKm: 0,
    now: new Date("2026-11-01T09:40:00"),
    ...overrides,
  }
}

// ── 1. График: ночью не смотрим ───────────────────────────────────────────
test("вне рабочих часов дежурный честно говорит, что тихо и когда снова", () => {
  const now = new Date("2026-11-01T22:40:00")
  const result = dutyIsDue(DEFAULT_DUTY, null, now)

  assert.equal(result.due, false)
  assert.match(result.reason, /вне рабочих часов/)
  assert.match(result.reason, /Ночью новых грузов почти нет/)
  assert.ok(result.nextAt, "должно быть названо время следующего просмотра")
  assert.equal(result.nextAt.getHours(), 7)
  assert.equal(result.nextAt.getDate(), 2, "следующий просмотр — завтра утром")
})

// ── 2. Интервал соблюдается ───────────────────────────────────────────────
test("раньше интервала биржу не дёргаем", () => {
  const now = new Date("2026-11-01T09:50:00")
  const last = new Date("2026-11-01T09:40:00")
  const result = dutyIsDue(DEFAULT_DUTY, last, now)

  assert.equal(result.due, false)
  assert.match(result.reason, /Смотрели 09:40/)
  assert.equal(result.nextAt.getHours(), 9)
  assert.equal(result.nextAt.getMinutes(), 55)
})

test("после интервала в рабочих часах — пора смотреть", () => {
  const now = new Date("2026-11-01T10:05:00")
  const last = new Date("2026-11-01T09:40:00")
  const result = dutyIsDue(DEFAULT_DUTY, last, now)
  assert.equal(result.due, true)
  assert.match(result.reason, /Пора посмотреть/)
})

test("выключенный дежурный не смотрит биржу и говорит об этом", () => {
  const result = dutyIsDue({ ...DEFAULT_DUTY, enabled: false }, null, new Date("2026-11-01T10:00:00"))
  assert.equal(result.due, false)
  assert.match(result.reason, /выключен/)
})

// ── 3. Мусор в настройках ─────────────────────────────────────────────────
test("настройки дежурного чистятся: часы, интервал, пустые значения", () => {
  const cleaned = normalizeDutySettings({
    enabled: true,
    intervalMin: Number.NaN,
    fromHour: -5,
    toHour: 30,
  })
  assert.equal(cleaned.intervalMin, DEFAULT_DUTY.intervalMin)
  assert.equal(cleaned.fromHour, 0)
  assert.equal(cleaned.toHour, 24)

  // Интервал 0 — «только вручную», это допустимое значение, а не мусор
  assert.equal(normalizeDutySettings({ intervalMin: 0 }).intervalMin, 0)
  // Конец совпал с началом — рабочий день не должен стать пустым
  const same = normalizeDutySettings({ fromHour: 9, toHour: 9 })
  assert.equal(same.toHour, 10)
})

test("рабочие часы понимают и обычный день, и смену через полночь", () => {
  assert.equal(isInsideWorkingHours(9, 7, 21), true)
  assert.equal(isInsideWorkingHours(6, 7, 21), false)
  assert.equal(isInsideWorkingHours(21, 7, 21), false, "конец дня не включён")
  assert.equal(isInsideWorkingHours(23, 22, 6), true)
  assert.equal(isInsideWorkingHours(3, 22, 6), true)
  assert.equal(isInsideWorkingHours(12, 22, 6), false)
})

test("nextWorkingStart возвращает ближайшее рабочее время", () => {
  const next = nextWorkingStart(new Date("2026-11-01T03:30:00"), 7, 21)
  assert.equal(next.getHours(), 7)
  assert.equal(next.getMinutes(), 0)
  assert.equal(next.getDate(), 1)
})

// ── 4. Что попадает в ленту ───────────────────────────────────────────────
test("новый груз от базы попадает в ленту с деньгами после топлива и работы", () => {
  const items = buildDutyFeed(
    feedInput({ loads: [load({ fromCity: "Москва", toCity: "Воронеж", distanceKm: 526, priceRub: 52000 })] }),
  )

  assert.equal(items.length, 1)
  const item = items[0]
  assert.equal(item.kind, "new")
  // Топливо считается с поправкой на загрузку (18 т из 20 т), работа — 24 ₽/км
  const fuel = Math.round(estimateFuelL(vehicle(), 526, 18000) * FUEL)
  assert.equal(item.netRub, 52000 - fuel - WORK * 526)
  assert.ok(item.netRub < 52000, "из ставки вычтены топливо и работа машины")
  assert.match(item.title, /Новый груз/)
  assert.match(item.note, /E774OP750/, "видно, под какую машину груз")
})

test("груз без ставки, просроченный и не влезающий в машину в ленту не идут", () => {
  const now = new Date("2026-11-01T09:40:00")
  const items = buildDutyFeed(
    feedInput({
      now,
      vehicles: [vehicle({ capacity: 5000, volume: 32 })],
      loads: [
        load({ id: "no-price", loadId: "a", priceRub: null }),
        load({ id: "old", loadId: "b", loadingDate: "2026-10-30T08:00:00" }),
        load({ id: "heavy", loadId: "c", weightKg: 20000, priceRub: 90000 }),
      ],
    }),
  )
  assert.deepEqual(items, [])
})

test("цена ниже порога ₽/км не повод звонить", () => {
  const items = buildDutyFeed(
    feedInput({ loads: [load({ distanceKm: 800, priceRub: 20000 })] }),
  )
  assert.deepEqual(items, [])
})

// ── 5. Память: новое отличается от старого ────────────────────────────────
test("груз, который дежурный уже показывал, второй раз не всплывает", () => {
  const seen = [{ atiLoadId: "ati-load-1", firstSeenAt: "2026-11-01T08:00:00", priceRub: 52000 }]
  const items = buildDutyFeed(feedInput({ loads: [load()], seen }))
  assert.deepEqual(items, [], "тот же груз по той же цене — уже видели")
})

test("подорожавший груз возвращается в ленту с прибавкой", () => {
  const seen = [{ atiLoadId: "ati-load-1", firstSeenAt: "2026-11-01T08:00:00", priceRub: 50000 }]
  const items = buildDutyFeed(feedInput({ loads: [load({ priceRub: 60000 })], seen }))

  assert.equal(items.length, 1)
  assert.equal(items[0].kind, "rate-up")
  assert.match(items[0].title, /Подорожал/)
  assert.match(items[0].note, /Было 50/)
})

test("груз с загрузкой в ближайшие сутки помечен «скоро уйдёт»", () => {
  const now = new Date("2026-11-01T09:40:00")
  const seen = [{ atiLoadId: "ati-load-1", firstSeenAt: "2026-11-01T08:00:00", priceRub: 52000 }]
  const items = buildDutyFeed(
    feedInput({ now, seen, loads: [load({ loadingDate: "2026-11-01T18:00:00" })] }),
  )

  assert.equal(items.length, 1)
  assert.equal(items[0].kind, "expiring")
  assert.match(items[0].title, /Скоро уйдёт/)
})

// ── 6. Обратка — приоритет ────────────────────────────────────────────────
test("обратка из города, где стоит машина, идёт первой и объясняет экономию", () => {
  const base = { lat: 57.63, lng: 39.87 } // Ярославль — база организации
  const items = buildDutyFeed(
    feedInput({
      basePoint: base,
      baseCity: "Ярославль",
      away: [{ plate: "E774OP750", city: "Казань", kind: "стоит" }],
      loads: [
        // Мелкий груз из дома: он тоже выгоден, но обратка важнее
        load({
          id: "home",
          loadId: "home-1",
          fromCity: "Ярославль",
          toCity: "Тула",
          distanceKm: 700,
          priceRub: 60000,
        }),
        // Обратка: машина стоит в Казани, груз идёт домой
        load({
          id: "back",
          loadId: "back-1",
          fromCity: "Казань",
          toCity: "Ярославль",
          distanceKm: 1200,
          priceRub: 140000,
          toPoint: { lat: 57.4, lng: 39.5 },
        }),
      ],
    }),
  )

  assert.equal(items[0].atiLoadId, "back-1")
  assert.equal(items[0].kind, "backhaul")
  assert.match(items[0].title, /Обратка/)
  assert.match(items[0].note, /уже стоит в Казани/, "город в предложном падеже")
  assert.match(items[0].note, /Вместо .* на порожний ход домой/, "названа цена порожнего хода")
})

test("один груз из двух источников — одна строка", () => {
  const duplicate = load({ id: "copy", loadId: "ati-load-1" })
  const items = buildDutyFeed(feedInput({ loads: [load(), duplicate] }))
  assert.equal(items.length, 1)
})

// ── 7. Подсказки по машинам ───────────────────────────────────────────────
test("подсказка честно говорит: грузы в городе есть, но ни один не влезает", () => {
  const hints = vehicleHints({
    away: [{ plate: "E774OP750", city: "Казань", kind: "доедет" }],
    vehicles: [vehicle({ capacity: 5000, volume: 32 })],
    loads: [
      load({ id: "k1", loadId: "k1", fromCity: "Казань", toCity: "Москва", weightKg: 20000, priceRub: 90000 }),
      load({ id: "k2", loadId: "k2", fromCity: "Казань", toCity: "Уфа", weightKg: 20000, priceRub: 40000 }),
    ],
  })

  assert.equal(hints.length, 1)
  assert.equal(hints[0].loadsThere, 2)
  assert.equal(hints[0].fitting, 0)
  assert.match(hints[0].note, /но ни один не влезает/)
})

test("подсказка про пустой город не выдумывает грузы", () => {
  const hints = vehicleHints({
    away: [{ plate: "E774OP750", city: "Пермь", kind: "доедет" }],
    vehicles: [vehicle()],
    loads: [load()],
  })
  assert.match(hints[0].note, /грузов на бирже нет/)
})

// ── 8. Итог одной фразой ──────────────────────────────────────────────────
test("итог называет количество, обратки и лучший груз", () => {
  const items = buildDutyFeed(
    feedInput({
      away: [{ plate: "E774OP750", city: "Казань", kind: "стоит" }],
      loads: [
        load({ id: "back", loadId: "back-1", fromCity: "Казань", toCity: "Москва", distanceKm: 800, priceRub: 95000 }),
      ],
    }),
  )
  const headline = dutyHeadline(items)
  assert.match(headline, /1 груз стоит внимания/)
  assert.match(headline, /обратка под ваши машины/)
  assert.match(headline, /лучший:/)
})

test("пустая лента объясняет тишину, а не молчит", () => {
  assert.match(dutyHeadline([]), /Нового ничего/)
})

// ── 9. Падежи: «в Казани», а не «в Казань» ────────────────────────────────
test("предложный падеж городов, с которыми работает логист", () => {
  assert.equal(inCity("Казань"), "в Казани")
  assert.equal(inCity("Москва"), "в Москве")
  assert.equal(inCity("Воронеж"), "в Воронеже")
  assert.equal(inCity("Уфа"), "в Уфе")
  assert.equal(inCity("Тула"), "в Туле")
  assert.equal(inCity("Ярославль"), "в Ярославле")
  assert.equal(inCity("Пушкино"), "в Пушкино")
})

test("родительный падеж: «из Перми грузов нет»", () => {
  assert.equal(fromCity("Пермь"), "из Перми")
  assert.equal(fromCity("Казань"), "из Казани")
  assert.equal(fromCity("Москва"), "из Москвы")
  assert.equal(fromCity("Курск"), "из Курска")
  assert.equal(fromCity("Ярославль"), "из Ярославля")
})

test("незнакомое название не ломает фразу: говорим нейтрально", () => {
  assert.equal(inCity("Мытищи"), "в городе Мытищи")
  assert.equal(fromCity("Ростов-на-Дону"), "из города Ростов-на-Дону")
  assert.equal(inCity(null), "в городе —")
})

test("название из двух слов склоняется целиком", () => {
  assert.equal(inCity("Нижний Новгород"), "в Нижнем Новгороде")
  assert.equal(inCity("Великий Новгород"), "в Великом Новгороде")
})

test("фраза с заглавной буквы — для начала предложения", () => {
  assert.equal(InCity("Казань"), "В Казани")
  assert.equal(FromCity("Пермь"), "Из Перми")
})
