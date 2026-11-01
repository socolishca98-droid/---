// tests/routing-fixtures.mjs
//
// Общие данные и НЕЗАВИСИМЫЕ эталонные расчёты для сверки ядра.
//
// Здесь нет ни одного импорта из lib/routing, кроме самого ядра в тестах:
// перебор подмножеств, арифметика времени, отдыха, окон и денег написаны
// заново. Если бы эталон вызывал код ядра, он повторял бы его ошибки.

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
export const R = require("../.test-build/lib/routing/index.js")



// ── Детерминированный генератор ─────────────────────────────────────────────
export function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Сетка городов — данные генератора. Ядро о них не знает.
export const CITIES = [
  { city: "Ярославль", lat: 57.6261, lng: 39.8845, region: "Ярославская область" },
  { city: "Москва", lat: 55.7558, lng: 37.6173, region: "Москва" },
  { city: "Тула", lat: 54.1961, lng: 37.6182, region: "Тульская область" },
  { city: "Брянск", lat: 53.2434, lng: 34.3639, region: "Брянская область" },
  { city: "Воронеж", lat: 51.672, lng: 39.1843, region: "Воронежская область" },
  { city: "Казань", lat: 55.7963, lng: 49.1088, region: "Татарстан" },
  { city: "Кострома", lat: 57.7665, lng: 40.9269, region: "Костромская область" },
  { city: "Нижний Новгород", lat: 56.3269, lng: 44.0059, region: "Нижегородская область" },
]

export const REGIONS = [...new Set(CITIES.map((item) => item.region))].map((key) => ({
  key,
  speedLoadedKmh: 55,
  speedEmptyKmh: 60,
  roadFactor: 1.2,
}))

export const placeOf = (city) => {
  const data = CITIES.find((item) => item.city === city)
  return {
    id: city.toLowerCase(),
    city,
    region: data.region,
    point: { lat: data.lat, lng: data.lng },
    timeZone: "Europe/Moscow",
  }
}

export function makeCase(seed) {
  const random = mulberry32(seed)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const ordersCount = 2 + Math.floor(random() * 4) // 2–5 заказов
  const orders = []
  const used = new Set()
  let guard = 0
  while (orders.length < ordersCount && guard++ < 100) {
    const from = pick(CITIES).city
    const to = pick(CITIES).city
    if (from === to) continue
    const key = `${from}-${to}`
    if (used.has(key)) continue
    used.add(key)
    const weight = 2000 + Math.round((random() * 16000) / 500) * 500
    orders.push({
      id: `o${orders.length + 1}`,
      organisationId: "org-1",
      pickup: placeOf(from),
      delivery: placeOf(to),
      weightKg: weight,
      volumeM3: 8 + Math.round(random() * 60),
      bodyRequired: ["tent"],
      window: { pickup: {}, delivery: {} },
      rate: { amount: 20000 + Math.round((random() * 380000) / 1000) * 1000, vatIncluded: true },
      exchangeKm: null,
    })
  }
  const fuelPricePerL = 60 + Math.round(random() * 40)
  const perShift = 4000 + Math.round(random() * 10000)
  const tile = {
    orders,
    vehicle: {
      id: "v1",
      organisationId: "org-1",
      plate: "TEST",
      homeBase: placeOf(pick(CITIES).city),
      capacityKg: 20000,
      capacityM3: 86,
      body: ["tent"],
      consumptionLPer100: 26 + Math.round(random() * 12),
      consumptionEstimated: false,
      cost: {
        fuelPricePerL,
        driverPay: { kind: "perShift", perShift },
        maintenancePerKm: 4 + Math.round(random() * 10),
        tiresPerKm: 1 + Math.round(random() * 3),
        tollsPerKm: 0,
        otherPerKm: 1 + Math.round(random() * 3),
        fixedPerDay: 0,
      },
      status: "available",
    },
    settings: {
      ...R.DEFAULT_SETTINGS,
      // Календарь в этой сверке нейтрализован: отдых, часы работы склада и
      // лимит рейса проверяются отдельными сценариями (S4, G3, G5). Здесь
      // предмет проверки — качество поиска цепочки, поэтому оба расчёта
      // работают на одной и той же простой временной модели.
      maxRouteHours: 100_000,
      drivingLimitHours: 100_000,
      restHours: 0,
      openingHour: 0,
      preparationHours: 0,
      startRadiusKm: 100_000,
      consolidationEnabled: false,
      ranking: "profit",
    },
  }
  return tile
}

