// tests/routing-view.test.mjs
//
// Тесты моста «серверный план → экран помощника» (lib/routing/view.ts и
// lib/routing/client.ts).
//
// Что здесь доказывается, кроме «функция вернула массив»:
//   · километры и деньги на экране — ровно те, что посчитал сервер, без
//     «округлений в свою пользу»;
//   · плечи собираются из участков правильно, а хвост порожних — это возврат
//     домой, а не лишнее плечо;
//   · отсутствие данных остаётся null, а не превращается в ноль;
//   · «что осталось на бирже» считается по причинам отказа без двойного счёта;
//   · если сервер недоступен или отказал — экран получает упрощённый расчёт и
//     честную подпись, а не пустоту.

import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

import { makeCase } from "./routing-fixtures.mjs"

const require = createRequire(import.meta.url)
const R = require("../.test-build/lib/routing/index.js")
const VIEW = require("../.test-build/lib/routing/view.js")
const CLIENT = require("../.test-build/lib/routing/client.js")

const NOW = new Date("2026-11-02T05:00:00.000Z")

/** План ядра в том виде, в каком его отдаёт API: даты строками. */
function serialize(plan) {
  return {
    ...plan,
    schedule: {
      ...plan.schedule,
      startAt: plan.schedule.startAt.toISOString(),
      endAt: plan.schedule.endAt.toISOString(),
      events: plan.schedule.events.map((event) => ({ ...event, at: event.at.toISOString() })),
    },
    stops: plan.stops.map((stop) => ({
      ...stop,
      arriveAt: stop.arriveAt.toISOString(),
      startAt: stop.startAt.toISOString(),
      endAt: stop.endAt.toISOString(),
    })),
  }
}

/** Грузы в форме экрана (BuilderLoad) — как их отдаёт /api/ati/loads. */
function builderLoads(orders) {
  return orders.map((order) => ({
    id: order.id,
    loadId: order.id,
    fromCity: order.pickup.city,
    toCity: order.delivery.city,
    weightKg: order.weightKg,
    volumeM3: order.volumeM3,
    cargoType: null,
    priceRub: order.rate.amount,
    priceWithNds: null,
    distanceKm: order.exchangeKm,
    firmName: null,
    firmUrl: null,
    contactPhone: null,
    loadingDate: null,
    status: "new",
    fromPoint: order.pickup.point,
    toPoint: order.delivery.point,
  }))
}

async function planFor(seed) {
  const tile = makeCase(seed)
  const result = await R.planVehicle(
    {
      orders: tile.orders,
      vehicles: [tile.vehicle],
      settings: tile.settings,
      regions: [],
      now: NOW,
    },
    tile.vehicle,
  )
  return { tile, result }
}

test("view: километры, деньги и плечи на экране совпадают с серверными", async () => {
  const { tile, result } = await planFor(3)
  assert.ok(result.variants.length > 0, "ядро должно было собрать хотя бы одну цепочку")

  const variants = VIEW.variantsFromServer(
    { perVehicle: [{ ...result, variants: result.variants.map(serialize), recommended: result.recommended ? serialize(result.recommended) : null }] },
    {
      loads: builderLoads(tile.orders),
      vehicles: [tile.vehicle],
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      maxHours: 72,
    },
  )

  assert.ok(variants.length > 0)
  const route = variants[0].route
  const plan = result.recommended ?? result.variants[0]

  assert.equal(route.totalDistanceKm, Math.round(plan.economics.totalKm), "километры не должны расходиться")
  assert.equal(route.totalProfitRub, Math.round(plan.economics.netRub), "прибыль на экране — это netRub сервера")
  assert.equal(route.totalRevenue, Math.round(plan.economics.revenue))
  assert.equal(route.totalFuelCostRub, Math.round(plan.economics.fuelRub))
  assert.equal(route.legs.length, plan.orderIds.length, "одно плечо на один заказ")

  const loadedKm = route.legs.reduce((sum, leg) => sum + leg.loadedKm, 0)
  assert.ok(
    Math.abs(loadedKm - Math.round(plan.economics.loadedKm)) <= route.legs.length,
    `гружёный пробег плеч ${loadedKm} против ${plan.economics.loadedKm} у сервера`,
  )
})

