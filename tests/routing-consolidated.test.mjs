// tests/routing-consolidated.test.mjs
//
// Тесты сборной модели (модель Б): несколько грузов едут в одном кузове.
//
// Проверяется то, что можно проверить только на сборке — и то, что нельзя
// «доказать» цифрой прибыли:
//   · в кузове на КАЖДОМ участке не больше вместимости и не больше грузов,
//     чем разрешила организация;
//   · груз нельзя выгрузить раньше, чем погрузили;
//   · грузы, которые делят кузов, действительно делят его (а не «сборка» из
//     одного груза, названная сборкой);
//   · на пуле, где сборка бессмысленна, она не выдумывает выгоду;
//   · результат совпадает с независимым перебором, а не с самим собой;
//   · убыточная сборка не выдаётся за рекомендацию.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

import {
  REGIONS,
  bruteConsolidated,
  bruteSequential,
  makeConsolidatedCase,
} from "./consolidated-fixtures.mjs"

const require = createRequire(import.meta.url)
const R = require("../.test-build/lib/routing/index.js")

const NOW = new Date("2026-11-02T05:00:00.000Z")

async function planOf(tile) {
  return R.planVehicle(
    { orders: tile.orders, vehicle: tile.vehicle, settings: tile.settings, regions: REGIONS, now: NOW },
    tile.vehicle,
  )
}

function consolidatedOf(result) {
  return [...result.variants]
    .filter((plan) => plan.model === "consolidated")
    .sort((a, b) => b.economics.netCommittedRub - a.economics.netCommittedRub)
}

test("сборка: в кузове на каждом участке не больше вместимости и не больше грузов, чем разрешено", async () => {
  const tile = makeConsolidatedCase(3, "same-origin")
  tile.settings = { ...tile.settings, maxConcurrentOrders: 2 }
  const result = await planOf(tile)
  const plans = consolidatedOf(result)
  assert.ok(plans.length > 0, "на грузах с одного склада сборка должна найтись")

  for (const plan of plans) {
    for (const use of plan.capacity) {
      assert.ok(
        use.kg <= tile.vehicle.capacityKg + 1e-6,
        `на участке ${use.index} в кузове ${use.kg} кг при вместимости ${tile.vehicle.capacityKg}`,
      )
      assert.ok(
        use.m3 <= tile.vehicle.capacityM3 + 1e-6,
        `на участке ${use.index} в кузове ${use.m3} м³ при вместимости ${tile.vehicle.capacityM3}`,
      )
      assert.ok(
        use.items.length <= 2,
        `организация разрешила 2 груза одновременно, а на участке ${use.index} их ${use.items.length}`,
      )
    }
    // Независимый валидатор ядра тоже обязан не находить нарушений.
    const check = R.validatePlan(plan, tile.orders, tile.vehicle, tile.settings)
    assert.ok(check.ok, `валидатор нашёл нарушения: ${JSON.stringify(check.issues)}`)
  }
})

test("сборка: груз нельзя выгрузить раньше, чем погрузили", async () => {
  const tile = makeConsolidatedCase(4, "same-origin")
  const result = await planOf(tile)
  const plan = consolidatedOf(result)[0]
  assert.ok(plan, "сборный план должен существовать")

  for (const orderId of plan.orderIds) {
    const loadIndex = plan.stops.findIndex((stop) => stop.kind === "load" && stop.orderId === orderId)
    const unloadIndex = plan.stops.findIndex((stop) => stop.kind === "unload" && stop.orderId === orderId)
    assert.ok(loadIndex >= 0, `груз ${orderId} нигде не погружен`)
    assert.ok(unloadIndex >= 0, `груз ${orderId} нигде не выгружен`)
    assert.ok(loadIndex < unloadIndex, `груз ${orderId} выгружен раньше погрузки`)
    // И выгрузка не раньше погрузки по времени, а не только по порядку в списке.
    assert.ok(
      plan.stops[loadIndex].startAt.getTime() <= plan.stops[unloadIndex].startAt.getTime(),
      `груз ${orderId}: выгрузка по времени раньше погрузки`,
    )
  }
})

test("сборка: на грузах с одного склада сборка выигрывает у последовательной", async () => {
  let wins = 0
  const gains = []
  for (let seed = 1; seed <= 5; seed += 1) {
    const tile = makeConsolidatedCase(seed, "same-origin")
    const result = await planOf(tile)
    const consolidated = consolidatedOf(result)[0]
    const reference = bruteSequential(tile)
    assert.ok(consolidated, `seed ${seed}: сборный вариант должен быть найден`)
    const gain = consolidated.economics.netCommittedRub - reference.net
    gains.push(Math.round(gain))
    if (gain > 1) wins += 1
  }
  assert.equal(wins, 5, `сборка должна выигрывать на грузах с одного склада, выиграла ${wins} из 5 (${gains})`)
})

