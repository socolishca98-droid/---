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

export interface CacheKeyFactors {
  /** Время выезда — из него зависят час пик и день недели. */
  departure: Date
  /** Погода, если её передали: «snow» и «clear» дают разное время. */
  weather?: string
  /** Подпись груза: тип, вес, сопровождение. */
  cargoKey?: string
}

export function generateCacheKey(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  factors: CacheKeyFactors,
  waypointsKey?: string
): string {
  // В ключе должно быть ВСЁ, от чего зависит результат. Раньше тут был только
  // час выезда: два рейса одним и тем же маршрутом в 15:30 — в четверг и в
  // пятницу — попадали в одну запись, и второй получал время первого. То же
  // с погодой и грузом: «снег» и «негабарит» молча игнорировались.
  const { departure, weather, cargoKey } = factors

  // Округляем до 15 минут: внутри четверти часа кривая пика практически линейна,
  // зато повторные запросы одного рейса попадают в один и тот же ключ.
  const slot = Math.floor(departure.getTime() / (15 * 60 * 1000))
  const dayOfWeek = departure.getDay()

  const weatherPart = weather && weather !== "clear" ? `_w${weather}` : "";
  const cargoPart = cargoKey ? `_c${cargoKey}` : "";

  // waypointsKey обязателен для маршрутов с промежуточными точками: без него
  // два разных порядка объезда с теми же началом и концом попадали в один ключ
  // и второй получал результат первого.
  const tail = waypointsKey ? `_${waypointsKey}` : "";
  return `eta_${originLat.toFixed(4)}_${originLng.toFixed(4)}_${destLat.toFixed(4)}_${destLng.toFixed(4)}_d${dayOfWeek}s${slot}${weatherPart}${cargoPart}${tail}`;
}

/** Подпись груза для ключа кэша: только то, что влияет на коэффициент. */
export function cargoCacheKey(cargo?: {
  type?: string
  weight?: number
  requiresEscort?: boolean
}): string | undefined {
  if (!cargo) return undefined
  const type = cargo.type || "standard"
  const weight = cargo.weight ?? 0
  const escort = cargo.requiresEscort ? 1 : 0
  return `${type}${weight}${escort}`
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