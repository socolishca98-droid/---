// tests/routing-random.test.mjs
//
// Сверка ядра с независимым перебором на случайных задачах.
//
// Один-два ручных сценария доказывают, что движок «не глупый», но не
// доказывают, что он не теряет варианты. Здесь сравнивается остаток денег на
// сотнях псевдослучайных задач с фиксированным зерном — прогон воспроизводим.

import test from "node:test"
import assert from "node:assert/strict"
import {
  REGIONS,
  R,
  bruteCalendar,
  bruteForce,
  makeCase,
  mulberry32,
} from "./routing-fixtures.mjs"

test("случайные задачи: остаток совпадает с независимым перебором", async () => {
  const CASES = 120
  const failures = []
  let worstGap = 0
  let worstSeed = null

  for (let seed = 1; seed <= CASES; seed += 1) {
    const tile = makeCase(seed)
    const expected = bruteForce(tile)
    const result = await R.planVehicle(
      {
        orders: tile.orders,
        vehicles: [tile.vehicle],
        settings: tile.settings,
        regions: REGIONS,
        now: new Date("2026-11-02T05:00:00.000Z"),
      },
      tile.vehicle,
    )
    const got = result.recommended ?? result.variants[0] ?? null
    if (!expected && !got) continue
    if (!expected || !got) {
      failures.push(`seed ${seed}: перебор ${expected?.net ?? "нет"}, ядро ${got?.economics.netRub ?? "нет"}`)
      continue
    }
    // Ядро вправе найти лучше (эталон тоже полный, поэтому — только равенство);
    // расхождение в любую сторону означает, что одна из сторон ошибается.
    const gap = Math.abs(got.economics.netRub - expected.net)
    if (gap > 1) {
      const relative = gap / Math.max(1, Math.abs(expected.net))
      if (relative > worstGap) {
        worstGap = relative
        worstSeed = seed
      }
      failures.push(
        `seed ${seed}: ядро ${got.economics.netRub} ₽ (${got.orderIds.join("→")}), ` +
          `перебор ${expected.net} ₽ (${expected.seq.join("→")})`,
      )
    }
  }

  if (failures.length > 0) {
    console.log(`  расхождений: ${failures.length} из ${CASES}, худшее ${(worstGap * 100).toFixed(2)} % (seed ${worstSeed})`)
    console.log("  " + failures.slice(0, 10).join("\n  "))
  }
  assert.equal(failures.length, 0, `расхождения с эталоном на ${failures.length} задачах из ${CASES}`)
})

// ── Вторая сверка: календарь целиком ───────────────────────────────────────
//
// Здесь перебор считает то же, что ядро: отдых по норме, ожидание окна,
// часы работы склада в местном времени точки, лимит календарной длительности.
// Правила написаны заново, а не взяты из ядра: иначе сверка ловила бы только
// опечатки, а не ошибки модели.

test("случайные задачи с календарём: окна, отдых, часы работы", async () => {
  const now = new Date("2026-11-02T05:00:00.000Z")
  const failures = []
  let compared = 0

  for (let seed = 1; seed <= 60; seed += 1) {
    const tile = makeCase(seed)
    const random = mulberry32(seed * 7919)
    // Окна и лимиты — как в жизни: часть грузов с датой, часть без.
    const orders = tile.orders.map((order) => {
      const withWindow = random() < 0.5
      const shiftHours = Math.round(random() * 36)
      return {
        ...order,
        window: withWindow
          ? {
              pickup: { from: new Date(now.getTime() + shiftHours * 3600000).toISOString() },
              delivery: {},
            }
          : { pickup: {}, delivery: {} },
      }
    })
    const settings = {
      ...tile.settings,
      maxRouteHours: 120 + Math.round(random() * 120),
      drivingLimitHours: 9,
      restHours: 11,
      openingHour: 8,
      preparationHours: 2,
      startRadiusKm: 100_000,
      consolidationEnabled: false,
      ranking: "profit",
    }
    const input = { orders, vehicle: tile.vehicle, settings, regions: REGIONS, now }
    const expected = bruteCalendar(input)
    const result = await R.planVehicle(input, tile.vehicle)
    const got = result.recommended ?? result.variants[0] ?? null
    if (!expected && !got) continue
    compared += 1
    if (!expected || !got) {
      failures.push(`seed ${seed}: перебор ${expected?.net ?? "нет"}, ядро ${got?.economics.netRub ?? "нет"}`)
      continue
    }
    if (Math.abs(got.economics.netRub - expected.net) > 1) {
      failures.push(
        `seed ${seed}: ядро ${got.economics.netRub} ₽ (${got.orderIds.join("→")}), ` +
          `перебор ${expected.net} ₽ (${expected.seq.join("→")})`,
      )
    }
  }

  if (failures.length > 0) console.log("  " + failures.slice(0, 10).join("\n  "))
  console.log(`  сверено задач с календарём: ${compared}`)
  assert.equal(failures.length, 0, `расхождения с эталоном календаря: ${failures.length}`)
})