test("сборка: грузы, едущие вместе, действительно делят кузов", async () => {
  const tile = makeConsolidatedCase(2, "same-origin")
  const result = await planOf(tile)
  const plan = consolidatedOf(result)[0]
  assert.ok(plan)
  const shared = plan.capacity.filter((use) => use.items.length > 1)
  assert.ok(
    shared.length > 0,
    "у «сборного» плана нет ни одного участка с двумя грузами — это не сборка",
  )
  // И в объяснении это сказано словами, а не только цифрами.
  assert.ok(
    plan.reasons.some((reason) => reason.startsWith("Сборка:")),
    `в объяснении нет строки про сборку: ${JSON.stringify(plan.reasons)}`,
  )
})

test("сборка: на разбросанных грузах выгода не выдумывается", async () => {
  // Грузы по всей стране: если ядро «находит» тут сборку с большой выгодой,
  // значит оно где-то считает лишнее.
  for (let seed = 1; seed <= 5; seed += 1) {
    const tile = makeConsolidatedCase(seed, "scattered")
    const result = await planOf(tile)
    const consolidated = consolidatedOf(result)[0]
    if (!consolidated) continue
    const reference = bruteConsolidated(tile)
    assert.ok(
      consolidated.economics.netCommittedRub <= reference.net + 1,
      `seed ${seed}: сборка ${Math.round(consolidated.economics.netCommittedRub)} ₽ выше перебора ${Math.round(reference.net)} ₽`,
    )
  }
})

test("сборка: результат совпадает с независимым перебором (не с самим собой)", async () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    const tile = makeConsolidatedCase(seed, "corridor")
    const result = await planOf(tile)
    const best = result.recommended ?? result.variants[0] ?? null
    assert.ok(best, `seed ${seed}: плана нет`)
    const reference = bruteConsolidated(tile)
    const sequential = bruteSequential(tile)
    const target = Math.max(reference.net, sequential.net)
    const diff = Math.abs(best.economics.netCommittedRub - target)
    assert.ok(
      diff <= 1,
      `seed ${seed}: ядро ${Math.round(best.economics.netCommittedRub)} ₽ против перебора ${Math.round(target)} ₽ (разница ${Math.round(diff)})`,
    )
  }
})

test("сборка: убыточная сборка не выдаётся за рекомендацию", async () => {
  const tile = makeConsolidatedCase(1, "scattered")
  // Ставки в пол, цена топлива в потолок: пул заведомо убыточный.
  tile.orders = tile.orders.map((order) => ({ ...order, rate: { amount: 1000, vatIncluded: true } }))
  tile.vehicle = { ...tile.vehicle, cost: { ...tile.vehicle.cost, fuelPricePerL: 200 } }
  const result = await planOf(tile)
  const profitable = result.variants.filter((plan) => plan.economics.netCommittedRub > 0)
  assert.equal(profitable.length, 0, "при таких ставках прибыльных рейсов быть не должно")
  assert.equal(result.recommended, null, "рекомендации в убыточном пуле быть не должно")
  assert.ok(
    result.variants.every((plan) =>
      plan.warnings.some((warning) => warning.includes("убыточен")),
    ),
    "у каждого варианта должно быть предупреждение об убыточности",
  )
})

test("сборка: чужие заказы в кузов не попадают", async () => {
  const tile = makeConsolidatedCase(5, "same-origin")
  tile.orders = tile.orders.map((order, index) => ({
    ...order,
    organisationId: index === tile.orders.length - 1 ? "org-2" : "org-1",
  }))
  const foreign = new Set(tile.orders.filter((order) => order.organisationId !== "org-1").map((order) => order.id))
  const result = await planOf(tile)
  for (const plan of result.variants) {
    for (const id of plan.orderIds) {
      assert.ok(!foreign.has(id), `чужой заказ ${id} попал в сборку`)
    }
  }
  // И в отказах его быть не должно: список отказов — про СВОИ грузы. Писать
  // логисту «заказ другой организации не подошёл» значит показывать чужие
  // данные. Мультиарендность — это не только «не взять», но и «не показать».
  assert.ok(
    !result.rejected.some((item) => foreign.has(item.orderId)),
    "чужой заказ не должен появляться даже в отказах",
  )
})

test("сборка: окно погрузки — ожидание, а не отказ", async () => {
  const tile = makeConsolidatedCase(6, "same-origin")
  const later = new Date(NOW.getTime() + 30 * 3600000).toISOString()
  tile.orders = tile.orders.map((order) => ({ ...order, window: { pickup: { from: later }, delivery: {} } }))
  const result = await planOf(tile)
  const plan = consolidatedOf(result)[0]
  assert.ok(plan, "из-за будущего окна маршрут не должен пропадать")
  const waits = plan.stops.filter((stop) => stop.kind === "load" && stop.waitingHours > 0)
  assert.ok(waits.length > 0, "ожидание окна должно быть видно в плане, а не спрятано")
  const firstLoad = plan.stops.find((stop) => stop.kind === "load")
  assert.ok(
    firstLoad.startAt.getTime() >= new Date(later).getTime(),
    "погрузка началась раньше окна фрахтователя",
  )
})

