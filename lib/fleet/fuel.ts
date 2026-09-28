// lib/fleet/fuel.ts
//
// Оценочный учёт топлива: паспортный расход корректируется загрузкой машины,
// а остаток в баке уменьшается по завершении рейса и пополняется заправкой.
// Это оценка для планирования, а не датчик: точные литры приходят расходами
// водителя, здесь — порядок величины для решения «хватит ли до Москвы».

/** Надбавка к расходу при полной загрузке (25 % — ориентир для грузовика). */
export const FULL_LOAD_FUEL_FACTOR = 0.25

export interface FuelVehicle {
  fuelTankL?: number | null
  fuelConsumptionPer100?: number | null
  fuelLevelL?: number | null
  capacity?: number | null
}

/**
 * Коэффициент загрузки: 0 — пустая, 1 — полная и больше.
 * Без грузоподъёмности считаем загрузку неизвестной и коэффициент нейтральным.
 */
export function loadFactor(vehicle: FuelVehicle, loadKg: number): number {
  const capacity = Number(vehicle.capacity)
  if (!Number.isFinite(capacity) || capacity <= 0) return 1
  return 1 + FULL_LOAD_FUEL_FACTOR * Math.min(1, Math.max(0, loadKg / capacity))
}

/** Оценочный расход топлива на рейс (литры). */
export function estimateFuelL(
  vehicle: FuelVehicle,
  distanceKm: number,
  loadKg: number,
): number | null {
  const consumption = Number(vehicle.fuelConsumptionPer100)
  const distance = Number(distanceKm)
  if (!Number.isFinite(consumption) || consumption <= 0) return null
  if (!Number.isFinite(distance) || distance <= 0) return 0
  return (distance / 100) * consumption * loadFactor(vehicle, loadKg)
}

/** Остаток в баке после рейса; без настроек топлива возвращаем как было. */
export function fuelAfterRoute(
  vehicle: FuelVehicle,
  usedL: number | null,
): number | null {
  const level = Number(vehicle.fuelLevelL)
  if (!Number.isFinite(level) || vehicle.fuelLevelL === null || vehicle.fuelLevelL === undefined) {
    return vehicle.fuelLevelL ?? null
  }
  if (usedL === null || !Number.isFinite(usedL)) return level
  return Math.max(0, round1(level - usedL))
}

/** Бак после заправки: до горловины, не выше ёмкости. */
export function fuelAfterRefuel(vehicle: FuelVehicle, liters: number | null): number | null {
  const tank = Number(vehicle.fuelTankL)
  const level = Number(vehicle.fuelLevelL)
  if (Number.isFinite(tank) && tank > 0 && (liters === null || liters === undefined)) {
    return round1(tank)
  }
  const added = Number(liters)
  if (!Number.isFinite(added) || added <= 0) return vehicle.fuelLevelL ?? null
  const base = Number.isFinite(level) ? level : 0
  const cap = Number.isFinite(tank) && tank > 0 ? tank : Infinity
  return round1(Math.min(cap, base + added))
}

/** Хватит ли топлива на рейс: возвратом — нехватка в литрах или 0. */
export function fuelShortfallL(vehicle: FuelVehicle, neededL: number | null): number | null {
  if (neededL === null || vehicle.fuelLevelL === null || vehicle.fuelLevelL === undefined) {
    return null
  }
  return Math.max(0, round1(neededL - Number(vehicle.fuelLevelL)))
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
