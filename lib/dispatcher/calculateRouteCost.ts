// lib/dispatcher/calculateRouteCost.ts
// Deterministic route cost calculation — no AI (Task 12)

import { routeEconomics } from "@/lib/routes/economics"

export function calculateRouteCost(params: {
  distanceKm: number
  vehicleConsumptionPer100: number
  fuelPriceRubPerL: number
  loadFactor?: number // 0-1, default 1
  tollCost?: number
}): number {
  const distance = Number(params.distanceKm)
  const consumption = Number(params.vehicleConsumptionPer100)
  const pricePerL = Number(params.fuelPriceRubPerL)
  const loadFactor = params.loadFactor !== undefined ? Math.max(0, Math.min(1, params.loadFactor)) : 1

  if (!Number.isFinite(distance) || distance <= 0) return 0
  if (!Number.isFinite(consumption) || consumption <= 0) return 0
  if (!Number.isFinite(pricePerL) || pricePerL <= 0) return 0

  const liters = (distance / 100) * consumption * loadFactor
  const fuelCost = liters * pricePerL
  const toll = params.tollCost ? Number(params.tollCost) : 0
  return Math.round(fuelCost + toll)
}