/** Независимый перебор: своя арифметика времени и денег. */
export function bruteForce({ orders, vehicle, settings }) {
  const { cost } = vehicle
  const region = REGIONS[0]
  const straight = (a, b) => {
    const R0 = 6371
    const toRad = (deg) => (deg * Math.PI) / 180
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat))
    return Math.round(2 * R0 * Math.asin(Math.min(1, Math.sqrt(h))) * region.roadFactor)
  }
  const kmOf = (a, b) => (a.id === b.id ? 0 : straight(a.point, b.point))
  const litres = (km, kg) =>
    (km / 100) * vehicle.consumptionLPer100 * (1 + 0.15 * Math.min(1, (kg ?? 0) / vehicle.capacityKg))
  const handling = (kg) =>
    Math.max(settings.minHandlingHours, ((kg ?? 0) / 1000) * settings.handlingHoursPerTon)
  const perKmCost =
    cost.maintenancePerKm + cost.tiresPerKm + cost.tollsPerKm + cost.otherPerKm

  const evaluate = (sequence) => {
    let clock = settings.preparationHours
    let where = vehicle.homeBase
    let km = 0
    let fuel = 0
    let revenue = 0
    let driving = 0
    for (const order of sequence) {
      const dead = kmOf(where, order.pickup)
      clock += dead / region.speedEmptyKmh
      driving += dead / region.speedEmptyKmh
      km += dead
      fuel += litres(dead, null)
      clock += handling(order.weightKg)
      const loaded = kmOf(order.pickup, order.delivery)
      clock += loaded / region.speedLoadedKmh
      driving += loaded / region.speedLoadedKmh
      km += loaded
      fuel += litres(loaded, order.weightKg)
      clock += handling(order.weightKg)
      revenue += order.rate.amount
      where = order.delivery
    }
    if (where.id !== vehicle.homeBase.id) {
      const back = kmOf(where, vehicle.homeBase)
      clock += back / region.speedEmptyKmh
      driving += back / region.speedEmptyKmh
      km += back
      fuel += litres(back, null)
    }
    if (clock > settings.maxRouteHours + 1e-6) return null
    const shifts = Math.max(1, Math.ceil(driving / settings.drivingLimitHours))
    const driver = cost.driverPay.perShift * shifts
    return {
      net: Math.round(revenue - fuel * cost.fuelPricePerL - perKmCost * km - driver),
      km: Math.round(km),
      seq: sequence.map((order) => order.id),
    }
  }

  const permutations = (list) =>
    list.length <= 1
      ? [list]
      : list.flatMap((item, index) =>
          permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [
            item,
            ...rest,
          ]),
        )

  let best = null
  for (let mask = 1; mask < 1 << orders.length; mask += 1) {
    const subset = orders.filter((_, index) => mask & (1 << index))
    for (const permutation of permutations(subset)) {
      const result = evaluate(permutation)
      if (result && (!best || result.net > best.net)) best = result
    }
  }
  return best
}

export function tzOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"))
  return Math.round((asUtc - date.getTime()) / 60000)
}

/** Начало работы точки: не раньше окна и не раньше открытия (местное время). */
export function openAt(arrivalMs, place, windowFrom, openingHour) {
  let start = arrivalMs
  if (windowFrom) {
    const from = new Date(windowFrom).getTime()
    if (Number.isFinite(from) && from > start) start = from
  }
  for (let guard = 0; guard < 10; guard += 1) {
    const offset = tzOffsetMinutes(new Date(start), place.timeZone)
    const local = new Date(start + offset * 60000)
    if (local.getUTCHours() >= openingHour) break
    const targetLocal = new Date(local)
    targetLocal.setUTCHours(openingHour, 0, 0, 0)
    if (targetLocal.getTime() < local.getTime()) targetLocal.setUTCDate(targetLocal.getUTCDate() + 1)
    start = targetLocal.getTime() - offset * 60000
  }
  return start
}

