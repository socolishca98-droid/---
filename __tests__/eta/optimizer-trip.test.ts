import { describe, expect, it } from "vitest"

import { calculateOptimizerTrip } from "@/lib/routes/optimizer-trip"

const DEPARTURE = new Date(Date.UTC(2026, 9, 15, 6, 0, 0))

const MOSCOW = { lat: 55.7558, lng: 37.6173 }
const TULA = { lat: 54.1961, lng: 37.6186 }
const RYAZAN = { lat: 54.6297, lng: 39.7415 }
const ORYOL = { lat: 52.9654, lng: 36.0785 }

function order(
  id: string,
  from: typeof MOSCOW,
  to: typeof MOSCOW,
  extra: Partial<{ distance: number; deadline: Date | null }> = {},
) {
  return {
    id,
    routeFrom: "откуда",
    routeTo: "куда",
    from,
    to,
    distance: extra.distance ?? null,
    deadline: extra.deadline ?? null,
  }
}

const BASE = { point: MOSCOW, address: "Москва, база" }

describe("1. Оптимизатор считает рейс единым движком", () => {
  it("время рейса = движение + операции + перерывы", () => {
    const result = calculateOptimizerTrip({
      orders: [order("o1", MOSCOW, TULA, { distance: 180 })],
      base: BASE,
      departure: DEPARTURE,
    })

    expect(result.etaMin).toBe(result.baseMin + result.stopsMin + result.restMin)
  })

  it("операции не ноль: у заказа есть погрузка и выгрузка", () => {
    const result = calculateOptimizerTrip({
      orders: [order("o1", MOSCOW, TULA, { distance: 180 })],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(result.stopsMin).toBeGreaterThan(0)
  })

  it("обязательный перерыв попадает в длинный рейс", () => {
    // База → Тула → Рязань → Орёл: движения многовато для 270 минут
    const result = calculateOptimizerTrip({
      orders: [
        order("o1", MOSCOW, TULA, { distance: 180 }),
        order("o2", TULA, RYAZAN, { distance: 300 }),
        order("o3", RYAZAN, ORYOL, { distance: 400 }),
      ],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(result.baseMin).toBeGreaterThan(270)
    expect(result.restMin).toBeGreaterThan(0)
  })

  it("возврат на базу считается отдельным плечом", () => {
    const result = calculateOptimizerTrip({
      orders: [order("o1", MOSCOW, TULA, { distance: 180 })],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(result.returnToBase).toBe(true)
    const returnStage = result.stages.find((stage) => stage.kind === "return_to_base")
    expect(returnStage).toBeDefined()
    expect(returnStage!.distanceKm).toBeGreaterThan(0)
  })

  it("без базы возврат на базу не считается, и это видно в результате", () => {
    const result = calculateOptimizerTrip({
      orders: [order("o1", MOSCOW, TULA, { distance: 180 })],
      base: null,
      departure: DEPARTURE,
    })
    expect(result.returnToBase).toBe(false)
  })

  it("порядок точек меняет результат: другой порядок — другой пробег", () => {
    // База в Москве, заказы из разных городов: порядок объезда меняет
    // суммарный пробег, и оптимизатор обязан это видеть
    const orders = [
      order("o1", TULA, ORYOL, { distance: 380 }),
      order("o2", ORYOL, MOSCOW, { distance: 380 }),
    ]
    const first = calculateOptimizerTrip({ orders, base: BASE, departure: DEPARTURE })
    const second = calculateOptimizerTrip({
      orders: [orders[1], orders[0]],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(first.distanceKm).not.toBe(second.distanceKm)
  })
})

describe("2. Сроки заказов", () => {
  it("нарушенный срок попадает в нарушения", () => {
    const result = calculateOptimizerTrip({
      orders: [
        order("o1", MOSCOW, ORYOL, {
          distance: 380,
          deadline: new Date(DEPARTURE.getTime() + 30 * 60_000),
        }),
      ],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(result.deadlineViolations).toHaveLength(1)
    expect(result.deadlineViolations[0].orderId).toBe("o1")
  })

  it("срок с запасом не считается нарушением", () => {
    const result = calculateOptimizerTrip({
      orders: [
        order("o1", MOSCOW, TULA, {
          distance: 180,
          deadline: new Date(DEPARTURE.getTime() + 48 * 3600_000),
        }),
      ],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(result.deadlineViolations).toEqual([])
  })

  it("несколько заказов: нарушение только у того, чей срок не выдержан", () => {
    const result = calculateOptimizerTrip({
      orders: [
        order("o1", MOSCOW, TULA, {
          distance: 180,
          deadline: new Date(DEPARTURE.getTime() + 48 * 3600_000),
        }),
        order("o2", TULA, ORYOL, {
          distance: 400,
          deadline: new Date(DEPARTURE.getTime() + 20 * 60_000),
        }),
      ],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(result.deadlineViolations.map((item) => item.orderId)).toEqual(["o2"])
  })
})

describe("3. Стоимость и качество данных", () => {
  it("топливо и платные дороги считаются от пробега", () => {
    const short = calculateOptimizerTrip({
      orders: [order("o1", MOSCOW, TULA, { distance: 180 })],
      base: BASE,
      departure: DEPARTURE,
    })
    const long = calculateOptimizerTrip({
      orders: [order("o1", MOSCOW, ORYOL, { distance: 380 })],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(long.cost.fuel).toBeGreaterThan(short.cost.fuel)
    // Платные дороги только на длинных рейсах — та же модель, что и раньше
    expect(long.cost.tolls).toBeGreaterThan(0)
  })

  it("плечо без расстояния честно помечается оценённым", () => {
    const result = calculateOptimizerTrip({
      orders: [order("o1", MOSCOW, TULA)],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(result.estimatedLegs).toBeGreaterThan(0)
  })

  it("погода не выдумывается: источник недоступен", () => {
    const result = calculateOptimizerTrip({
      orders: [order("o1", MOSCOW, TULA, { distance: 180 })],
      base: BASE,
      departure: DEPARTURE,
    })
    expect(result.trip.sources.weather).toBe("unavailable")
    expect(result.trip.dataQuality.weatherAvailable).toBe(false)
  })

  it("шкала этапов содержит погрузку, движение и выгрузку по порядку", () => {
    const result = calculateOptimizerTrip({
      orders: [order("o1", MOSCOW, TULA, { distance: 180 })],
      base: BASE,
      departure: DEPARTURE,
    })
    // База и точка погрузки совпадают (Москва), поэтому плечо до склада
    // не создаётся — нулевые перегоны шкала не строит
    expect(result.stages.map((stage) => stage.kind)).toEqual([
      "loading",
      "driving", // Москва → Тула
      "unloading",
      "return_to_base",
    ])
  })
})
