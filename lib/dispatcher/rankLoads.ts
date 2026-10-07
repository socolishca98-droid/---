// lib/dispatcher/rankLoads.ts
// Deterministic load ranking — no AI (Task 12)
// AI only transforms user request into StructuredLoadQuery.

import { StructuredLoadQuery, RankedLoad } from "./types"
import { calculateExpectedProfit } from "./calculateExpectedProfit"

/** Rank loads by expected profitability and suitability */
export function rankLoads(
  loads: Array<{ id: string; price?: number; distance?: number; weight?: number; truckType?: string }>,
  query: StructuredLoadQuery,
  vehicleConsumptionPer100: number = 12,
  fuelPriceRubPerL: number = 60,
): RankedLoad[] {
  const ranked: RankedLoad[] = []

  for (const load of loads) {
    const distance = Number(load.distance) || 0
    const price = Number(load.price) || 0
    const weight = Number(load.weight) || 0

    if (distance <= 0) continue
    if (query.filters.minPrice !== undefined && price < query.filters.minPrice) continue
    if (query.filters.maxPrice !== undefined && price > query.filters.maxPrice) continue

    const { expectedProfit, cost, marginPercent, isLoss } = calculateExpectedProfit(
      price,
      distance,
      vehicleConsumptionPer100,
      fuelPriceRubPerL,
    )

    const reasons: string[] = []
    if (expectedProfit > 0) reasons.push(`Positive expected profit: ${expectedProfit} rub`)
    if (marginPercent !== null && marginPercent > 20) reasons.push(`Good margin: ${marginPercent}%`)
    if (isLoss) reasons.push("Expected loss — avoid")

    const score = Math.max(0, 100 + (expectedProfit / Math.max(price, 1)) * 50 - (isLoss ? 50 : 0))

    ranked.push({
      loadId: load.id,
      score: Math.round(score),
      expectedProfit,
      costEstimate: cost,
      distanceKm: distance,
      revenue: price,
      reasons,
    })
  }

  ranked.sort((a, b) => b.score - a.score)
  return ranked.slice(0, 20)
}