test("сборка: в объяснении сказано, какая модель выиграла и на сколько", async () => {
  const tile = makeConsolidatedCase(2, "same-origin")
  const result = await planOf(tile)
  const marked = result.variants.filter((plan) =>
    plan.reasons.some((reason) => reason.startsWith("Сборка выгоднее") || reason.startsWith("Последовательная схема выгоднее")),
  )
  assert.ok(marked.length > 0, "ни у одного варианта нет сравнения моделей словами")
  // Сравнение должно быть у рекомендованного варианта, а не только у боковых.
  const recommended = result.recommended
  assert.ok(recommended)
  assert.ok(
    recommended.reasons.some((reason) => reason.includes("выгоднее")),
    `в объяснении рекомендации нет сравнения моделей: ${JSON.stringify(recommended.reasons)}`,
  )
})

test("сборка: последовательная и сборная модели сравниваются, а не подменяют друг друга", async () => {
  const tile = makeConsolidatedCase(8, "same-origin")
  const result = await planOf(tile)
  const models = new Set(result.variants.map((plan) => plan.model))
  assert.ok(models.has("consolidated"), "сборная модель должна попасть в варианты")
  // Рекомендация должна быть обоснована: либо она сборная и выгоднее, либо
  // последовательная и выгоднее — но сравнение должно существовать.
  const consolidated = consolidatedOf(result)[0]
  const sequential = [...result.variants]
    .filter((plan) => plan.model === "sequential")
    .sort((a, b) => b.economics.netCommittedRub - a.economics.netCommittedRub)[0]
  if (consolidated && sequential) {
    assert.ok(
      Math.abs(consolidated.economics.netCommittedRub - sequential.economics.netCommittedRub) > 0.5 ||
        consolidated.orderIds.join() === sequential.orderIds.join(),
      "две модели с одинаковыми деньгами и разными цепочками — повод показать разницу",
    )
  }
})

// ── Регрессии по отсечениям ─────────────────────────────────────────────────
//
// Эти сценарии ловили два настоящих дефекта поиска, оба — «умное» отсечение
// выбрасывало лучшую сборку:
//
//   1. «Лучшего ещё нет» трактовалось как «лучший равен нулю». На пуле, где
//      всё убыточно, наборы отсекались целиком: scattered-148 давал −70 733 ₽
//      вместо эталонных −13 043 ₽.
//   2. Нижняя граница остатка пути добавляла в минимальное остовное дерево
//      погрузку уже погруженного груза. Граница завышалась, отсечение по
//      деньгам убивало набор: scattered-31 давал −30 569 ₽ вместо −29 964 ₽,
//      а набор {c1,c3,c4} вообще не давал законченных маршрутов.
//
// Сверка — с независимым перебором, а не с прежним ответом ядра: тест обязан
// падать, если ядро снова начнёт терять оптимум.

test("сборка: убыточный пул не превращается в отсечение всего поиска", async () => {
  const tile = makeConsolidatedCase(148, "scattered")
  const result = await planOf(tile)
  const plan = result.recommended ?? result.variants[0] ?? null
  assert.ok(plan, "на убыточном пуле честный ответ — «ехать невыгодно», а не пустой экран")
  const brute = Math.max(bruteConsolidated(tile).net, bruteSequential(tile).net)
  assert.ok(
    plan.economics.netCommittedRub >= brute - 1,
    `ядро ${Math.round(plan.economics.netCommittedRub)} ₽ против эталона ${Math.round(brute)} ₽`,
  )
})

test("сборка: нижняя граница остатка пути не считает погрузку уже загруженного груза", async () => {
  const tile = makeConsolidatedCase(31, "scattered")
  const result = await planOf(tile)
  const plan = result.recommended ?? result.variants[0] ?? null
  assert.ok(plan)
  const brute = Math.max(bruteConsolidated(tile).net, bruteSequential(tile).net)
  assert.ok(
    plan.economics.netCommittedRub >= brute - 1,
    `ядро ${Math.round(plan.economics.netCommittedRub)} ₽ против эталона ${Math.round(brute)} ₽`,
  )
})

// Полный прогон сотен задач — в `npm run routing:mass-quality`; здесь короткая
// выборка, чтобы отсечение, которое снова начнёт терять оптимум, падало уже на
// обычных тестах, а не через десять минут.
test("сборка: 10 задач каждого вида не отстают от независимого перебора", async () => {
  for (const kind of ["same-origin", "corridor", "scattered"]) {
    for (let seed = 1; seed <= 10; seed += 1) {
      const tile = makeConsolidatedCase(seed, kind)
      const result = await planOf(tile)
      const plan = result.recommended ?? result.variants[0] ?? null
      const core = plan ? plan.economics.netCommittedRub : 0
      const brute = Math.max(bruteConsolidated(tile).net, bruteSequential(tile).net)
      assert.ok(core >= brute - 1, `${kind}-${seed}: ядро ${Math.round(core)} ₽ против эталона ${Math.round(brute)} ₽`)
      assert.ok(core <= brute + 1, `${kind}-${seed}: ядро обещает больше эталона: ${Math.round(core)} ₽ против ${Math.round(brute)} ₽`)
    }
  }
})