/** Движение с обязательным отдыхом: возвращает прибытие и накопленное вождение. */
export function driveClock(startMs, hours, sinceRest, limit, rest) {
  let remaining = hours
  let since = sinceRest
  let clock = startMs
  let guard = 0
  while (remaining > 1e-9 && guard++ < 500) {
    const room = limit - since
    if (remaining <= room + 1e-9) {
      clock += remaining * 3600000
      since += remaining
      remaining = 0
      break
    }
    clock += room * 3600000
    remaining -= room
    clock += rest * 3600000
    since = 0
  }
  return { clock, since }
}

export function bruteCalendar({ orders, vehicle, settings, now }) {
  const { cost } = vehicle
  const region = REGIONS[0]
  const straight = (a, b) => {
    const R0 = 6371
    const toRad = (deg) => (deg * Math.PI) / 180
    const dLat = toRad(b.lat - a.lat)
    const dLng = toRad(b.lng - a.lng)
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat))
    return Math.round(2 * R0 * Math.asin(Math.min(1, Math.sqrt(h))) * region.roadFactor)
  }
  const kmOf = (a, b) => (a.id === b.id ? 0 : straight(a.point, b.point))
  const litres = (km, kg) =>
    (km / 100) * vehicle.consumptionLPer100 * (1 + 0.15 * Math.min(1, (kg ?? 0) / vehicle.capacityKg))
  const handling = (kg) => Math.max(settings.minHandlingHours, ((kg ?? 0) / 1000) * settings.handlingHoursPerTon)
  const perKmCost = cost.maintenancePerKm + cost.tiresPerKm + cost.tollsPerKm + cost.otherPerKm
  const depart = now.getTime() + settings.preparationHours * 3600000

  const evaluate = (sequence) => {
    let clock = depart
    let since = 0
    let driving = 0
    let where = vehicle.homeBase
    let km = 0
    let fuel = 0
    let revenue = 0
    for (const order of sequence) {
      const dead = kmOf(where, order.pickup)
      let run = driveClock(clock, dead / region.speedEmptyKmh, since, settings.drivingLimitHours, settings.restHours)
      driving += dead / region.speedEmptyKmh
      since = run.since
      km += dead
      fuel += litres(dead, null)
      const loadAt = openAt(run.clock, order.pickup, order.window?.pickup?.from ?? null, settings.openingHour)
      clock = loadAt + handling(order.weightKg) * 3600000
      const loaded = kmOf(order.pickup, order.delivery)
      run = driveClock(clock, loaded / region.speedLoadedKmh, since, settings.drivingLimitHours, settings.restHours)
      driving += loaded / region.speedLoadedKmh
      since = run.since
      km += loaded
      fuel += litres(loaded, order.weightKg)
      const unloadAt = openAt(run.clock, order.delivery, order.window?.delivery?.from ?? null, settings.openingHour)
      clock = unloadAt + handling(order.weightKg) * 3600000
      revenue += order.rate.amount
      where = order.delivery
    }
    if (where.id !== vehicle.homeBase.id) {
      const back = kmOf(where, vehicle.homeBase)
      const run = driveClock(clock, back / region.speedEmptyKmh, since, settings.drivingLimitHours, settings.restHours)
      driving += back / region.speedEmptyKmh
      clock = run.clock
      km += back
      fuel += litres(back, null)
    }
    if ((clock - depart) / 3600000 > settings.maxRouteHours + 1e-6) return null
    const shifts = Math.max(1, Math.ceil(driving / settings.drivingLimitHours))
    const driver = cost.driverPay.kind === "perShift" ? cost.driverPay.perShift * shifts : 0
    return {
      net: Math.round(revenue - fuel * cost.fuelPricePerL - perKmCost * km - driver),
      seq: sequence.map((order) => order.id),
    }
  }

  const permutations = (list) =>
    list.length <= 1
      ? [list]
      : list.flatMap((item, index) =>
          permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [item, ...rest]),
        )

  let best = null
  for (let mask = 1; mask < 1 << orders.length; mask += 1) {
    const subset = orders.filter((_, index) => mask & (1 << index))
    for (const permutation of permutations(subset)) {
      const result = evaluate(permutation)
      if (result && (!best || result.net > best.net)) best = result
    }
  }
  return best
}

