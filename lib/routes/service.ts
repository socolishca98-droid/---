// lib/routes/service.ts
//
// Сервисный слой рейсов: всё, что API-роуты делают с таблицей Route.
// До задачи 2 рейс был «виртуальным» — строки Order с одинаковым routeId,
// а сам routeId генерировался кодом. Теперь Route — настоящая модель
// (prisma/schema.prisma), и этот модуль отвечает за то, чтобы её поля
// (status, name, итоги, времена) всегда соответствовали заказам рейса.

import { prisma } from "@/lib/prisma"
import { scopedWhere } from "@/lib/org"

import {
  buildRouteName,
  canTransitionRoute,
  deriveRouteStatus,
  isRouteStatus,
  normalizeRouteStatus,
  summarizeRoute,
  type RouteStatus,
  type RouteSummary,
} from "@/lib/routes/model"

export type RoutesDb = Pick<
  typeof prisma,
  "route" | "order" | "driver" | "vehicle" | "routeEvent"
>

export const db: RoutesDb = prisma

export const routeOrdersOrderBy = [
  { routeSequence: "asc" as const },
  { createdAt: "asc" as const },
]

export type RouteWithOrders = {
  id: string
  name: string | null
  status: string
  driverId: string | null
  vehicleId: string | null
  startedAt: Date | null
  completedAt: Date | null
  totalDistance: number | null
  totalCost: number | null
  fuelExpense: number | null
  cargoWeight: number | null
  cargoVolume: number | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
  orders: RouteOrderRow[]
}

type RouteOrderRow = Awaited<ReturnType<typeof prisma.order.findMany>>[number]

/** Заказы рейса в порядке точек маршрута (только своей организации). */
export function listRouteOrders(
  client: RoutesDb,
  routeId: string,
  organizationId: string | null,
) {
  return client.order.findMany({
    where: scopedWhere(organizationId, { routeId }),
    orderBy: routeOrdersOrderBy,
  })
}

/** Рейс с заказами, водителем и машиной одним запросом. */
export async function getRouteWithOrders(
  client: RoutesDb,
  routeId: string,
  organizationId: string | null,
): Promise<RouteWithOrders | null> {
  const route = await client.route.findFirst({
    where: scopedWhere(organizationId, { id: routeId }),
    include: {
      orders: {
        where: scopedWhere(organizationId, {}),
        orderBy: routeOrdersOrderBy,
      },
    },
  })
  return route as unknown as RouteWithOrders | null
}

/**
 * Пересчитывает производные поля рейса по его заказам:
 * имя, статус, километры, вес, объём. Вызывается после любого изменения
 * состава рейса (добавили заказ, поменяли порядок, закрыли точку).
 */
export async function recalcRoute(
  client: RoutesDb,
  routeId: string,
  organizationId: string | null,
): Promise<RouteSummary & { status: RouteStatus; name: string }> {
  const orders = await listRouteOrders(client, routeId, organizationId)
  const route = await client.route.findFirst({
    where: scopedWhere(organizationId, { id: routeId }),
    select: { id: true, startedAt: true, completedAt: true, status: true },
  })
  if (!route) throw new Error("Рейс не найден")

  const summary = summarizeRoute(orders)
  // Отмена — решение диспетчера: пересчёт по заказам не должен «оживлять»
  // отменённый рейс, поэтому статус cancelled сохраняется.
  const status: RouteStatus =
    normalizeRouteStatus(route.status) === "cancelled"
      ? "cancelled"
      : deriveRouteStatus(
          orders.map((o: { status: string }) => o.status),
          { startedAt: route.startedAt, completedAt: route.completedAt },
        )
  const name = buildRouteName(orders)

  await client.route.updateMany({
    where: scopedWhere(organizationId, { id: routeId }),
    data: {
      status,
      name: name || null,
      totalDistance: summary.totalDistance,
      cargoWeight: summary.cargoWeight,
      cargoVolume: summary.cargoVolume || null,
    },
  })

  return { ...summary, status, name }
}

