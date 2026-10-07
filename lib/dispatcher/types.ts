// lib/dispatcher/types.ts
// Smart Dispatcher — architecture preparation (Task 12)
// AI will only convert user natural language request to structured parameters.
// Financial calculations are performed by deterministic functions below.

export interface LoadRequest {
  fromCity?: string
  toCity?: string
  fromRegion?: string
  toRegion?: string
  truckType?: string
  minWeight?: number
  maxWeight?: number
  minPrice?: number
  minPricePerKm?: number
  cargoType?: string
  loadingType?: string
  date?: string // "tomorrow", "today", or ISO date
  maxDistance?: number
}

export interface StructuredLoadQuery {
  fromCityKey?: string
  toCityKey?: string
  truckType?: string[]
  filters: {
    minPrice?: number
    maxPrice?: number
    minPricePerKm?: number
    minWeight?: number
    maxWeight?: number
    maxDistance?: number
  }
}

export interface VehicleMatchResult {
  vehicleId: string
  suitabilityScore: number
  reasons: string[]
  conflicts: string[]
}

export interface DriverMatchResult {
  driverId: string
  suitabilityScore: number
  reasons: string[]
  conflicts: string[]
}

export interface RankedLoad {
  loadId: string
  score: number
  expectedProfit: number
  costEstimate: number
  distanceKm: number
  revenue: number
  reasons: string[]
}
