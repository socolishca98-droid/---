// __tests__/routes/backhaul-fuel-audit.test.ts
//
// Порожний обратный пробег с попутными грузами и сверка топлива по чекам.

import { describe, expect, it } from "vitest"
import {
  backhaulCandidates,
  emptyReturnKm,
  isAwayFromBase,
  routeEndpointCity,
  showBackhaulWarning,
} from "@/lib/routes/backhaul"
import {
  FUEL_AUDIT_TOLERANCE_PCT,
  factFuelLiters,
  fuelAuditDiffPct,
  fuelAuditFlag,
} from "@/lib/fleet/fuel-audit"

describe("обратное плечо", () => {
  it("город окончания — последняя точка объезда", () => {
    const city = routeEndpointCity([
      { routeTo: "Москва, склад 1", routeSequence: 1 },
      { routeTo: "Тверь, ул. Мира 5", routeSequence: 3 },
      { routeTo: "Казань", routeSequence: 2 },
    ])
    expect(city).toBe("тверь")
  })

  it("рейс в базу порожним не считается", () => {
    expect(isAwayFromBase("ярославль", "ярославль")).toBe(false)
    expect(isAwayFromBase("москва", "ярославль")).toBe(true)
    expect(isAwayFromBase("", "ярославль")).toBe(false)
  })

  it("порожний пробег считается по прямой с дорожным коэффициентом", () => {
    // Ярославль → Москва примерно 270 км по прямой
    const km = emptyReturnKm({ lat: 57.6261, lng: 39.8847 }, { lat: 55.7558, lng: 37.6173 })
    expect(km).toBeGreaterThan(280)
    expect(km).toBeLessThan(360)
    expect(emptyReturnKm(null, { lat: 55, lng: 37 })).toBeNull()
  })

  it("попутные грузы — только «от конца рейса к базе», дороже сначала", () => {
    const loads = [
      { id: "1", routeFrom: "Москва", routeTo: "Ярославль", distance: 270, weight: 5000, price: 30000, cargoType: "Тент" },
      { id: "2", routeFrom: "Москва", routeTo: "Ярославль", distance: 270, weight: 3000, price: 45000, cargoType: "Сборный" },
      { id: "3", routeFrom: "Ярославль", routeTo: "Москва", distance: 270, weight: 1000, price: 90000, cargoType: "Не тот" },
      { id: "4", routeFrom: "Москва, юг", routeTo: "Тверь", distance: 150, weight: 1000, price: 10000, cargoType: "Мимо" },
    ]
    const found = backhaulCandidates("москва", "ярославль", loads)
    expect(found.map((load) => load.id)).toEqual(["2", "1"])
  })

  it("предупреждение не показывается у своей базы и на коротком плече", () => {
    expect(showBackhaulWarning("москва", "ярославль", 300)).toBe(true)
    expect(showBackhaulWarning("москва", "ярославль", 12)).toBe(false)
    expect(showBackhaulWarning("ярославль", "ярославль", null)).toBe(false)
    // рейс ещё не поехал: точки нет, но город конца не база — предупреждаем
    expect(showBackhaulWarning("москва", "ярославль", null)).toBe(true)
  })
})

describe("сверка топлива", () => {
  it("факт собирается только из топливных чеков с литрами", () => {
    expect(
      factFuelLiters([
        { type: "fuel", liters: 60 },
        { type: "fuel", liters: null },
        { type: "toll", liters: 40 },
        { type: "fuel", liters: 25.5 },
      ]),
    ).toBe(85.5)
    expect(factFuelLiters([{ type: "fuel", liters: null }])).toBeNull()
  })

  it("расхождение знакоправильное", () => {
    expect(fuelAuditDiffPct(110, 100)).toBe(10)
    expect(fuelAuditDiffPct(80, 100)).toBe(-20)
    expect(fuelAuditDiffPct(80, null)).toBeNull()
  })

  it(`флаг ставится вне допуска ${FUEL_AUDIT_TOLERANCE_PCT}% и не ставится на мелочи`, () => {
    expect(fuelAuditFlag(130, 100)).toBe(true)
    expect(fuelAuditFlag(115, 100)).toBe(false)
    expect(fuelAuditFlag(10, 5)).toBe(false)
    expect(fuelAuditFlag(null, 100)).toBe(false)
  })
})