export type RouteStatusChange = {
  status: RouteStatus
  reason?: string
  actorName?: string
  startedAt?: Date | null
  completedAt?: Date | null
}

/**
 * Меняет статус рейса с проверкой допустимости перехода и записью события
 * в таймлайн (RouteEvent.type = "status").
 * Возвращает { ok: false, error } вместо исключения — API отдаст это клиенту.
 */
export async function changeRouteStatus(
  client: RoutesDb,
  routeId: string,
  change: RouteStatusChange,
  organizationId: string | null,
): Promise<{ ok: true; status: RouteStatus } | { ok: false; error: string }> {
  const next = normalizeRouteStatus(change.status)
  if (!next) return { ok: false, error: "Неизвестный статус рейса" }

  const route = await client.route.findFirst({
    where: scopedWhere(organizationId, { id: routeId }),
    select: { id: true, status: true, driverId: true, vehicleId: true, startedAt: true, completedAt: true },
  })
  if (!route) return { ok: false, error: "Рейс не найден" }

  const current = normalizeRouteStatus(route.status) ?? "planned"
  const transition = canTransitionRoute(current, next)
  if (!transition.ok) return { ok: false, error: transition.reason }

  const now = new Date()
  const data: Record<string, unknown> = { status: next }

  // время старта/финиша ставится автоматически при переходе
  if (next === "active" || next === "in_transit") {
    if (!route.startedAt) data.startedAt = change.startedAt ?? now
  }
  if (next === "planned") {
    data.startedAt = null
    data.completedAt = null
  }
  if (next === "cancelled") {
    // факт старта сохраняем (для истории), рейс просто не поедет дальше
    data.completedAt = null
  }
  if (next === "completed") {
    data.completedAt = change.completedAt ?? now
    if (!route.startedAt) data.startedAt = change.startedAt ?? now
  }
  if (change.startedAt !== undefined && next !== "cancelled") data.startedAt = change.startedAt
  if (change.completedAt !== undefined && next !== "cancelled") data.completedAt = change.completedAt

  await client.route.updateMany({ where: scopedWhere(organizationId, { id: routeId }), data })

  // событие в таймлайн — только если у рейса есть водитель
  // (RouteEvent.driverId обязательное поле)
  if (route.driverId) {
    await client.routeEvent.create({
      data: {
        organizationId,
        routeId,
        driverId: route.driverId,
        vehicleId: route.vehicleId,
        type: "status",
        status: next,
        data: JSON.stringify({
          from: current,
          to: next,
          reason: change.reason || null,
          actor: change.actorName || null,
          at: now.toISOString(),
        }),
      },
    })
  }

  return { ok: true, status: next }
}

/**
 * Создаёт строку Route. Используется при сборке рейса из заказов и для
 * добора «исторических» routeId, которые остались в Order от старой схемы
 * (миграция scripts/migrate-task2.ts делает то же самое пакетно).
 */
export async function ensureRouteRow(
  client: RoutesDb,
  input: {
    organizationId: string | null
    routeId?: string | null
    driverId?: string | null
    vehicleId?: string | null
    name?: string | null
    status?: string | null
    notes?: string | null
  },
): Promise<{ id: string; created: boolean }> {
  const organizationId = input.organizationId
  // быстрый путь: рейс уже есть — ничего не делаем (важно для точек GPS,
  // которые пишутся часто)
  if (input.routeId) {
    const existing = await client.route.findFirst({
      where: scopedWhere(organizationId, { id: input.routeId }),
      select: { id: true },
    })
    if (existing) return { id: existing.id, created: false }
  }

  const orders = input.routeId
    ? await listRouteOrders(client, input.routeId, organizationId)
    : []

  const driverId = input.driverId ?? orders[0]?.assignedDriverId ?? null
  const vehicleId = input.vehicleId ?? orders[0]?.assignedVehicleId ?? null
  const status =
    normalizeRouteStatus(input.status) ??
    deriveRouteStatus(orders.map((o: { status: string }) => o.status))

  const created = await client.route.create({
    data: {
      organizationId,
      ...(input.routeId ? { id: input.routeId } : {}),
      name: input.name || buildRouteName(orders) || null,
      status,
      driverId,
      vehicleId,
      notes: input.notes ?? null,
      totalDistance: summarizeRoute(orders).totalDistance || null,
      cargoWeight: summarizeRoute(orders).cargoWeight || null,
      cargoVolume: summarizeRoute(orders).cargoVolume || null,
    },
    select: { id: true },
  })

  return { id: created.id, created: true }
}

