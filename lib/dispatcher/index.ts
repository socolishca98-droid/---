// lib/dispatcher/index.ts
// Smart Dispatcher — architecture (Task 12)
// AI converts natural language request to StructuredLoadQuery.
// Deterministic functions handle all financial and matching logic.

export * from "./types"
export { findSuitableLoads } from "./findSuitableLoads"
export { calculateRouteCost } from "./calculateRouteCost"
export { calculateExpectedProfit } from "./calculateExpectedProfit"
export { matchVehicle } from "./matchVehicle"
export { matchDriver } from "./matchDriver"
export { rankLoads } from "./rankLoads"
