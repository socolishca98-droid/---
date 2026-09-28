// lib/fleet/load.ts
//
// Загрузка машины: сколько она уже везёт и сколько ещё можно положить.
// Считаем по активным заказам: согласованные и едущие рейсы занимают
// грузоподъёмность, поисковые и отменённые — нет.

/** Статусы заказа, при которых груз фактически занимает машину. */
export const ACTIVE_LOAD_STATUSES = [
  "agreed",
  "in_route",
  "documents",
  "assigned",
  "control",
  "delivered",
] as const

export interface LoadOrder {
  weight: number | null
  status: string
}

export interface LoadVehicle {
  capacity: number | null
}

/** Суммарный вес груза активных заказов (кг). */
export function activeLoadKg(orders: readonly LoadOrder[]): number {
  let total = 0
  for (const order of orders) {
    if (!(ACTIVE_LOAD_STATUSES as readonly string[]).includes(order.status)) continue
    const weight = Number(order.weight)
    if (Number.isFinite(weight) && weight > 0) total += weight
  }
  return total
}

/** Насколько загружена машина: 0 — пустая, 1 — ровно по грузоподъёмности. */
export function loadRatio(vehicle: LoadVehicle, loadKg: number): number | null {
  const capacity = Number(vehicle.capacity)
  if (!Number.isFinite(capacity) || capacity <= 0) return null
  return loadKg / capacity
}

/**
 * Поместится ли новый груз: возвращает перегруз в кг (0 — впритык,
// отрицательное число — запас). null, если грузоподъёмность не задана.
 */
export function overloadKg(
  vehicle: LoadVehicle,
  currentLoadKg: number,
  addedKg: number,
): number | null {
  const capacity = Number(vehicle.capacity)
  if (!Number.isFinite(capacity) || capacity <= 0) return null
  return currentLoadKg + addedKg - capacity
}

/** Человекочитаемые килограммы: 12 400 → «12,4 т», 900 → «900 кг». */
export function formatKg(kg: number): string {
  if (!Number.isFinite(kg)) return "—"
  if (Math.abs(kg) < 1000) return `${Math.round(kg)} кг`
  return `${(kg / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} т`
}
