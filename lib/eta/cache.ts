/**
 * In-memory кеш для ETA (TTL 5 минут)
 */

import type { ETACalculation } from "./types";

interface CacheEntry {
  data: ETACalculation;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL = 5 * 60 * 1000;

export function generateCacheKey(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  departureHour?: number
): string {
  return `eta_${originLat.toFixed(4)}_${originLng.toFixed(4)}_${destLat.toFixed(4)}_${destLng.toFixed(4)}_${departureHour ?? "any"}`;
}

export function getFromCache(key: string): ETACalculation | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function saveToCache(
  key: string,
  data: ETACalculation,
  ttl: number = DEFAULT_TTL
): void {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
  if (cache.size % 100 === 0) cleanExpired();
}

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) cache.delete(key);
  }
}

export function clearCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; keys: string[] } {
  return { size: cache.size, keys: Array.from(cache.keys()) };
}