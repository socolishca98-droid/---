// lib/dispatcher/matchDriver.ts
// Deterministic driver matching — no AI (Task 12)

import { DriverMatchResult } from "./types"

export function matchDriver(
  routeRequirements: {
    routeId?: string
    requiredStatus?: string
  },
  driver: { id: string; status?: string; name?: string; currentLocation?: string },
): DriverMatchResult {
  const conflicts: string[] = []
  const reasons: string[] = []

  if (routeRequirements.requiredStatus && driver.status !== routeRequirements.requiredStatus) {
    conflicts.push(`Driver status mismatch (needs: ${routeRequirements.requiredStatus}, has: ${driver.status})`)
  }

  if (driver.status !== "available" && driver.status !== "busy") {
    conflicts.push(`Driver ${driver.id} not in active status (status: ${driver.status})`)
  } else if (driver.status === "available") {
    reasons.push("Driver is available")
  }

  const score = conflicts.length === 0 ? 100 : Math.max(0, 100 - conflicts.length * 25)

  return { driverId: driver.id, suitabilityScore: score, reasons, conflicts }
}
