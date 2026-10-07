// lib/dispatcher/matchVehicle.ts
// Deterministic vehicle matching — no AI (Task 12)

import { VehicleMatchResult } from "./types"

export function matchVehicle(
  loadRequirements: {
    weight?: number
    truckType?: string
    volume?: number
  },
  vehicle: { id: string; type?: string; capacity?: number; volume?: number; status?: string },
): VehicleMatchResult {
  const conflicts: string[] = []
  const reasons: string[] = []

  if (vehicle.status !== "available") {
    conflicts.push(`Vehicle ${vehicle.id} not available (status: ${vehicle.status})`)
  }

  if (loadRequirements.weight && vehicle.capacity && loadRequirements.weight > vehicle.capacity) {
    conflicts.push(`Weight exceeds capacity (${loadRequirements.weight} > ${vehicle.capacity})`)
  }

  if (loadRequirements.truckType && vehicle.type && !vehicle.type.toLowerCase().includes(loadRequirements.truckType.toLowerCase())) {
    conflicts.push(`Truck type mismatch (needs: ${loadRequirements.truckType}, has: ${vehicle.type})`)
  }

  if (conflicts.length === 0) {
    reasons.push("Matches requirements")
  }

  const score = conflicts.length === 0 ? 100 : Math.max(0, 100 - conflicts.length * 25)

  return { vehicleId: vehicle.id, suitabilityScore: score, reasons, conflicts }
}
