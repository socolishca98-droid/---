/**
 * OSRM Client - бесплатная маршрутизация
 */

import type { Coordinates, OSRMResponse, RoutePoint } from "./types";

const OSRM_BASE_URL = "https://router.project-osrm.org";
const REQUEST_TIMEOUT = 10000;

export interface OSRMRequestOptions {
  profile?: "driving" | "car" | "bike" | "foot";
  geometries?: "polyline" | "polyline6" | "geojson";
  overview?: "full" | "simplified" | "false";
  steps?: boolean;
  annotations?: boolean;
  alternatives?: boolean;
}

export async function fetchOSRMRoute(
  origin: Coordinates,
  destination: Coordinates,
  waypoints: RoutePoint[] = [],
  options: OSRMRequestOptions = {}
): Promise<OSRMResponse> {
  const {
    profile = "driving",
    geometries = "polyline",
    overview = "full",
    steps = false,
    annotations = false,
    alternatives = false
  } = options;

  const coordinates = [
    `${origin.lng},${origin.lat}`,
    ...waypoints.map((wp) => `${wp.lng},${wp.lat}`),
    `${destination.lng},${destination.lat}`
  ].join(";");

  const params = new URLSearchParams({
    geometries,
    overview,
    steps: String(steps),
    annotations: String(annotations),
    alternatives: String(alternatives)
  });

  const url = `${OSRM_BASE_URL}/route/v1/${profile}/${coordinates}?${params}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OSRM HTTP error: ${response.status}`);
    }

    const data: OSRMResponse = await response.json();

    if (data.code !== "Ok") {
      throw new Error(`OSRM error: ${data.code}`);
    }

    if (!data.routes || data.routes.length === 0) {
      throw new Error("OSRM: No route found");
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OSRM request timeout");
    }
    throw error;
  }
}

export function validateCoordinates(coords: Coordinates): boolean {
  const { lat, lng } = coords;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  return true;
}

export function haversineDistance(
  point1: Coordinates,
  point2: Coordinates
): number {
  const R = 6371;
  const dLat = toRad(point2.lat - point1.lat);
  const dLng = toRad(point2.lng - point1.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(point1.lat)) *
      Math.cos(toRad(point2.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

export function decodePolyline(encoded: string): Coordinates[] {
  const points: Coordinates[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}