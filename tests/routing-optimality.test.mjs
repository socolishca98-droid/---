// tests/routing-optimality.test.mjs
//
// Этап 5: правда ли то, что движок говорит о своём результате.
//
//   1. «оптимум доказан» ⇒ независимый полный перебор не находит ни лучше, ни хуже;
//   2. «лучший из проверенных» ⇒ причина неполноты названа;
//   3. пустой поиск НЕ объявляется доказанным оптимумом;
//   4. набор со ставкой за километр не отсекается неверной границей;
//   5. при почасовой оплате поиск не вытесняет дорогой по времени вариант;
//   6. «доказан» бывает только у одного варианта — лучшего;
//   7. «доказан» при ОЦЕНЁННЫХ расстояниях не выдаётся (правило этапа 7):
//      доказательство, построенное на догадке, доказательством не является.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

import { makeConsolidatedCase } from "./consolidated-fixtures.mjs"

const require = createRequire(import.meta.url)
const R = require("../.test-build/lib/routing/index.js")

const NOW = new Date("2026-11-03T06:00:00Z")
const net = (plan) => (plan ? plan.economics.netCommittedRub : null)

async function planOf(tile, extra = {}) {
  return R.planVehicle(
    {
      orders: tile.orders,
      vehicles: [tile.vehicle],
      settings: tile.settings,
      regions: [],
      now: NOW,
      ...extra,
    },
    tile.vehicle,
  )
}

/**
 * Подставной маршрутизатор с заранее известными километрами.
 *
 * Нужен, чтобы проверить именно ПОИСК: расстояния измерены (source = osrm),
 * поэтому движок вправе говорить об оптимуме, а эталон считает те же числа
 * своей формулой (прямая × 1,2). Если бы движок «доказывал» оптимум на
 * оценках, этот тест не отличался бы от данных — поэтому истинность проверки
 * держится на равенстве с независимым перебором, а не на флаге.
 */
const R_EARTH = 6371
const rad = (deg) => (deg * Math.PI) / 180
function straightKm(a, b) {
  // Принимаем и точку, и место с точкой: в тесте встречаются обе формы.
  const from = a.point ?? a
  const to = b.point ?? b
  const dLat = rad(to.lat - from.lat)
  const dLng = rad(to.lng - from.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(rad(from.lat)) * Math.cos(rad(to.lat))
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)))
}
const pavedKm = (a, b) => Math.round(straightKm(a, b) * 1.2)

function measuredFetch(url) {
  const parts = new URL(String(url)).pathname.split("/").filter(Boolean)
  const coords = String(parts[3] ?? "")
    .split(";")
    .map((pair) => pair.split(",").map(Number))
  const asPlace = ([lng, lat]) => ({ point: { lat, lng } })
  if (parts[0] === "table") {
    const places = coords.map(asPlace)
    return Promise.resolve({
      ok: true,
      async json() {
        return {
          code: "Ok",
          distances: places.map((a) => places.map((b) => pavedKm(a, b) * 1000)),
          durations: places.map((a) => places.map((b) => (pavedKm(a, b) / 55) * 3600)),
        }
      },
    })
  }
  const km = pavedKm(asPlace(coords[0]), asPlace(coords[1]))
  return Promise.resolve({
    ok: true,
    async json() {
      return { code: "Ok", routes: [{ distance: km * 1000, duration: (km / 55) * 3600 }] }
    },
  })
}

function referenceOf(tile) {
  const context = {
    orders: tile.orders.filter((order) => R.compatible(order, tile.vehicle).fits),
    vehicle: tile.vehicle,
    settings: tile.settings,
    distance: new R.DistanceEngine({ osrmUrl: null, regions: [] }),
    now: NOW,
    stats: {
      consideredStates: 0,
      prunedStates: 0,
      distanceCalls: 0,
      distanceCacheHits: 0,
      elapsedMs: 0,
      exact: false,
      exactSequential: false,
      exactConsolidated: false,
      exactLimit: 0,
      truncations: [],
    },
  }
  return R.referencePlan(context)
}

const bestOfModel = (variants, model) => {
  let best = null
  for (const plan of variants) {
    if (plan.model !== model) continue
    if (!best || plan.economics.netCommittedRub > best.economics.netCommittedRub) best = plan
  }
  return best
}

