// Выручка: один набор статусов на всё приложение.
//
// Раньше формула была зашита в /api/dashboard/stats, а /api/drivers/locations
// отдавал `revenue: 0` — сводка карты показывала ноль рублей при живой работе.
// Проверяем, что канон не разъезжается с жизненным циклом заказа.

import { describe, expect, it } from "vitest"

import { REVENUE_ORDER_STATUSES, isRevenueStatus } from "@/lib/orders/revenue"
import { CLOSED_ORDER_STATUSES, OCCUPYING_ORDER_STATUSES } from "@/lib/orders/stages"

describe("REVENUE_ORDER_STATUSES — что попадает в выручку", () => {
  it("доставленные заказы считаются", () => {
    expect(REVENUE_ORDER_STATUSES).toContain("delivered")
    expect(isRevenueStatus("delivered")).toBe(true)
  })

  it("заказы в работе (машина и водитель заняты) считаются", () => {
    for (const status of OCCUPYING_ORDER_STATUSES) {
      expect(REVENUE_ORDER_STATUSES).toContain(status)
      expect(isRevenueStatus(status)).toBe(true)
    }
  })

  it("закрытые без результата заказы в выручку не идут", () => {
    // «delivered» — единственный закрытый статус, который даёт выручку
    for (const status of CLOSED_ORDER_STATUSES) {
      if (status === "delivered") continue
      expect(isRevenueStatus(status)).toBe(false)
    }
    expect(isRevenueStatus("cancelled")).toBe(false)
    expect(isRevenueStatus("rejected")).toBe(false)
    expect(isRevenueStatus("expired")).toBe(false)
  })

  it("заказы, которые ещё не заняли машину и водителя, в выручку не идут", () => {
    expect(isRevenueStatus("search")).toBe(false)
    expect(isRevenueStatus("negotiation")).toBe(false)
    expect(isRevenueStatus("agreed")).toBe(false)
  })

  it("набор без дублей и не принимает посторонние значения", () => {
    expect(new Set(REVENUE_ORDER_STATUSES).size).toBe(REVENUE_ORDER_STATUSES.length)
    expect(isRevenueStatus("")).toBe(false)
    expect(isRevenueStatus(null)).toBe(false)
    expect(isRevenueStatus(undefined)).toBe(false)
    expect(isRevenueStatus(42)).toBe(false)
    expect(isRevenueStatus("несуществующий")).toBe(false)
  })
})
