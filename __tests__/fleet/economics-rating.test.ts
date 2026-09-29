// __tests__/fleet/economics-rating.test.ts
//
// Экономика рейса и рейтинг водителя: математика без скрытых допущений.

import { describe, expect, it } from "vitest"
import {
  fuelPriceRubPerL,
  legEconomics,
  routeEconomics,
} from "@/lib/routes/economics"
import { driverRating, gradeByScore, share } from "@/lib/drivers/rating"

describe("цена литра и экономика рейса", () => {
  it("цена литра — сумма к литрам топливных чеков", () => {
    expect(
      fuelPriceRubPerL([
        { type: "fuel", amount: 3000, liters: 60 },
        { type: "fuel", amount: 2600, liters: 40 },
        { type: "toll", amount: 500, liters: null },
      ]),
    ).toBe(56)
    expect(fuelPriceRubPerL([{ type: "fuel", amount: 3000, liters: null }])).toBeNull()
  })

  it("по расходам рейс прибыльный, а без чеков считается оценка", () => {
    const fact = routeEconomics({
      revenueRub: 45000,
      distanceKm: 300,
      factCostRub: 30000,
      estimatedLiters: 100,
      fuelPriceRubPerL: 56,
    })
    expect(fact.basis).toBe("fact")
    expect(fact.profitRub).toBe(15000)
    expect(fact.rubPerKmRevenue).toBe(150)
    expect(fact.costPerKm).toBe(100)
    expect(fact.unprofitable).toBe(false)

    const estimate = routeEconomics({
      revenueRub: 5000,
      distanceKm: 300,
      factCostRub: null,
      estimatedLiters: 100,
      fuelPriceRubPerL: 56,
    })
    expect(estimate.basis).toBe("estimate")
    expect(estimate.unprofitable).toBe(true)
  })

  it("без цены литра и расходов экономики нет, а не «ноль»", () => {
    const none = routeEconomics({
      revenueRub: 10000,
      distanceKm: 100,
      factCostRub: null,
      estimatedLiters: 40,
      fuelPriceRubPerL: null,
    })
    expect(none.basis).toBeNull()
    expect(none.profitRub).toBeNull()
    expect(none.unprofitable).toBe(false)
  })

  it("плечо убыточно, когда топливо дороже цены заказа", () => {
    const leg = legEconomics({
      priceRub: 3000,
      distanceKm: 300,
      consumptionPer100: 25,
      loadKg: 10000,
      capacityKg: 10000,
      fuelPriceRubPerL: 56,
    })
    // 300 км × 25 л × 1.25 загрузки × 56 ₽ = 52 500 ₽ топлива против 3 000 ₽ цены
    expect(leg?.unprofitable).toBe(true)
    expect(
      legEconomics({
        priceRub: null,
        distanceKm: 100,
        consumptionPer100: 25,
        loadKg: 0,
        capacityKg: 10000,
        fuelPriceRubPerL: 56,
      }),
    ).toBeNull()
  })
})

describe("рейтинг водителя", () => {
  it("доли считаются и ограничиваются единицей", () => {
    expect(share(3, 4)).toBe(0.75)
    expect(share(9, 4)).toBe(1)
    expect(share(1, 0)).toBeNull()
  })

  it("итог — взвешенная сумма пунктуальности и документов", () => {
    const rating = driverRating({ deliveredTotal: 10, deliveredOnTime: 9, deliveredWithDocs: 8 })
    expect(rating?.onTime).toBe(0.9)
    expect(rating?.docs).toBe(0.8)
    expect(rating?.score).toBe(Math.round((0.6 * 0.9 + 0.4 * 0.8) * 100))
    expect(rating?.grade).toBe("хорошо")
  })

  it("без доставок рейтинга нет", () => {
    expect(driverRating({ deliveredTotal: 0, deliveredOnTime: 0, deliveredWithDocs: 0 })).toBeNull()
  })

  it("градации честные", () => {
    expect(gradeByScore(95)).toBe("отлично")
    expect(gradeByScore(80)).toBe("хорошо")
    expect(gradeByScore(60)).toBe("удовлетворительно")
    expect(gradeByScore(30)).toBe("требует внимания")
  })
})