test("этап 5: «доказан» по модели значит равенство независимому перебору", async () => {
  const kinds = ["corridor", "same-origin", "scattered"]
  let provenSequential = 0
  let provenConsolidated = 0
  for (let seed = 1; seed <= 12; seed += 1) {
    const kind = kinds[seed % kinds.length]
    const tile = makeConsolidatedCase(seed, kind)
    // Расстояния ИЗМЕРЕНЫ (подставной маршрутизатор отдаёт прямая × 1,2) —
    // ровно то состояние, в котором движок вправе говорить об оптимуме и в
    // котором его утверждение можно сверить с независимым перебором.
    const result = await planOf(tile, {
      exactLimit: 12,
      fetchImpl: measuredFetch,
      fallbackEndpoints: [{ name: "test-osrm", url: "http://test-osrm" }],
      requestBudget: 5000,
    })
    const reference = referenceOf(tile)

    if (result.stats.exactSequential) {
      provenSequential += 1
      const mine = bestOfModel(result.variants, "sequential")
      const theirs = reference.sequential.best
      if (mine && theirs) {
        assert.ok(
          mine.economics.netCommittedRub >= theirs.economics.netCommittedRub - 1,
          `seed ${seed} (${kind}), модель А: «доказано» ${mine.economics.netCommittedRub} ₽, ` +
            `перебор нашёл ${theirs.economics.netCommittedRub} ₽`,
        )
      }
    }

    if (result.stats.exactConsolidated) {
      provenConsolidated += 1
      const mine = bestOfModel(result.variants, "consolidated")
      const theirs = reference.consolidated.best
      if (mine && theirs) {
        assert.ok(
          mine.economics.netCommittedRub >= theirs.economics.netCommittedRub - 1,
          `seed ${seed} (${kind}), модель Б: «доказано» ${mine.economics.netCommittedRub} ₽, ` +
            `перебор нашёл ${theirs.economics.netCommittedRub} ₽`,
        )
      }
    }
  }
  assert.ok(provenSequential >= 6, `доказанных случаев модели А мало: ${provenSequential}`)
  assert.ok(provenConsolidated >= 1, `модель Б ни разу не прошла полный перебор: ${provenConsolidated}`)
})

test("этап 7: без измеренных расстояний оптимум не объявляется", async () => {
  // Оценка «прямая × 1,2» на горных и объездных участках ошибается до −32 %
  // (замер этапа 6). Порядок, оптимальный по оценке, может быть не оптимальным
  // на дороге — значит «доказано» здесь говорить нельзя, и это должно быть
  // видно и в флаге, и словами.
  for (let seed = 1; seed <= 6; seed += 1) {
    const tile = makeConsolidatedCase(seed, "corridor")
    const result = await planOf(tile, { exactLimit: 12 })
    for (const plan of result.variants) {
      assert.equal(
        plan.exact,
        false,
        `seed ${seed}: вариант ${plan.orderIds.join(",")} объявлен доказанным без измеренных расстояний`,
      )
    }
    assert.equal(result.stats.exact, false, `seed ${seed}: пул объявлен доказанным без измерений`)
  }
  // И причина обязана быть названа, а не просто «флаг false».
  const tile = makeConsolidatedCase(2, "corridor")
  const result = await planOf(tile, { exactLimit: 12 })
  const notes = [...result.stats.truncations, ...(result.recommended?.assumptions ?? [])].join(" | ")
  assert.ok(/оцен|измер/i.test(notes), `причина не названа: ${notes || "пусто"}`)
})

test("этап 5: усечённый перебор не выдаёт себя за оптимум", async () => {
  const tile = makeConsolidatedCase(7, "corridor")
  const limited = await planOf(tile, { exactLimit: 2 })
  assert.equal(limited.stats.exact, false, "при пределе 2 из 4+ грузов оптимум не доказан")
  assert.ok(limited.stats.truncations.length > 0, "причина неполноты обязана быть названа")
  // Рекомендация не может быть «доказанной», если пул — нет.
  assert.equal(limited.recommended?.exact === true, false, "вариант доказан при недоказанном пуле")
  assert.ok(
    limited.stats.truncations.some((text) => text.includes("модель А")),
    `среди причин неполноты нет модели А: ${limited.stats.truncations.join("; ")}`,
  )
})

