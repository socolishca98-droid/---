// lib/logist-mobile/order-to-load.ts
//
// Преобразование собственных заказов компании (Order) в формат BuilderLoad,
// с которым работает сборщик маршрутов (lib/logist-mobile/route-builder.ts).
//
// Зачем: чтобы программа собирала цепочки А → Б → В не только из кэша биржи
// ATI, но и в первую очередь из своих заказов постоянных клиентов компании.
// Модуль чистый (без Next/Prisma), покрыт unit-тестами.

import type { BuilderLoad } from "./route-builder"

export interface OrderForBuilder {
  id: string
  routeFrom: string
  routeTo: string
  distance: number | null
  weight: number | null
  volume: number | null
  cargoType: string | null
  requirements?: string | null
  price: number | null
  clientName?: string | null
  clientContact?: string | null
  deadline?: string | Date | null
  status: string
  driverId?: string | null
  archivedAt?: string | Date | null
}

/** Статусы заказа, которые ещё не отданы в рейс и могут участвовать в сборке. */
const AVAILABLE_STATUSES = new Set(["new", "pending", "search", "negotiation", "agreed"])

export function isOrderAvailableForRoute(order: OrderForBuilder): boolean {
  if (order.archivedAt) return false
  if (order.driverId) return false
  return AVAILABLE_STATUSES.has(String(order.status ?? "").toLowerCase())
}

export function orderToBuilderLoad(order: OrderForBuilder): BuilderLoad {
  const loadingDate =
    order.deadline instanceof Date
      ? order.deadline.toISOString()
      : order.deadline
        ? String(order.deadline)
        : null

  return {
    id: `order:${order.id}`,
    loadId: order.id,
    fromCity: order.routeFrom,
    toCity: order.routeTo,
    weightKg: order.weight ?? null,
    volumeM3: order.volume ?? null,
    cargoType: order.cargoType ?? null,
    truckType: order.requirements ?? null,
    priceRub: order.price ?? null,
    priceWithNds: null,
    distanceKm: order.distance ?? null,
    firmName: order.clientName?.trim() || "Свой заказ",
    firmUrl: null,
    contactPhone: order.clientContact?.trim() || null,
    loadingDate,
    status: "own_order",
    isOwnOrder: true,
  }
}

export function ordersToBuilderLoads(orders: OrderForBuilder[]): BuilderLoad[] {
  return orders.filter(isOrderAvailableForRoute).map(orderToBuilderLoad)
}