export type RouteEventInput = {
  /** Организация вызывающего: событие и рейс создаются только в её границах */
  organizationId: string | null
  routeId: string
  driverId: string
  vehicleId?: string | null
  orderId?: string | null
  stageId?: string | null
  /** location | status | photo | sos | note | eta_update | custom */
  type: string
  status?: string | null
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  /** JSON-строка с деталями события */
  data?: string | null
}

/**
 * Единая точка записи события рейса (таймлайн).
 *
 * RouteEvent.routeId — внешний ключ на Route, а события пишутся по routeId
 * из заказа. Для «исторических» routeId строки Route может не быть, поэтому
 * сначала добираем её: иначе событие потеряется, а после `prisma db push`
 * (когда FK включатся) запись упадёт с ошибкой внешнего ключа.
 */
export async function logRouteEvent(client: RoutesDb, input: RouteEventInput): Promise<void> {
  await ensureRouteRow(client, {
    organizationId: input.organizationId,
    routeId: input.routeId,
    driverId: input.driverId,
    vehicleId: input.vehicleId ?? null,
  })

  await client.routeEvent.create({
    data: {
      organizationId: input.organizationId,
      routeId: input.routeId,
      driverId: input.driverId,
      vehicleId: input.vehicleId ?? null,
      orderId: input.orderId ?? null,
      stageId: input.stageId ?? null,
      type: input.type,
      status: input.status ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      address: input.address ?? null,
      data: input.data ?? null,
    },
  })
}

export type SerializedRoute = {
  id: string
  name: string | null
  status: string
  statusLabel: string
  driverId: string | null
  vehicleId: string | null
  startedAt: Date | null
  completedAt: Date | null
  notes: string | null
  totalDistance: number | null
  totalCost: number | null
  fuelExpense: number | null
  cargoWeight: number | null
  cargoVolume: number | null
  createdAt: Date
  updatedAt: Date
}

/** Единая форма рейса в ответах API. */
export function serializeRoute(route: {
  id: string
  name?: string | null
  status?: string | null
  driverId?: string | null
  vehicleId?: string | null
  startedAt?: Date | null
  completedAt?: Date | null
  notes?: string | null
  totalDistance?: number | null
  totalCost?: number | null
  fuelExpense?: number | null
  cargoWeight?: number | null
  cargoVolume?: number | null
  createdAt?: Date
  updatedAt?: Date
}): SerializedRoute {
  const status = normalizeRouteStatus(route.status) ?? "planned"
  return {
    id: route.id,
    name: route.name ?? null,
    status,
    statusLabel: status,
    driverId: route.driverId ?? null,
    vehicleId: route.vehicleId ?? null,
    startedAt: route.startedAt ?? null,
    completedAt: route.completedAt ?? null,
    notes: route.notes ?? null,
    totalDistance: route.totalDistance ?? null,
    totalCost: route.totalCost ?? null,
    fuelExpense: route.fuelExpense ?? null,
    cargoWeight: route.cargoWeight ?? null,
    cargoVolume: route.cargoVolume ?? null,
    createdAt: route.createdAt ?? new Date(),
    updatedAt: route.updatedAt ?? new Date(),
  }
}

export { isRouteStatus, normalizeRouteStatus, summarizeRoute, buildRouteName, deriveRouteStatus }