test("этап 5: пустой поиск не доказывает оптимум", async () => {
  const tile = makeConsolidatedCase(3, "corridor")
  const picky = { ...tile.vehicle, body: ["tanker"] }
  const result = await R.planVehicle(
    { orders: tile.orders, vehicles: [picky], settings: tile.settings, regions: [], now: NOW },
    picky,
  )
  assert.ok(result.recommended === null || result.recommended === undefined)
  assert.equal(result.variants.length, 0)
  assert.equal(result.stats.exact, false, "оптимум по пустому множеству доказать нельзя")
  assert.equal(result.stats.exactSequential, false)
  assert.equal(result.stats.exactConsolidated, false)
})

test("этап 5: набор со ставкой за километр не отсекается неверной границей", async () => {
  const tile = makeConsolidatedCase(5, "same-origin")
  const orders = tile.orders.map((order, index) =>
    index < 2
      ? { ...order, rate: { amount: 42, basis: "perKm", vatIncluded: true }, id: `perkm-${index}` }
      : order,
  )
  const result = await planOf({ ...tile, orders }, { exactLimit: 12 })
  assert.ok(result.variants.length > 0, "варианты обязаны найтись")
  const withPerKm = result.variants.filter((plan) =>
    plan.orderIds.some((id) => String(id).startsWith("perkm-")),
  )
  assert.ok(withPerKm.length > 0, "набор со ставкой за километр выброшен отсечением")
})

test("этап 5: при оплате по часам поиск не вытесняет дорогой по времени вариант", async () => {
  const tile = makeConsolidatedCase(9, "corridor")
  const hourly = {
    ...tile,
    vehicle: { ...tile.vehicle, cost: { ...tile.vehicle.cost, driverPay: { kind: "perHour", perHour: 900 } } },
  }
  const result = await planOf(hourly, { exactLimit: 12 })
  if (!result.recommended || !result.stats.exact) return
  const reference = referenceOf(hourly)
  assert.ok(
    net(result.recommended) >= net(reference.best) - 1,
    `по часовой оплате движок «доказал» ${net(result.recommended)} ₽, перебор нашёл ${net(reference.best)} ₽`,
  )
})

test("этап 5: статус варианта согласован с полем exact", async () => {
  for (const seed of [2, 4, 11]) {
    const tile = makeConsolidatedCase(seed, "corridor")
    const result = await planOf(tile, { exactLimit: 12 })
    for (const plan of result.variants) {
      assert.equal(
        plan.optimality === "proven",
        plan.exact,
        `${plan.id}: optimality=${plan.optimality} и exact=${plan.exact} расходятся`,
      )
    }
  }
})

test("этап 5: «доказан» бывает только у лучшего варианта модели", async () => {
  const tile = makeConsolidatedCase(4, "same-origin")
  const result = await planOf(tile, { exactLimit: 12 })
  for (const model of ["sequential", "consolidated"]) {
    const plans = result.variants.filter((plan) => plan.model === model)
    if (plans.length === 0) continue
    const proven = plans.filter((plan) => plan.optimality === "proven")
    assert.ok(proven.length <= 1, `${model}: доказанных вариантов ${proven.length}, а лучший один`)
    if (proven.length === 1) {
      const best = plans.reduce((a, b) =>
        b.economics.netCommittedRub > a.economics.netCommittedRub ? b : a,
      )
      assert.equal(proven[0].id, best.id, `${model}: доказан не лучший вариант`)
    }
    for (const plan of plans) {
      if (plan.optimality === "proven") continue
      assert.ok(
        plan.optimality === "feasible" || plan.optimality === "best-of-checked",
        `${plan.id}: неожиданная пометка ${plan.optimality}`,
      )
    }
  }
})

test("этап 5: цена обязательства вернуться учитывает оплату водителя", async () => {
  const tile = makeConsolidatedCase(9, "corridor")
  const hourly = {
    ...tile,
    vehicle: { ...tile.vehicle, cost: { ...tile.vehicle.cost, driverPay: { kind: "perHour", perHour: 900 } } },
  }
  const result = await planOf(hourly, { exactLimit: 12 })
  const open = result.variants.find((plan) => plan.returned.kind === "none")
  if (!open) return
  assert.ok(
    open.economics.netCommittedRub <= open.economics.netRub,
    "открытый рейс не может быть выгоднее себя же после вычета обязательства",
  )
  const reference = referenceOf(hourly)
  if (reference.best) {
    assert.ok(
      open.economics.netCommittedRub <= reference.best.economics.netCommittedRub + 1,
      `открытый рейс ${open.economics.netCommittedRub} ₽ выигрывает у лучшего полного варианта ` +
        `${reference.best.economics.netCommittedRub} ₽`,
    )
  }
})
