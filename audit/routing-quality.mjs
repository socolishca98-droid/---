#!/usr/bin/env node
// audit/routing-quality.mjs
//
// Протокол проверки нового расчётного ядра (lib/routing). Ничего не меняет,
// пишет отчёт в audit/routing-quality.json и печатает сводку.
//
// Что измеряется:
//   1. качество поиска против независимого перебора (последовательная модель);
//   2. что даёт сборная модель поверх последовательной;
//   3. корректность: каждый выданный вариант проходит независимый валидатор;
//   4. производительность: время, состояния, отсечения, попадания в кеш;
//   5. изоляция организаций и независимость от города базы.
//
// Запуск: npm run test:build && node audit/routing-quality.mjs

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CITIES, REGIONS, R, bruteCalendar, bruteForce, makeCase, mulberry32 } from "../tests/routing-fixtures.mjs"
import {
  bruteConsolidated,
  bruteSequential,
  makeConsolidatedCase,
} from "../tests/consolidated-fixtures.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const NOW = new Date("2026-11-02T05:00:00.000Z")
const results = { generatedAt: new Date().toISOString(), checks: {} }

const pct = (value) => `${(value * 100).toFixed(2)} %`

// ── 1. Качество против перебора (без календарных эффектов) ──────────────────
async function qualityVsBruteForce(cases) {
  const rows = []
  for (let seed = 1; seed <= cases; seed += 1) {
    const tile = makeCase(seed)
    const settings = {
      ...tile.settings,
      maxRouteHours: 100_000,
      drivingLimitHours: 100_000,
      restHours: 0,
      openingHour: 0,
      preparationHours: 0,
      startRadiusKm: 100_000,
      consolidationEnabled: false,
      ranking: "profit",
    }
    const input = { orders: tile.orders, vehicle: tile.vehicle, settings, regions: REGIONS, now: NOW }
    const expected = bruteForce(input)
    const plan = await R.planVehicle(input, tile.vehicle)
    const got = plan.recommended ?? plan.variants[0] ?? null
    if (!expected && !got) continue
    const gap = !expected || !got ? 1 : Math.abs(got.economics.netRub - expected.net) / Math.max(1, Math.abs(expected.net))
    rows.push({
      seed,
      orders: tile.orders.length,
      expected: expected?.net ?? null,
      got: got?.economics.netRub ?? null,
      gap,
      better: expected && got ? got.economics.netRub > expected.net + 1 : false,
    })
  }
  const worst = rows.reduce((acc, row) => (row.gap > acc.gap ? row : acc), { gap: 0 })
  return {
    cases: rows.length,
    mismatches: rows.filter((row) => row.gap > 1e-9).length,
    worstGapShare: worst.gap,
    worstSeed: worst.gap > 0 ? worst.seed : null,
    engineBetter: rows.filter((row) => row.better).length,
    rows,
  }
}

