// tests/consolidated-fixtures.mjs
//
// Независимый эталон ДЛЯ СБОРНОЙ МОДЕЛИ (модель Б) и генератор задач, на
// которых сборка вообще имеет смысл.
//
// Зачем отдельный файл. Прежний аудит сборки сравнивал ядро с самим собой на
// задачах, где сборка невозможна: в случайных задачах грузы весят 2–18 т при
// кузове 20 т, поэтому два груза вместе не влезают, и «улучшила 1 задачу из
// 40» ничего не говорило о модели Б. Здесь:
//
//   · генератор делает пул из НЕБОЛЬШИХ грузов (1–6 т) в соседних городах —
//     ровно та ситуация, для которой сборка придумана;
//   · `bruteConsolidated` перебирает ВСЕ допустимые порядки погрузок и выгрузок
//     (с масками «погружен/выгружен» и проверкой массы и объёма на каждом
//     участке) и считает деньги своей арифметикой — без вызовов ядра.
//
// Если бы эталон вызывал код ядра, он повторял бы его ошибки. Здесь общее
// только данные городов.

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
export const R = require("../.test-build/lib/routing/index.js")

/**
 * Сетка городов «коридора»: близкие города европейской части плюс два
 * удалённых — чтобы сборка иногда была невыгодна, а не всегда выигрывала.
 */