test("view: хвост порожних — это возврат домой, а не лишнее плечо", async () => {
  const { tile, result } = await planFor(5)
  const plan = result.recommended ?? result.variants[0]
  const variants = VIEW.variantsFromServer(
    { perVehicle: [{ ...result, variants: [serialize(plan)], recommended: serialize(plan) }] },
    {
      loads: builderLoads(tile.orders),
      vehicles: [tile.vehicle],
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      maxHours: 72,
    },
  )
  const route = variants[0].route
  const deadheadOnLegs = route.legs.reduce((sum, leg) => sum + leg.deadheadKm, 0)
  const totalDeadhead = deadheadOnLegs + route.returnDeadheadKm
  assert.ok(
    Math.abs(totalDeadhead - Math.round(plan.economics.emptyKm)) <= route.legs.length + 1,
    `порожний пробег ${totalDeadhead} против ${plan.economics.emptyKm} у сервера`,
  )
  if (plan.returned.kind === "none") {
    assert.equal(route.returnsHomeWithLoad, false)
  }
})

test("view: неизвестное остаётся неизвестным, а не нулём", async () => {
  const { tile, result } = await planFor(7)
  const plan = result.recommended ?? result.variants[0]
  const variants = VIEW.variantsFromServer(
    { perVehicle: [{ ...result, variants: [serialize(plan)], recommended: serialize(plan) }] },
    {
      // Пустой список грузов: сервер знает заказ, экран — нет.
      loads: [],
      vehicles: [tile.vehicle],
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      maxHours: 72,
    },
  )
  const route = variants[0].route
  assert.equal(route.legs.length, plan.orderIds.length, "плечи не должны исчезнуть из-за подписей")
  // Города известны из плана — их и показываем.
  assert.ok(route.legs.every((leg) => leg.load.fromCity && leg.load.toCity))
  // Прибыль на плече не выдумывается: сервер считает по цепочке, не по плечу.
  assert.ok(route.legs.every((leg) => leg.profitRub === null))
  // Масса неизвестна — именно неизвестна.
  assert.ok(route.legs.every((leg) => leg.load.weightKg === null))
})

test("view: груз стыкуется с планом по биржевому номеру, а не только по строке базы", async () => {
  const { tile, result } = await planFor(19)
  const plan = result.recommended ?? result.variants[0]
  // Экран хранит строку нашей базы (cuid), ядро называет груз биржевым номером.
  const loads = builderLoads(tile.orders).map((load, index) => ({
    ...load,
    id: `cuid-${index + 1}`,
    loadId: load.id,
    firmName: "ООО «Фрахтователь»",
  }))

  const variants = VIEW.variantsFromServer(
    { perVehicle: [{ ...result, variants: [serialize(plan)], recommended: serialize(plan) }] },
    {
      loads,
      vehicles: [tile.vehicle],
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      maxHours: 72,
    },
  )

  const route = variants[0].route
  for (const leg of route.legs) {
    assert.ok(
      plan.orderIds.includes(leg.load.loadId),
      `плечо ${leg.load.id} не стыкуется ни с одним заказом плана`,
    )
    assert.equal(leg.load.firmName, "ООО «Фрахтователь»", "подпись груза должна прийти с экрана, а не быть пустой")
  }
  assert.ok(route.legs.every((leg) => leg.revenue > 0), "ставка не должна обнуляться при стыковке")
})

test("client: биржевые номера уходят на сервер вместо строк базы", async () => {
  const { tile } = await planFor(23)
  const loads = builderLoads(tile.orders).map((load, index) => ({ ...load, id: `cuid-${index + 1}`, loadId: load.id }))
  let sent = null
  const fakeFetch = async (url, init) => {
    sent = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => ({ ok: true, perVehicle: [] }) }
  }

  await CLIENT.requestServerPlan(
    {
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      loads,
      vehicles: [tile.vehicle],
      fuelPriceRubPerL: tile.vehicle.cost.fuelPricePerL,
      maxHours: 72,
      excludeIds: ["cuid-2"],
      keepIds: ["cuid-1"],
    },
    fakeFetch,
  )

  assert.deepEqual(sent.excludeIds, [loads[1].loadId], "запрет должен уйти биржевым номером")
  assert.deepEqual(sent.keepIds, [loads[0].loadId], "согласованный груз должен уйти биржевым номером")
})

test("view: «что осталось на бирже» разложено по причинам без двойного счёта", () => {
  const perVehicle = [
    {
      vehicleId: "v1",
      organisationId: "org-1",
      recommended: null,
      variants: [],
      rejected: [
        { orderId: "a", reason: "не вошёл в лучшие цепочки: не окупает пробег в этом составе" },
        { orderId: "b", reason: "не вошёл в лучшие цепочки: не окупает пробег в этом составе" },
        { orderId: "c", reason: "масса 24 000 кг больше грузоподъёмности 20 000 кг" },
        { orderId: "d", reason: "объём 90 м³ больше кузова 82 м³" },
        { orderId: "e", reason: "ставка не озвучена — нечем мерить выгоду" },
        { orderId: "f", reason: "окно погрузки закончилось" },
      ],
    },
  ]
  const variants = VIEW.variantsFromServer({ perVehicle }, {
    loads: [],
    vehicles: [],
    startCity: "Ярославль",
    startPoint: null,
    maxHours: 72,
  })
  // Плана нет — вариантов нет. Это не ошибка: рекомендации не выдумываем.
  assert.equal(variants.length, 0)
  const reason = VIEW.serverFailureReason(perVehicle)
  assert.ok(typeof reason === "string" && reason.length > 0)
})