// ── 2. Календарь: окна, отдых, часы работы склада ──────────────────────────
async function qualityWithCalendar(cases) {
  const rows = []
  for (let seed = 1; seed <= cases; seed += 1) {
    const tile = makeCase(seed)
    const random = mulberry32(seed * 7919)
    const orders = tile.orders.map((order) => {
      const withWindow = random() < 0.5
      const shiftHours = Math.round(random() * 36)
      return {
        ...order,
        window: withWindow
          ? { pickup: { from: new Date(NOW.getTime() + shiftHours * 3600000).toISOString() }, delivery: {} }
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
    const input = { orders, vehicle: tile.vehicle, settings, regions: REGIONS, now: NOW }
    const expected = bruteCalendar(input)
    const plan = await R.planVehicle(input, tile.vehicle)
    const got = plan.recommended ?? plan.variants[0] ?? null
    if (!expected && !got) continue
    const gap = !expected || !got ? 1 : Math.abs(got.economics.netRub - expected.net) / Math.max(1, Math.abs(expected.net))
    rows.push({ seed, expected: expected?.net ?? null, got: got?.economics.netRub ?? null, gap })
  }
  return {
    cases: rows.length,
    mismatches: rows.filter((row) => row.gap > 1e-9).length,
    worstGapShare: rows.reduce((max, row) => Math.max(max, row.gap), 0),
  }
}

// ── 3. Сборная модель: сколько добавляет и не ломает ли физику ──────────────
async function consolidationGain(cases) {
  const rows = []
  for (let seed = 1; seed <= cases; seed += 1) {
    const tile = makeCase(seed)
    const base = {
      ...tile.settings,
      maxRouteHours: 200,
      ranking: "profit",
    }
    const sequentialOnly = await R.planVehicle(
      { ...{ orders: tile.orders, vehicle: tile.vehicle, settings: { ...base, consolidationEnabled: false }, regions: REGIONS, now: NOW } },
      tile.vehicle,
    )
    const withConsolidation = await R.planVehicle(
      { ...{ orders: tile.orders, vehicle: tile.vehicle, settings: { ...base, consolidationEnabled: true }, regions: REGIONS, now: NOW } },
      tile.vehicle,
    )
    const seq = sequentialOnly.recommended?.economics.netCommittedRub ?? null
    const both = withConsolidation.recommended?.economics.netCommittedRub ?? null
    const consolidatedPlan = withConsolidation.variants.find((plan) => plan.model === "consolidated")
    rows.push({
      seed,
      sequentialOnly: seq,
      withConsolidation: both,
      bestConsolidated: consolidatedPlan?.economics.netCommittedRub ?? null,
      gainRub: seq !== null && both !== null ? both - seq : null,
      valid: withConsolidation.variants.every((plan) =>
        R.validatePlan(plan, tile.orders, tile.vehicle, { ...base, consolidationEnabled: true }).ok,
      ),
    })
  }
  const gains = rows.filter((row) => typeof row.gainRub === "number")
  return {
    cases: rows.length,
    improved: gains.filter((row) => row.gainRub > 1).length,
    worsened: gains.filter((row) => row.gainRub < -1).length,
    totalGainRub: gains.reduce((sum, row) => sum + Math.max(0, row.gainRub), 0),
    invalidPlans: rows.filter((row) => !row.valid).length,
    rows,
  }
}

// ── 3б. Сборные задачи, собранные нарочно ──────────────────────────────────
//
// На случайных парах «город → случайный город» сборка почти не встречается:
// грузы едут в разные стороны, и собирать их нечем. Смысл этой проверки —
// задачи, где сборка объективно возможна: один город погрузки, попутные
// направления, небольшие партии.
async function designedConsolidation() {
  const data = (city) => {
    const item = CITIES.find((entry) => entry.city === city)
    return {
      id: city.toLowerCase(),
      city,
      region: item.region,
      point: { lat: item.lat, lng: item.lng },
      timeZone: "Europe/Moscow",
    }
  }
  const vehicle = makeVehicleFixture()
  const makeOrder = (id, from, to, amount, weightKg, volumeM3) => ({
    id,
    organisationId: "org-1",
    pickup: data(from),
    delivery: data(to),
    weightKg,
    volumeM3,
    bodyRequired: ["tent"],
    window: { pickup: {}, delivery: {} },
    rate: { amount, vatIncluded: true },
    exchangeKm: null,
  })

  const cases = [
    {
      name: "три партии из Ярославля в одну сторону",
      orders: [
        makeOrder("d1", "Ярославль", "Москва", 38000, 4000, 12),
        makeOrder("d2", "Ярославль", "Тула", 45000, 5000, 14),
        makeOrder("d3", "Ярославль", "Брянск", 62000, 4500, 13),
      ],
    },
    {
      name: "две партии в Кострому и обратный груз",
      orders: [
        makeOrder("e1", "Ярославль", "Кострома", 26000, 3000, 10),
        makeOrder("e2", "Ярославль", "Кострома", 24000, 3500, 9),
        makeOrder("e3", "Кострома", "Ярославль", 25000, 3000, 10),
      ],
    },
    {
      name: "попутные грузы через Москву",
      orders: [
        makeOrder("f1", "Ярославль", "Москва", 30000, 2500, 8),
        makeOrder("f2", "Ярославль", "Тула", 44000, 3000, 10),
        makeOrder("f3", "Москва", "Тула", 21000, 2000, 6),
        makeOrder("f4", "Тула", "Ярославль", 52000, 5000, 16),
      ],
    },
  ]

  const rows = []
  for (const [index, item] of cases.entries()) {
    const settings = { ...R.DEFAULT_SETTINGS, maxRouteHours: 168, ranking: "profit" }
    const without = await R.planVehicle(
      {
        orders: item.orders,
        vehicle,
        settings: { ...settings, consolidationEnabled: false },
        regions: REGIONS,
        now: NOW,
      },
      vehicle,
    )
    const withBoth = await R.planVehicle(
      { orders: item.orders, vehicle, settings, regions: REGIONS, now: NOW },
      vehicle,
    )
    const [sequentialOnly, both] = [without, withBoth]
    const seqNet = sequentialOnly.recommended?.economics.netCommittedRub ?? null
    const bothNet = both.recommended?.economics.netCommittedRub ?? null
    const consolidated = both.variants.find((plan) => plan.model === "consolidated")
    rows.push({
      name: item.name,
      orders: item.orders.length,
      sequentialOnlyNet: seqNet,
      withConsolidationNet: bothNet,
      bestConsolidatedNet: consolidated?.economics.netCommittedRub ?? null,
      bestConsolidatedOrders: consolidated?.orderIds ?? null,
      gainRub: seqNet !== null && bothNet !== null ? bothNet - seqNet : null,
      valid: both.variants.every((plan) => R.validatePlan(plan, item.orders, vehicle, settings).ok),
      seedIndex: index,
    })
  }
  return rows
}

// ── 4. Производительность ──────────────────────────────────────────────────
async function performance() {
  const cities = CITIES.map((item) => item.city)
  const out = []
  for (const size of [8, 12, 20, 40, 60]) {
    const orders = Array.from({ length: size }, (_, index) =>
      makeOrderFixture(cities, index),
    )
    const vehicle = makeVehicleFixture()
    const settings = { ...R.DEFAULT_SETTINGS, maxRouteHours: 120 }
    const started = Date.now()
    const result = await R.planVehicle(
      { orders, vehicle, settings, regions: REGIONS, now: NOW },
      vehicle,
    )
    out.push({
      orders: size,
      elapsedMs: Date.now() - started,
      states: result.stats.consideredStates,
      pruned: result.stats.prunedStates,
      distanceCalls: result.stats.distanceCalls,
      cacheHits: result.stats.distanceCacheHits,
      exact: result.stats.exact,
      variants: result.variants.length,
      bestNet: result.recommended?.economics.netCommittedRub ?? null,
      valid: result.variants.every((plan) => R.validatePlan(plan, orders, vehicle, settings).ok),
    })
  }
  return out
}

function makeOrderFixture(cities, index) {
  const data = (city) => {
    const item = CITIES.find((entry) => entry.city === city)
    return {
      id: city.toLowerCase(),
      city,
      region: item.region,
      point: { lat: item.lat, lng: item.lng },
      timeZone: "Europe/Moscow",
    }
  }
  const from = cities[index % cities.length]
  const to = cities[(index * 3 + 1) % cities.length]
  return {
    id: `perf-${index}`,
    organisationId: "org-1",
    pickup: data(from === to ? cities[(index + 1) % cities.length] : from),
    delivery: data(to),
    weightKg: 3000 + (index % 5) * 2500,
    volumeM3: 10 + (index % 4) * 6,
    bodyRequired: ["tent"],
    window: { pickup: {}, delivery: {} },
    rate: { amount: 40000 + index * 2500, vatIncluded: true },
    exchangeKm: null,
  }
}

function makeVehicleFixture() {
  return {
    id: "perf-truck",
    organisationId: "org-1",
    plate: "ПРОБА",
    homeBase: {
      id: "ярославль",
      city: "Ярославль",
      region: "Ярославская область",
      point: { lat: 57.6261, lng: 39.8845 },
      timeZone: "Europe/Moscow",
    },
    capacityKg: 20000,
    capacityM3: 86,
    body: ["tent"],
    consumptionLPer100: 30,
    consumptionEstimated: false,
    cost: {
      fuelPricePerL: 70,
      driverPay: { kind: "perShift", perShift: 8000 },
      maintenancePerKm: 9,
      tiresPerKm: 2.5,
      tollsPerKm: 0,
      otherPerKm: 2,
      fixedPerDay: 4000,
    },
    status: "available",
  }
}

// ── 4б. Скорость сборной модели на больших пулах ──────────────────────────
async function consolidationPerformance() {
  const rows = []
  for (const count of [12, 40, 120]) {
    const tile = makeConsolidatedCase(1, "corridor")
    const orders = Array.from({ length: count }, (_, index) => {
      const source = tile.orders[index % tile.orders.length]
      return { ...source, id: `p${index}`, rate: { amount: 25000 + index * 1500, vatIncluded: true } }
    })
    const settings = { ...tile.settings, maxLegs: 6 }
    const startedAt = Date.now()
    const result = await R.planVehicle(
      { orders, vehicle: tile.vehicle, settings, regions: REGIONS, now: NOW },
      tile.vehicle,
    )
    rows.push({
      orders: count,
      elapsedMs: Date.now() - startedAt,
      states: result.stats.consideredStates,
      groups: result.stats.consideredGroups ?? null,
      consolidatedVariants: result.variants.filter((plan) => plan.model === "consolidated").length,
      valid: result.variants.every((plan) => R.validatePlan(plan, orders, tile.vehicle, settings).ok),
    })
  }
  return rows
}

// ── 4в. Разные города и разный вес ────────────────────────────────────────
/**
 * Один и тот же планировщик проверяется от пяти баз и на четырёх машинах.
 *
 * Зачем: тесты доказывают арифметику на одной базе, а требование к системе —
 * мультирегиональность. Здесь видно, что от Краснодара и Красноярска маршрут
 * строится так же, как от Ярославля, что часовые пояса не ломают календарь и
 * что машина другого веса получает другой маршрут, а не «тот же самый».
 */
const BASE_CITIES = [
  { city: "Ярославль", lat: 57.6261, lng: 39.8845, region: "Ярославская область", tz: "Europe/Moscow" },
  { city: "Москва", lat: 55.7558, lng: 37.6173, region: "Москва", tz: "Europe/Moscow" },
  { city: "Екатеринбург", lat: 56.8389, lng: 60.6057, region: "Свердловская область", tz: "Asia/Yekaterinburg" },
  { city: "Краснодар", lat: 45.0355, lng: 38.9753, region: "Краснодарский край", tz: "Europe/Moscow" },
  { city: "Красноярск", lat: 56.0095, lng: 92.8732, region: "Красноярский край", tz: "Asia/Krasnoyarsk" },
]

/** Города для выгрузок: вокруг каждой базы, в разных поясах. */
const DESTINATIONS = [
  { city: "Тула", lat: 54.1961, lng: 37.6182, region: "Тульская область", tz: "Europe/Moscow" },
  { city: "Нижний Новгород", lat: 56.3269, lng: 44.0059, region: "Нижегородская область", tz: "Europe/Moscow" },
  { city: "Казань", lat: 55.7963, lng: 49.1088, region: "Татарстан", tz: "Europe/Moscow" },
  { city: "Самара", lat: 53.1959, lng: 50.1002, region: "Самарская область", tz: "Europe/Samara" },
  { city: "Челябинск", lat: 55.1644, lng: 61.4368, region: "Челябинская область", tz: "Asia/Yekaterinburg" },
  { city: "Новосибирск", lat: 55.0084, lng: 82.9357, region: "Новосибирская область", tz: "Asia/Novosibirsk" },
  { city: "Ростов-на-Дону", lat: 47.2357, lng: 39.7015, region: "Ростовская область", tz: "Europe/Moscow" },
  { city: "Воронеж", lat: 51.672, lng: 39.1843, region: "Воронежская область", tz: "Europe/Moscow" },
]

const CAPACITIES = [
  { kg: 1500, m3: 12, consumption: 12 },
  { kg: 5000, m3: 32, consumption: 17 },
  { kg: 10000, m3: 60, consumption: 22 },
  { kg: 20000, m3: 82, consumption: 30 },
]

const placeOfCity = (item) => ({
  id: item.city.toLowerCase(),
  city: item.city,
  region: item.region,
  point: { lat: item.lat, lng: item.lng },
  timeZone: item.tz,
})

const regionsOf = (items) => [
  ...new Map(items.map((item) => [item.region, item])).values(),
].map((item) => ({ key: item.region, speedLoadedKmh: 55, speedEmptyKmh: 60, roadFactor: 1.2 }))

function vehicleFor(base, capacity) {
  return {
    id: `veh-${capacity.kg}`,
    organisationId: "org-base",
    plate: `ПРОВЕРКА-${capacity.kg}`,
    homeBase: placeOfCity(base),
    capacityKg: capacity.kg,
    capacityM3: capacity.m3,
    body: ["tent"],
    consumptionLPer100: capacity.consumption,
    consumptionEstimated: false,
    cost: {
      fuelPricePerL: 70,
      driverPay: { kind: "perShift", perShift: 8000 },
      maintenancePerKm: 9,
      tiresPerKm: 2.5,
      tollsPerKm: 0,
      otherPerKm: 2,
      fixedPerDay: 4000,
    },
    status: "available",
  }
}

/**
 * Пул под конкретную базу: погрузки рядом с базой, выгрузки — в разные стороны.
 *
 * Ставка считается от расстояния, а не «средней по больнице»: иначе из
 * Краснодара все рейсы выходили заведомо убыточными (дальние плечи по цене
 * ближних), и проверка показывала «маршрута нет» там, где дело было в
 * генераторе, а не в планировщике.
 */
function poolForBase(base) {
  const others = DESTINATIONS.filter((item) => item.city !== base.city)
  const distanceKm = (a, b) => {
    const rad = (value) => (value * Math.PI) / 180
    const dLat = rad(b.lat - a.lat)
    const dLng = rad(b.lng - a.lng)
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
    return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.25
  }
  // Ближайшие направления: с «первых попавшихся» Красноярск получал только
  // плечи по 3000–4000 км, которые не влезают в горизонт рейса, и проверка
  // показывала «маршрута нет» вместо честного «нет близких грузов».
  const nearest = [...others]
    .sort((a, b) => distanceKm(base, a) - distanceKm(base, b))
    .slice(0, 6)
  return nearest.map((destination, index) => {
    const km = distanceKm(base, destination)
    return {
      id: `${base.city}-${index}`,
      organisationId: "org-base",
      pickup: placeOfCity(index < 4 ? base : nearest[(index + 1) % nearest.length]),
      delivery: placeOfCity(destination),
      // Мелкие партии в начале списка: иначе полторы тонны не получают ни
      // одного груза и «маршрута нет» относится к генератору, а не к машине.
      weightKg: 500 + index * 650,
      volumeM3: 4 + index * 2,
      bodyRequired: ["tent"],
      window: { pickup: {}, delivery: {} },
      // Ставка ≈ рынок: круг «туда-обратно» окупается, иначе любая машина
      // выходила убыточной, и проверка мерила генератор, а не планировщик.
      rate: { amount: Math.round(Math.max(25000, km * 95)), vatIncluded: true },
      exchangeKm: null,
    }
  })
}

async function basesAndWeights() {
  const rows = []
  const problems = []
  const bases = new Set()

  for (const base of BASE_CITIES) {
    const orders = poolForBase(base)
    const basePlace = placeOfCity(base)
    const regions = regionsOf([base, ...DESTINATIONS])
    const settings = {
      ...R.DEFAULT_SETTINGS,
      maxRouteHours: 240,
      drivingLimitHours: 9,
      restHours: 11,
      openingHour: 8,
      startRadiusKm: 100_000,
      maxLegs: 6,
      consolidationEnabled: true,
      maxConcurrentOrders: 3,
      handlingHoursPerTon: 0.15,
    }

    for (const capacity of CAPACITIES) {
      const vehicle = vehicleFor(base, capacity)
      // База у машины — своя: ядро не знает «главного» города.
      vehicle.homeBase = basePlace
      const result = await R.planVehicle(
        { orders, vehicle, settings, regions, now: NOW },
        vehicle,
      )
      const plan = result.recommended
      if (!plan) {
        rows.push({ base: base.city, capacityKg: capacity.kg, hasPlan: false })
        continue
      }
      bases.add(base.city)
      const check = R.validatePlan(plan, orders, vehicle, settings)
      if (!check.ok) problems.push(`${base.city}/${capacity.kg}: ${check.issues.map((i) => i.message).join("; ")}`)

      const crossTimeZones = plan.stops.some(
        (stop) => stop.place.timeZone && stop.place.timeZone !== base.tz,
      )
      const calendarHours = (new Date(plan.schedule.endAt).getTime() - new Date(plan.schedule.startAt).getTime()) / 3_600_000
      // Календарь не может быть короче чистой езды: если короче — время
      // считается неверно, и это ошибка, а не «оптимизация».
      if (calendarHours + 1e-6 < plan.schedule.drivingHours) {
        problems.push(`${base.city}/${capacity.kg}: календарь ${calendarHours.toFixed(1)} ч короче езды ${plan.schedule.drivingHours.toFixed(1)} ч`)
      }
      if (plan.economics.emptyKm > plan.economics.totalKm + 1e-6) {
        problems.push(`${base.city}/${capacity.kg}: порожний пробег больше общего`)
      }

      rows.push({
        base: base.city,
        capacityKg: capacity.kg,
        hasPlan: true,
        model: plan.model,
        legs: plan.orderIds.length,
        totalKm: Math.round(plan.economics.totalKm),
        emptyShare: Math.round(plan.economics.emptyShare * 100),
        drivingHours: Math.round(plan.schedule.drivingHours),
        calendarHours: Math.round(calendarHours),
        netRub: Math.round(plan.economics.netCommittedRub),
        exact: plan.exact,
        crossTimeZones,
        valid: check.ok,
      })
    }
  }

  return { rows, problems, basesCovered: [...bases].length }
}

// ── 5. Изоляция организаций и независимость от города ──────────────────────
async function isolation() {
  const vehicle = makeVehicleFixture()
  const orders = [1, 2, 3].map((index) => ({
    ...makeOrderFixture(["Ярославль", "Тула", "Москва"], index),
    organisationId: index === 3 ? "org-2" : "org-1",
  }))
  const settings = { ...R.DEFAULT_SETTINGS, maxRouteHours: 168 }
  const plan = await R.planVehicle({ orders, vehicle, settings, regions: REGIONS, now: NOW }, vehicle)
  const alienIds = new Set(orders.filter((order) => order.organisationId !== "org-1").map((order) => order.id))
  const leak = plan.variants.some((variant) => variant.orderIds.some((id) => alienIds.has(id)))

  // Смена базы должна менять числа, а не только подпись.
  const other = { ...vehicle, homeBase: { ...vehicle.homeBase, id: "краснодар", city: "Краснодар", region: "Краснодарский край", point: { lat: 45.0355, lng: 38.9753 } } }
  const fromYar = await R.planVehicle({ orders, vehicle, settings, regions: REGIONS, now: NOW }, vehicle)
  const fromKrd = await R.planVehicle({ orders, vehicle: other, settings, regions: REGIONS, now: NOW }, other)

  return {
    foreignOrdersLeak: leak,
    baseChangesFirstLeg: fromYar.recommended?.segments[0]?.km !== fromKrd.recommended?.segments[0]?.km,
    yarFirstLegKm: fromYar.recommended?.segments[0]?.km ?? null,
    krdFirstLegKm: fromKrd.recommended?.segments[0]?.km ?? null,
  }
}

// ── 2б. Сборная модель против независимого перебора ────────────────────────
//
// Здесь измеряется именно сборка, а не «ядро вообще». Задачи трёх видов:
//   · same-origin — несколько грузов с одного склада в разные стороны: сборка
//     обязана выигрывать;
//   · corridor — погрузки вдоль коридора: сборка возможна;
//   · scattered — грузы по всей стране: сборка выигрывать НЕ должна.
// Эталон (tests/consolidated-fixtures.mjs) перебирает порядки погрузок и
// выгрузок независимо от ядра: своя арифметика расстояний, времени и денег.
async function consolidationVsBruteForce(cases) {
  const out = {}
  for (const kind of ["same-origin", "corridor", "scattered"]) {
    const rows = []
    let elapsed = 0
    for (let seed = 1; seed <= cases; seed += 1) {
      const tile = makeConsolidatedCase(seed, kind)
      const startedAt = Date.now()
      const result = await R.planVehicle(
        { orders: tile.orders, vehicle: tile.vehicle, settings: tile.settings, regions: REGIONS, now: NOW },
        tile.vehicle,
      )
      elapsed += Date.now() - startedAt
      const best = result.recommended ?? result.variants[0] ?? null
      const reference = bruteConsolidated(tile)
      const sequentialReference = bruteSequential(tile)
      const target = Math.max(reference?.net ?? -Infinity, sequentialReference?.net ?? -Infinity)
      const got = best?.economics.netCommittedRub ?? null
      const consolidated = [...result.variants]
        .filter((plan) => plan.model === "consolidated")
        .sort((a, b) => b.economics.netCommittedRub - a.economics.netCommittedRub)[0]
      rows.push({
        seed,
        kind,
        got,
        target,
        // Допуск в рубль: ядро округляет деньги до целых, эталон считает с
        // копейками. Ноль копеек совпадением не считается — это погрешность
        // округления, а не расхождение расчёта.
        gapRub: got === null ? Infinity : Math.abs(got - target),
        gap: got === null ? 1 : Math.abs(got - target) / Math.max(1, Math.abs(target)),
        sequentialReference: sequentialReference?.net ?? null,
        consolidatedNet: consolidated?.economics.netCommittedRub ?? null,
        consolidatedOrders: consolidated?.orderIds ?? null,
        improvedVsSequential:
          consolidated && sequentialReference
            ? consolidated.economics.netCommittedRub - sequentialReference.net
            : null,
        valid: result.variants.every((plan) => R.validatePlan(plan, tile.orders, tile.vehicle, tile.settings).ok),
      })
    }
    const improved = rows.filter((row) => (row.improvedVsSequential ?? 0) > 1)
    out[kind] = {
      cases: rows.length,
      matches: rows.filter((row) => row.gapRub <= 1).length,
      behind: rows.filter((row) => row.gapRub > 1).length,
      worstGapShare: rows.reduce((max, row) => Math.max(max, row.gap), 0),
      consolidatedWins: improved.length,
      consolidatedGainRub: Math.round(improved.reduce((sum, row) => sum + row.improvedVsSequential, 0)),
      invalidPlans: rows.filter((row) => !row.valid).length,
      avgMs: Math.round(elapsed / rows.length),
      rows: rows.map((row) => ({ ...row, gap: Number(row.gap.toFixed(5)) })),
    }
  }
  return out
}

// ── Прогон ─────────────────────────────────────────────────────────────────
const bruteSmall = await qualityVsBruteForce(120)
const bruteCalendarBlock = await qualityWithCalendar(60)
const consolidation = await consolidationGain(40)
const consolidationBlock = await consolidationVsBruteForce(30)
const designed = await designedConsolidation()
const perf = await performance()
const basesBlock = await basesAndWeights()
const consolidationPerf = await consolidationPerformance()
const isolationBlock = await isolation()

results.checks = {
  vsBruteForce: { ...bruteSmall, rows: undefined },
  vsBruteCalendar: bruteCalendarBlock,
  consolidation: { ...consolidation, rows: undefined },
  consolidationVsBruteForce: Object.fromEntries(
    Object.entries(consolidationBlock).map(([kind, block]) => [kind, { ...block, rows: undefined }]),
  ),
  designedConsolidation: designed,
  performance: perf,
  basesAndWeights: basesBlock,
  consolidationPerformance: consolidationPerf,
  isolation: isolationBlock,
}

fs.writeFileSync(path.join(here, "routing-quality.json"), JSON.stringify(results, null, 2))

console.log("── Качество против перебора (последовательная модель) ──")
console.log(`задач: ${bruteSmall.cases}, расхождений: ${bruteSmall.mismatches}, худшее: ${pct(bruteSmall.worstGapShare)}`)
console.log(`ядро нашло строго больше: ${bruteSmall.engineBetter}`)
console.log("\n── Календарь: окна, отдых, часы склада ──")
console.log(`задач: ${bruteCalendarBlock.cases}, расхождений: ${bruteCalendarBlock.mismatches}, худшее: ${pct(bruteCalendarBlock.worstGapShare)}`)
console.log("\n── Сборная модель ──")
console.log(
  `задач: ${consolidation.cases}, улучшила: ${consolidation.improved}, ухудшила: ${consolidation.worsened}, ` +
    `суммарно добавила: ${consolidation.totalGainRub} ₽, невалидных вариантов: ${consolidation.invalidPlans}`,
)
console.log("\n── Сборная модель против независимого перебора ──")
for (const [kind, block] of Object.entries(consolidationBlock)) {
  console.log(
    `  ${kind}: задач ${block.cases}, совпало с перебором ${block.matches}, отстало ${block.behind} ` +
      `(худшее ${pct(block.worstGapShare)}), сборка лучше последовательной в ${block.consolidatedWins} задачах ` +
      `на ${block.consolidatedGainRub} ₽, невалидных ${block.invalidPlans}, ${block.avgMs} мс`,
  )
}

console.log("\n── Сборные задачи, собранные нарочно ──")
for (const row of designed) {
  console.log(
    `  ${row.name}: без сборки ${row.sequentialOnlyNet} ₽, со сборкой ${row.withConsolidationNet} ₽ ` +
      `(сборный вариант ${row.bestConsolidatedNet} ₽ [${(row.bestConsolidatedOrders ?? []).join(", ")}]), ` +
      `выигрыш ${row.gainRub} ₽, валидно: ${row.valid}`,
  )
}

console.log("\n── Производительность ──")
for (const row of perf) {
  console.log(
    `  ${String(row.orders).padStart(3)} заказов: ${String(row.elapsedMs).padStart(6)} мс, ` +
      `состояний ${row.states}, отсечено ${row.pruned}, ` +
      `расстояний ${row.distanceCalls} (кеш ${row.cacheHits}), точный перебор: ${row.exact}, ` +
      `вариантов ${row.variants}, валидно: ${row.valid}`,
  )
}
console.log("\n── Скорость сборной модели ──")
for (const row of consolidationPerf) {
  console.log(
    `  ${String(row.orders).padStart(3)} заказов: ${String(row.elapsedMs).padStart(5)} мс, состояний ${row.states}, ` +
      `наборов ${row.groups ?? "—"}, сборных вариантов ${row.consolidatedVariants}, валидно: ${row.valid}`,
  )
}
console.log("\n── Разные базы и разный вес ──")
for (const row of basesBlock.rows) {
  if (!row.hasPlan) {
    console.log(`  ${row.base} / ${row.capacityKg} кг: маршрута нет`)
    continue
  }
  console.log(
    `  ${row.base} / ${String(row.capacityKg).padStart(5)} кг: ${row.model === "consolidated" ? "сборный" : "последовательный"}, ` +
      `плеч ${row.legs}, ${row.totalKm} км (порожним ${row.emptyShare} %), ${row.drivingHours} ч движ. ` +
      `из ${row.calendarHours} ч календарных, остаток ${row.netRub} ₽, ` +
      `${row.crossTimeZones ? "смена часового пояса, " : ""}` +
      `оптимум ${row.exact ? "доказан" : "не доказан"}, ${row.valid ? "валидно" : "НАРУШЕНИЯ"}`,
  )
}
console.log(
  `  баз с маршрутом: ${basesBlock.basesCovered} из ${new Set(basesBlock.rows.map((row) => row.base)).size}, ` +
    (basesBlock.problems.length === 0 ? "нарушений нет" : `нарушений ${basesBlock.problems.length}: ${basesBlock.problems[0]}`),
)

console.log("\n── Изоляция ──")
console.log(JSON.stringify(isolationBlock, null, 2))
console.log("\nОтчёт: audit/routing-quality.json")
