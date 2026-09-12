export {
  calculateETA,
  formatDuration,
  formatDistance,
  validateCoordinates,
  haversineDistance,
  decodePolyline
} from "./service";

export type {
  ETARequest,
  ETACalculation,
  Coordinates,
  RoutePoint,
  RiskLevel,
  TrafficCoefficients,
  RiskFactors
} from "./types";

export {
  calculateAllCoefficients,
  calculateRiskFactors,
  calculateRouteCost
} from "./coefficients";

export {
  generateCacheKey,
  getFromCache,
  saveToCache,
  clearCache,
  getCacheStats
} from "./cache";