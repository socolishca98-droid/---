/**
 * Тесты «3 вариантов с биржи» (lib/logist-mobile/load-suggestions.ts).
 *
 * Помощник обещает: показать логисту три ПРИМЕРНО подходящих груза, а не
 * собирать рейс сам (контакты ATI не отдаёт). Проверяем:
 *  1) в варианты попадают только новые грузы с известным маршрутом и
 *     озвученной ставкой;
 *  2) груз должен влезать в машину (вес и объём);
 *  3) просроченные по дате грузы не предлагаются;
 *  4) лучшие три — по ставке ₽/км;
 *  5) причина выбора объясняется словами.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { suggestExchangeLoads, vehiclesForLoad } = require(
  "../.test-build/lib/logist-mobile/load-suggestions.js",
)

const NOW = new Date("2026-10-22T10:00:00.000Z")

function load(overrides = {}) {
  return {
    id: "al-1",
    loadId: "ati-load-1",
    fromCity: "Москва",
    toCity: "Калуга",
    weightKg: 3000,
    volumeM3: null,
    cargoType: "Продукты питания",
    priceRub: 38000,
    priceWithNds: null,
    distanceKm: 210,
    ratePerKm: 38000 / 210,
    firmName: "ООО «Ромашка»",
    firmRating: 4.5,
    firstDate: "2026-10-23T00:00:00.000Z",
    lastDate: null,
    status: "new",
    ...overrides,
  }
}

const VEHICLES = [
  { id: "v-1", plate: "K215CT790", type: "ГАЗон", capacity: 4200, volume: 32 },
  { id: "v-2", plate: "B108MK799", type: "Фура", capacity: 20000, volume: 92 },
]

test("в варианты попадают только новые грузы с маршрутом и ставкой", () => {
  const result = suggestExchangeLoads(
    [
      load({ id: "al-1", loadId: "l-1" }),
      load({ id: "al-2", loadId: "l-2", status: "dismissed" }),
      load({ id: "al-3", loadId: "l-3", priceRub: null, priceWithNds: null }),
      load({ id: "al-4", loadId: "l-4", toCity: "—" }),
    ],
    VEHICLES,
    NOW,
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].load.loadId, "l-1")
})

test("груз, который не влезает ни в одну машину, не предлагается", () => {
  const heavy = load({ id: "al-1", loadId: "l-1", weightKg: 25000 })
  const result = suggestExchangeLoads([heavy], VEHICLES, NOW)
  assert.equal(result.length, 0)
})

test("груз влезает в фуру, но не в газон — берём фуру", () => {
  const heavy = load({ id: "al-1", loadId: "l-1", weightKg: 12000, volumeM3: 60 })
  const fitting = vehiclesForLoad(heavy, VEHICLES)
  assert.equal(fitting.length, 1)
  assert.equal(fitting[0].plate, "B108MK799")
})

test("просроченный груз не предлагается", () => {
  const stale = load({
    id: "al-1",
    loadId: "l-1",
    firstDate: "2026-10-01T00:00:00.000Z",
    lastDate: "2026-10-02T00:00:00.000Z",
  })
  const result = suggestExchangeLoads([stale], VEHICLES, NOW)
  assert.equal(result.length, 0)
})

test("лучшие три — по ставке ₽/км", () => {
  const cheap = load({ id: "a", loadId: "l-cheap", ratePerKm: 40 })
  const mid = load({ id: "b", loadId: "l-mid", ratePerKm: 60 })
  const good = load({ id: "c", loadId: "l-good", ratePerKm: 90 })
  const best = load({ id: "d", loadId: "l-best", ratePerKm: 120 })
  const result = suggestExchangeLoads([cheap, mid, good, best], VEHICLES, NOW)
  assert.equal(result.length, 3)
  assert.deepEqual(
    result.map((s) => s.load.loadId),
    ["l-best", "l-good", "l-mid"],
  )
})

test("груз без ставки ₽/км идёт в конец", () => {
  const withRate = load({ id: "a", loadId: "l-rate", ratePerKm: 50 })
  const noRate = load({ id: "b", loadId: "l-norate", ratePerKm: null })
  const result = suggestExchangeLoads([noRate, withRate], VEHICLES, NOW)
  assert.equal(result[0].load.loadId, "l-rate")
})

test("причина выбора объясняется словами", () => {
  const result = suggestExchangeLoads([load()], VEHICLES, NOW)
  assert.equal(result.length, 1)
  assert.match(result[0].reason, /влезает в K215CT790/)
  assert.match(result[0].reason, /₽\/км/)
})

test("когда машин нет — вариантов нет, а не мусор", () => {
  const result = suggestExchangeLoads([load()], [], NOW)
  assert.equal(result.length, 0)
})
