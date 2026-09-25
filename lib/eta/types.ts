/**
 * ETA Engine Types
 */

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RoutePoint extends Coordinates {
  name?: string;
  type?: "origin" | "destination" | "waypoint";
  dwellTime?: number;
}

export interface OSRMRoute {
  distance: number;
  duration: number;
  geometry: string;
  legs: OSRMRouteLeg[];
}

export interface OSRMRouteLeg {
  distance: number;
  duration: number;
  summary: string;
  steps: OSRMRouteStep[];
}

export interface OSRMRouteStep {
  distance: number;
  duration: number;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    location: [number, number];
  };
}

export interface OSRMResponse {
  code: string;
  routes: OSRMRoute[];
  waypoints: Array<{
    name: string;
    location: [number, number];
    hint: string;
  }>;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface TrafficCoefficients {
  rushHour: number;
  weather: number;
  cargoComplexity: number;
  roadType: number;
  dayOfWeek: number;
  total: number;
}

export interface RiskFactors {
  delayProbability: number;
  level: RiskLevel;
  reasons: string[];
  recommendations: string[];
}

export interface ETACalculation {
  success: boolean;
  /**
   * Откуда взялись цифры:
   *  - "osrm"     — реальный маршрут по дорогам (OSRM);
   *  - "fallback" — OSRM недоступен, прикидка по прямой с коэффициентом 1.3;
   *  - "error"    — посчитать не удалось вовсе.
   * Без этого поля отличить измерение от прикидки было нельзя: оба случая
   * возвращали success: true.
   */
  source?: "osrm" | "fallback" | "error";
  durationBase: number;
  durationWithTraffic: number;
  distance: number;
  riskLevel: RiskLevel;
  coefficients: TrafficCoefficients;
  riskFactors: RiskFactors;
  polyline: string;
  plannedETA: Date;
  liveETA: Date;
  estimatedCost: {
    fuel: number;
    tolls: number;
    total: number;
  };
  calculatedAt: Date;
  validUntil: Date;
  routeDetails?: {
    legs: Array<{
      from: string;
      to: string;
      distance: number;
      duration: number;
    }>;
  };
}

export interface ETARequest {
  origin: Coordinates;
  destination: Coordinates;
  waypoints?: RoutePoint[];
  departureTime?: Date;
  cargo?: {
    weight?: number;
    type?: "standard" | "fragile" | "hazmat" | "oversized" | "refrigerated";
    requiresEscort?: boolean;
  };
  vehicle?: {
    type?: "truck" | "van" | "car";
    fuelConsumption?: number;
    maxSpeed?: number;
  };
  weather?: "clear" | "rain" | "snow" | "fog" | "storm";
  useCache?: boolean;
}