export const CITIES = [
  { city: "Ярославль", lat: 57.6261, lng: 39.8845, region: "Ярославская область" },
  { city: "Кострома", lat: 57.7665, lng: 40.9269, region: "Костромская область" },
  { city: "Иваново", lat: 57.0004, lng: 40.9739, region: "Ивановская область" },
  { city: "Владимир", lat: 56.129, lng: 40.4071, region: "Владимирская область" },
  { city: "Москва", lat: 55.7558, lng: 37.6173, region: "Москва" },
  { city: "Тула", lat: 54.1961, lng: 37.6182, region: "Тульская область" },
  { city: "Рязань", lat: 54.6269, lng: 39.6916, region: "Рязанская область" },
  { city: "Нижний Новгород", lat: 56.3269, lng: 44.0059, region: "Нижегородская область" },
  { city: "Краснодар", lat: 45.0355, lng: 38.9753, region: "Краснодарский край" },
  { city: "Екатеринбург", lat: 56.8389, lng: 60.6057, region: "Свердловская область" },
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

export function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Задача на сборку.
 *
 * Три вида задач, и все три нужны:
 *
 *   `same-origin` — несколько грузов грузятся в ОДНОМ городе и едут в разные
 *       стороны одного направления. Это настоящая сборка: один подъезд к
 *       складу обслуживает три-четыре груза, и вместо трёх поездок туда-обратно
 *       машина делает одну. Здесь сборная модель обязана выигрывать.
 *   `corridor` — погрузки в соседних городах, выгрузки дальше по коридору:
 *       сборка возможна, но выигрыш меньше — выгрузка одного груза оказывается
 *       рядом с погрузкой следующего.
 *   `scattered` — города вразброс, по всей стране: сборка должна НЕ выигрывать.
 *       Если ядро находит тут выгоду — оно её придумывает.
 */
export function makeConsolidatedCase(seed, kind = "corridor") {
  const random = mulberry32(seed)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const count = 3 + Math.floor(random() * 3) // 3–5 грузов
  const orders = []

  const makeOrder = (index, from, to) => ({
    id: `c${index + 1}`,
    organisationId: "org-1",
    pickup: placeOf(from),
    delivery: placeOf(to),
    weightKg: 1000 + Math.round((random() * 5000) / 500) * 500,
    volumeM3: 4 + Math.round(random() * 10),
    bodyRequired: ["tent"],
    window: { pickup: {}, delivery: {} },
    rate: { amount: 18000 + Math.round((random() * 40000) / 1000) * 1000, vatIncluded: true },
    exchangeKm: null,
  })

  if (kind === "same-origin") {
    const origins = ["Ярославль", "Москва"]
    const origin = pick(origins)
    const destinations = ["Кострома", "Иваново", "Владимир", "Тула", "Рязань", "Нижний Новгород"]
    const used = new Set()
    let guard = 0
    while (orders.length < count && guard++ < 100) {
      const to = pick(destinations)
      if (used.has(to)) continue
      used.add(to)
      orders.push(makeOrder(orders.length, origin, to))
    }
    // Половина грузов — со второго склада рядом: подъезд между складами тоже
    // часть сборки.
    if (orders.length >= 3) {
      const extra = makeOrder(orders.length, "Москва", pick(destinations.filter((city) => city !== "Москва")))
      orders.push(extra)
    }
  } else if (kind === "corridor") {
    const chain = ["Ярославль", "Кострома", "Иваново", "Владимир", "Москва", "Тула", "Рязань"]
    const start = Math.floor(random() * 3)
    for (let index = 0; index < count; index += 1) {
      // Соседние грузы часто грузятся в одном городе — так и бывает на бирже.
      const from = chain[Math.min(chain.length - 2, start + index - (index > 0 && random() < 0.5 ? 1 : 0))]
      const to = chain[Math.min(chain.length - 1, start + index + 1)]
      orders.push(makeOrder(index, from, to))
    }
  } else {
    const used = new Set()
    let guard = 0
    while (orders.length < count && guard++ < 100) {
      const from = pick(CITIES).city
      const to = pick(CITIES).city
      if (from === to) continue
      const key = `${from}-${to}`
      if (used.has(key)) continue
      used.add(key)
      orders.push(makeOrder(orders.length, from, to))
    }
  }

  const tile = {
    orders,
    vehicle: {
      id: "v1",
      organisationId: "org-1",
      plate: "СБОРКА",
      homeBase: placeOf("Ярославль"),
      capacityKg: 20000,
      capacityM3: 86,
      body: ["tent"],
      consumptionLPer100: 28,
      consumptionEstimated: false,
      cost: {
        fuelPricePerL: 70,
        driverPay: { kind: "perShift", perShift: 9000 },
        maintenancePerKm: 6,
        tiresPerKm: 2,
        tollsPerKm: 0,
        otherPerKm: 2,
        fixedPerDay: 0,
      },
      status: "available",
    },
    settings: {
      ...R.DEFAULT_SETTINGS,
      // Календарь в этой сверке нейтрализован нарочно: предмет проверки —
      // качество поиска порядков и экономика, а не отдых и часы склада
      // (они проверяются отдельными сценариями).
      maxRouteHours: 100_000,
      drivingLimitHours: 100_000,
      restHours: 0,
      openingHour: 0,
      preparationHours: 0,
      startRadiusKm: 100_000,
      detourBaseKm: 200,
      consolidationEnabled: true,
      maxConcurrentOrders: 4,
      maxLegs: 6,
      ranking: "profit",
    },
  }
  return tile
}

// ---------------------------------------------------------------------------
// Независимый эталон
// ---------------------------------------------------------------------------

/** Расстояние по прямой, км — своя формула, не из ядра. */
function straightKm(a, b) {
  const R0 = 6371
  const rad = (deg) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(rad(a.lat)) * Math.cos(rad(b.lat))
  return 2 * R0 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Дорожные километры: прямая × 1,2 — то же допущение, что у ядра без OSRM. */
function roadKm(a, b) {
  return Math.round(straightKm(a.point, b.point) * 1.2)
}

/**
 * Полный перебор порядков погрузок и выгрузок.
 *
 * Возвращает лучший результат по НЕЗАВИСИМОЙ арифметике:
 *   · масса и объём в кузове проверяются на каждом участке;
 *   · выгрузка возможна только после погрузки (маски, как в ядре, но код свой);
 *   · каждый участок считается по массе, которая РЕАЛЬНО едет в этот момент;
 *   · деньги: выручка − топливо − износ − шины − прочее − оплата водителя;
 *   · возврат на базу входит в пробег и в деньги (сравнение с netCommittedRub).
 *
 * Сравнивать с ядром надо по деньгам С ВОЗВРАТОМ: иначе «уехать и не
 * вернуться» всегда выигрывает на цену возврата.
 */
export function bruteConsolidated({ orders, vehicle, settings }) {
  const cost = vehicle.cost
  const perKmFixed = cost.maintenancePerKm + cost.tiresPerKm + cost.tollsPerKm + cost.otherPerKm

  /** Стоимость участка с учётом фактической загрузки на нём. */
  const legCost = (km, weightKg) => {
    const base = vehicle.consumptionLPer100 ?? 0
    const ratio = vehicle.capacityKg > 0 ? Math.min(1, (weightKg ?? 0) / vehicle.capacityKg) : 0
    const liters = (km / 100) * base * (1 + 0.15 * ratio)
    return liters * cost.fuelPricePerL + km * perKmFixed
  }

  const driverCost = (km) => {
    const rule = cost.driverPay
    if (rule.kind === "perShift") return rule.perShift // календарь нейтрализован: одна смена
    if (rule.kind === "perKm") return rule.perKm * km
    if (rule.kind === "perHour") return rule.perHour * Math.max(1, km / 55)
    if (rule.kind === "perTrip") return rule.perTrip
    if (rule.kind === "mixed") return rule.basePerShift + rule.perKm * km
    return 0
  }

  const base = vehicle.homeBase
  const n = orders.length
  // Сколько грузов разрешено держать в кузове одновременно — настройка
  // организации, а не следствие массы. Эталон обязан её соблюдать, иначе он
  // «находит» решения, которые ядро справедливо запрещает.
  const maxConcurrent = Math.max(1, settings.maxConcurrentOrders ?? 3)
  // Сколько заказов вообще можно взять в один рейс. Это НЕ «сколько едет
  // одновременно»: одновременность проверяется ёмкостью кузова на каждом
  // участке. Поэтому предел набора — maxLegs (последовательная цепочка тоже
  // вариант), а сборка получается сама, когда масса позволяет ехать вместе.
  const limit = Math.min(settings.maxLegs ?? 8, 6)
  let best = null

  const walk = (state) => {
    const { loaded, delivered, place, km, kg, money, revenue, loadedKm } = state
    if (delivered === state.used) {
      const backKm = roadKm(place, base)
      const totalKm = km + backKm
      const net = revenue - money - legCost(backKm, 0) - driverCost(totalKm)
      if (!best || net > best.net) {
        best = {
          net,
          km: totalKm,
          loadedKm,
          emptyKm: totalKm - loadedKm,
          orders: state.orderIds,
        }
      }
      return
    }

    for (let i = 0; i < n; i += 1) {
      if (!(state.used & (1 << i))) continue
      const order = orders[i]
      const bit = 1 << i
      const canLoad = !(loaded & bit)
      const canUnload = Boolean(loaded & bit) && !(delivered & bit)

      if (canLoad) {
        const weightAfter = kg + (order.weightKg ?? 0)
        const volumeAfter = state.m3 + (order.volumeM3 ?? 0)
        if (state.count + 1 > maxConcurrent) continue
        // Проверка «на участке не больше вместимости»: и сейчас, и после.
        if (weightAfter <= vehicle.capacityKg + 1e-6 && volumeAfter <= vehicle.capacityM3 + 1e-6) {
          const leg = roadKm(place, order.pickup)
          walk({
            ...state,
            loaded: loaded | bit,
            count: state.count + 1,
            place: order.pickup,
            km: km + leg,
            kg: weightAfter,
            m3: volumeAfter,
            money: money + legCost(leg, kg),
          })
        }
      }
      if (canUnload) {
        const leg = roadKm(place, order.delivery)
        walk({
          ...state,
          delivered: delivered | bit,
          count: state.count - 1,
          place: order.delivery,
          km: km + leg,
          kg: kg - (order.weightKg ?? 0),
          m3: state.m3 - (order.volumeM3 ?? 0),
          money: money + legCost(leg, kg),
          revenue: revenue + order.rate.amount,
          loadedKm: loadedKm + leg,
        })
      }
    }
  }

  // Перебираем наборы заказов: ядро тоже ищет набор, а не только порядок.
  for (let mask = 1; mask < 1 << n; mask += 1) {
    const picked = []
    for (let i = 0; i < n; i += 1) if (mask & (1 << i)) picked.push(i)
    if (picked.length > limit) continue
    // Сумма по набору НЕ проверяется — это был тот же дефект D1, что и в
    // сборщике: два груза по 4 т в 5-тонник по сумме не проходят, а рейс
    // исполнимо (взял первый, выгрузил, взял второй). Важно, сколько едет на
    // КАЖДОМ участке, — это и проверяет walk() ниже. Эталон приёмки
    // (acceptance/ref.mjs) устроен так же; здесь отсечение по сумме осталось
    // по недосмотру и мешало видеть решения, которые сборщик находит законно.
    walk({
      used: mask,
      loaded: 0,
      delivered: 0,
      place: base,
      km: 0,
      kg: 0,
      m3: 0,
      money: 0,
      revenue: 0,
      loadedKm: 0,
      count: 0,
      orderIds: picked.map((i) => orders[i].id),
    })
  }

  return best
}

/**
 * Независимый перебор ТОЛЬКО последовательных цепочек (модель А): в кузове
 * никогда не больше одного груза.
 *
 * Нужен, чтобы сравнение «сборная против последовательной» не опиралось на
 * ядро: иначе выигрыш сборки мог оказаться выигрышем над плохим оппонентом.
 */
export function bruteSequential({ orders, vehicle, settings }) {
  const n = orders.length
  const limit = Math.min(settings.maxLegs ?? 8, 6)
  const base = vehicle.homeBase
  const cost = vehicle.cost
  const perKmFixed = cost.maintenancePerKm + cost.tiresPerKm + cost.tollsPerKm + cost.otherPerKm
  const legCost = (km, weightKg) => {
    const baseConsumption = vehicle.consumptionLPer100 ?? 0
    const ratio = vehicle.capacityKg > 0 ? Math.min(1, (weightKg ?? 0) / vehicle.capacityKg) : 0
    return ((km / 100) * baseConsumption * (1 + 0.15 * ratio)) * cost.fuelPricePerL + km * perKmFixed
  }
  const driverCost = (km) => {
    const rule = cost.driverPay
    if (rule.kind === "perShift") return rule.perShift
    if (rule.kind === "perKm") return rule.perKm * km
    if (rule.kind === "perHour") return rule.perHour * Math.max(1, km / 55)
    if (rule.kind === "perTrip") return rule.perTrip
    if (rule.kind === "mixed") return rule.basePerShift + rule.perKm * km
    return 0
  }

  let best = null
  const walk = (state) => {
    if (state.done) {
      const backKm = roadKm(state.place, base)
      const totalKm = state.km + backKm
      const net =
        state.revenue - state.money - legCost(backKm, 0) - driverCost(totalKm)
      if (!best || net > best.net) {
        best = {
          net,
          km: totalKm,
          loadedKm: state.loadedKm,
          emptyKm: totalKm - state.loadedKm,
          orders: state.orderIds,
        }
      }
      if (state.left.length === 0) return
    }
    if (state.left.length === 0) return
    for (let index = 0; index < state.left.length; index += 1) {
      const order = state.left[index]
      const rest = state.left.filter((_, i) => i !== index)
      // Порожний подъезд, затем гружёное плечо — по одному грузу за раз.
      const toPickup = roadKm(state.place, order.pickup)
      const loaded = roadKm(order.pickup, order.delivery)
      walk({
        left: rest,
        place: order.delivery,
        km: state.km + toPickup + loaded,
        money: state.money + legCost(toPickup, 0) + legCost(loaded, order.weightKg ?? 0),
        revenue: state.revenue + order.rate.amount,
        loadedKm: state.loadedKm + loaded,
        orderIds: [...state.orderIds, order.id],
        done: true,
      })
    }
  }
  walk({ left: orders.slice(0, Math.min(orders.length, limit)), place: base, km: 0, money: 0, revenue: 0, loadedKm: 0, orderIds: [], done: false })
  return best
}
