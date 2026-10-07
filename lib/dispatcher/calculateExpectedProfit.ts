// lib/dispatcher/calculateExpectedProfit.ts
// Deterministic expected profit — no AI (Task 12)

export function calculateExpectedProfit(
  revenue: number,
  distanceKm: number,
  vehicleConsumptionPer100: number,
  fuelPriceRubPerL: number,
  loadFactor?: number,
  tollCost?: number,
): { expectedProfit: number; cost: number; marginPercent: number | null; isLoss: boolean } {
  const rev = Number(revenue)
  const dist = Number(distanceKm)
  const consumption = Number(vehicleConsumptionPer100)
  const pricePerL = Number(fuelPriceRubPerL)
  const factor = loadFactor !== undefined ? Math.max(0, Math.min(1, loadFactor)) : 1

  if (!Number.isFinite(rev) || rev < 0 || !Number.isFinite(dist) || dist <= 0) {
    return { expectedProfit: 0, cost: 0, marginPercent: null, isLoss: false }
  }

  const liters = (dist / 100) * consumption * factor
  const fuelCost = liters * pricePerL
  const toll = tollCost ? Number(tollCost) : 0
  const cost = Math.round(fuelCost + toll)
  const profit = rev - cost
  const marginPercent = rev > 0 ? Math.round((profit / rev) * 10000) / 100 : null
  return { expectedProfit: profit, cost, marginPercent, isLoss: profit < 0 }
}
