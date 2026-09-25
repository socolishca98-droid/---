/**
 * ETA Service - главный сервис расчета времени прибытия
 */

import type {
  ETARequest,
  ETACalculation,
  Coordinates,
  RiskLevel
} from "./types";
import {
  fetchOSRMRoute,
  validateCoordinates,
  haversineDistance
} from "./osrm-client";
import {
  calculateAllCoefficients,
  calculateRiskFactors,
  calculateRouteCost
} from "./coefficients";
import { generateCacheKey, getFromCache, saveToCache } from "./cache";

const CACHE_TTL = 5 * 60 * 1000;

export async function calculateETA(
  request: ETARequest
): Promise<ETACalculation> {
  const { origin, destination, waypoints = [], departureTime } = request;
  const departure = departureTime || new Date();

  if (!validateCoordinates(origin)) {
    return createErrorResult("Некорректные координаты отправления");
  }
  if (!validateCoordinates(destination)) {
    return createErrorResult("Некорректные координаты назначения");
  }

  const waypointsKey =
    waypoints.length > 0
      ? waypoints.map((point: any) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`).join("~")
      : undefined;
  const cacheKey = generateCacheKey(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng,
    departure.getHours(),
    waypointsKey
  );

  if (request.useCache !== false) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      return cached;
    }
  }

  try {
    const osrmResponse = await fetchOSRMRoute(origin, destination, waypoints, {
      steps: true,
      overview: "full"
    });

    const route = osrmResponse.routes[0];
    const distanceKm = route.distance / 1000;
    const coefficients = calculateAllCoefficients(request, distanceKm);

    const durationBase = route.duration;
    const durationWithTraffic = Math.round(durationBase * coefficients.total);
    const riskFactors = calculateRiskFactors(coefficients, request, distanceKm);
    const estimatedCost = calculateRouteCost(distanceKm, request.vehicle);

    const plannedETA = new Date(departure.getTime() + durationBase * 1000);
    const liveETA = new Date(departure.getTime() + durationWithTraffic * 1000);

    const result: ETACalculation = {
      success: true,
      source: "osrm",
      durationBase,
      durationWithTraffic,
      distance: route.distance,
      riskLevel: riskFactors.level,
      coefficients,
      riskFactors,
      polyline: route.geometry,
      plannedETA,
      liveETA,
      estimatedCost,
      calculatedAt: new Date(),
      validUntil: new Date(Date.now() + CACHE_TTL),
      routeDetails: {
        legs: route.legs.map((leg: any, index: any) => ({
          from: osrmResponse.waypoints[index]?.name || `Точка ${index + 1}`,
          to: osrmResponse.waypoints[index + 1]?.name || `Точка ${index + 2}`,
          distance: leg.distance,
          duration: leg.duration
        }))
      }
    };

    if (request.useCache !== false) {
      saveToCache(cacheKey, result);
    }

    return result;
  } catch (error) {
    console.error("[ETA] Error, using fallback:", error);
    return calculateFallbackETA(origin, destination, request);
  }
}

function calculateFallbackETA(
  origin: Coordinates,
  destination: Coordinates,
  request: ETARequest
): ETACalculation {
  const departureTime = request.departureTime || new Date();
  const directDistance = haversineDistance(origin, destination);
  const roadFactor = 1.3;
  const estimatedDistance = directDistance * roadFactor * 1000;
  const avgSpeed = 60;
  const durationBase = ((directDistance * roadFactor) / avgSpeed) * 3600;

  const coefficients = calculateAllCoefficients(
    request,
    directDistance * roadFactor
  );
  const durationWithTraffic = Math.round(durationBase * coefficients.total);
  const riskFactors = calculateRiskFactors(
    coefficients,
    request,
    directDistance * roadFactor
  );
  const estimatedCost = calculateRouteCost(
    directDistance * roadFactor,
    request.vehicle
  );

  return {
    success: true,
    source: "fallback",
    durationBase: Math.round(durationBase),
    durationWithTraffic,
    distance: Math.round(estimatedDistance),
    riskLevel: riskFactors.level,
    coefficients,
    riskFactors,
    polyline: "",
    plannedETA: new Date(departureTime.getTime() + durationBase * 1000),
    liveETA: new Date(departureTime.getTime() + durationWithTraffic * 1000),
    estimatedCost,
    calculatedAt: new Date(),
    validUntil: new Date(Date.now() + CACHE_TTL)
  };
}

function createErrorResult(message: string): ETACalculation {
  return {
    success: false,
    source: "error",
    durationBase: 0,
    durationWithTraffic: 0,
    distance: 0,
    riskLevel: "high" as RiskLevel,
    coefficients: {
      rushHour: 1,
      weather: 1,
      cargoComplexity: 1,
      roadType: 1,
      dayOfWeek: 1,
      total: 1
    },
    riskFactors: {
      level: "high",
      delayProbability: 100,
      reasons: [message],
      recommendations: ["Проверьте данные"]
    },
    polyline: "",
    plannedETA: new Date(),
    liveETA: new Date(),
    estimatedCost: { fuel: 0, tolls: 0, total: 0 },
    calculatedAt: new Date(),
    validUntil: new Date()
  };
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}ч ${minutes}мин` : `${minutes}мин`;
}

export function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} км`
    : `${Math.round(meters)} м`;
}

export { validateCoordinates, haversineDistance, decodePolyline } from "./osrm-client";
export type { ETARequest, ETACalculation, Coordinates, RiskLevel } from "./types";