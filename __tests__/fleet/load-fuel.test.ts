// __tests__/fleet/load-fuel.test.ts
//
// Загрузка машины и оценочное топливо: математика догруза и расхода.

import { describe, expect, it } from "vitest"
import {
  ACTIVE_LOAD_STATUSES,
  activeLoadKg,
  formatKg,
  loadRatio,
  overloadKg,
} from "@/lib/fleet/load"
import {
  estimateFuelL,
  fuelAfterRefuel,
  fuelAfterRoute,
  fuelShortfallL,
  loadFactor,
} from "@/lib/fleet/fuel"

describe("загрузка машины", () => {
  it("считает только активные заказы", () => {
    const kg = activeLoadKg([
      { weight: 5000, status: "in_route" },
      { weight: 3000, status: "agreed" },
      { weight: 9000, status: "search" },
      { weight: 1000, status: "cancelled" },
      { weight: null, status: "in_route" },
    ])
    expect(kg).toBe(8000)
  })

  it("догруженная машина показывает перегруз, а не запас", () => {
    const vehicle = { capacity: 10000 }
    expect(overloadKg(vehicle, 8000, 1500)).toBe(-500)
    expect(overloadKg(vehicle, 8000, 2500)).toBe(500)
    expect(loadRatio(vehicle, 8000)).toBeCloseTo(0.8)
  })

  it("без грузоподъёмности перегруз не заявляем", () => {
    expect(overloadKg({ capacity: null }, 1000, 1000)).toBeNull()
    expect(loadRatio({ capacity: 0 }, 1000)).toBeNull()
  })

  it("килограммы читаются человеком", () => {
    expect(formatKg(900)).toBe("900 кг")
    expect(formatKg(12400)).toContain("12,4")
  })

  it("список активных статусов не пуст и содержит рейс", () => {
    expect(ACTIVE_LOAD_STATUSES).toContain("in_route")
  })
})

describe("оценочное топливо", () => {
  const truck = {
    fuelTankL: 200,
    fuelConsumptionPer100: 25,
    fuelLevelL: 100,
    capacity: 10000,
  }

  it("груженая машина ест больше пустой", () => {
    const empty = estimateFuelL(truck, 100, 0)
    const full = estimateFuelL(truck, 100, 10000)
    expect(empty).toBeCloseTo(25)
    expect(full).toBeCloseTo(25 * 1.25)
    expect(loadFactor(truck, 5000)).toBeCloseTo(1.125)
  })

  it("половинная загрузка даёт половинную надбавку", () => {
    expect(estimateFuelL(truck, 200, 5000)).toBeCloseTo(50 * 1.125)
  })
})

describe("остаток и заправка", () => {
  const truck = {
    fuelTankL: 200,
    fuelConsumptionPer100: 25,
    fuelLevelL: 30,
    capacity: 10000,
  }

  it("остаток после рейса не уходит в минус", () => {
    expect(fuelAfterRoute(truck, 80)).toBe(0)
    expect(fuelAfterRoute(truck, 10)).toBe(20)
  })

  it("заправка до горловины и частичная", () => {
    expect(fuelAfterRefuel(truck, null)).toBe(200)
    expect(fuelAfterRefuel(truck, 50)).toBe(80)
    expect(fuelAfterRefuel({ ...truck, fuelLevelL: 190 }, 50)).toBe(200)
  })

  it("нехватка топлива видна заранее", () => {
    expect(fuelShortfallL(truck, 120)).toBe(90)
    expect(fuelShortfallL(truck, 20)).toBe(0)
    expect(fuelShortfallL({ ...truck, fuelLevelL: null }, 20)).toBeNull()
  })

  it("без настроек топлива оценок нет", () => {
    expect(estimateFuelL({}, 100, 1000)).toBeNull()
    expect(fuelAfterRoute({}, 10)).toBeNull()
  })
})