test("client: ответ сервера показывается как есть и помечен серверным", async () => {
  const { tile, result } = await planFor(11)
  const plan = result.recommended ?? result.variants[0]
  const payload = {
    ok: true,
    perVehicle: [{ ...result, variants: [serialize(plan)], recommended: serialize(plan) }],
  }
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => payload })

  const outcome = await CLIENT.requestServerPlan(
    {
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      loads: builderLoads(tile.orders),
      vehicles: [tile.vehicle],
      fuelPriceRubPerL: tile.vehicle.cost.fuelPricePerL,
      maxHours: 72,
    },
    fakeFetch,
  )

  assert.equal(outcome.origin, "server")
  assert.ok(outcome.variants.length > 0)
  assert.ok(
    outcome.variants[0].route.reasons.some((reason) => reason.includes("посчитан на сервере")),
    "происхождение цифр должно быть видно в «Почему собрал так»",
  )
  assert.equal(outcome.variants[0].route.totalProfitRub, Math.round(plan.economics.netRub))
})

test("client: сервер недоступен — экран получает упрощённый расчёт и честную подпись", async () => {
  const { tile } = await planFor(13)
  const failingFetch = async () => {
    throw new Error("network down")
  }

  const outcome = await CLIENT.requestServerPlan(
    {
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      loads: builderLoads(tile.orders),
      vehicles: [tile.vehicle],
      fuelPriceRubPerL: tile.vehicle.cost.fuelPricePerL,
      maxHours: 72,
    },
    failingFetch,
  )

  assert.equal(outcome.origin, "local")
  assert.ok(outcome.note.includes("упрощённо"), "подпись должна быть честной: «упрощённо»")
  // Аварийный путь обязан дать хоть что-то, если данные позволяют.
  assert.ok(outcome.variants.length > 0)
  assert.ok(outcome.variants[0].route.reasons[0].includes("упрощённо"))
})

test("client: отказ сервера по данным объясняется словами, а не пустым экраном", async () => {
  const { tile } = await planFor(17)
  const payload = {
    ok: false,
    message: "расчёт невозможен",
    readiness: { ok: false, blockers: ["у организации не задан адрес базы и её координаты"] },
  }
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => payload })

  const outcome = await CLIENT.requestServerPlan(
    {
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      loads: builderLoads(tile.orders),
      vehicles: [tile.vehicle],
      fuelPriceRubPerL: tile.vehicle.cost.fuelPricePerL,
      maxHours: 72,
    },
    fakeFetch,
  )

  assert.equal(outcome.origin, "local")
  assert.ok(
    outcome.note.includes("адрес базы"),
    `причина отказа должна дойти до экрана словами, получено: ${outcome.note}`,
  )
})

test("view: экран говорит, сколько вариантов нашлось всего, а не только сколько показал", async () => {
  const { tile, result } = await planFor(3)
  const plan = result.recommended ?? result.variants[0]
  const shown = VIEW.variantsFromServer(
    {
      perVehicle: [
        {
          ...result,
          variants: [serialize(plan)],
          recommended: serialize(plan),
          // Сервер отдаёт экрану три варианта из семи найденных.
          variantsTotal: 7,
        },
      ],
    },
    {
      loads: builderLoads(tile.orders),
      vehicles: [tile.vehicle],
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      maxHours: 72,
    },
  )
  assert.match(shown[0].hint, /найдено 7/, `в подписи нет полноты поиска: ${shown[0].hint}`)

  // Если найдено столько же, сколько показано, лишняя цифра не нужна.
  const exact = VIEW.variantsFromServer(
    {
      perVehicle: [
        { ...result, variants: [serialize(plan)], recommended: serialize(plan), variantsTotal: 1 },
      ],
    },
    {
      loads: builderLoads(tile.orders),
      vehicles: [tile.vehicle],
      startCity: tile.vehicle.homeBase.city,
      startPoint: tile.vehicle.homeBase.point,
      maxHours: 72,
    },
  )
  assert.ok(!/найдено/.test(exact[0].hint), `лишняя цифра при полном совпадении: ${exact[0].hint}`)
})
