// app/api/routes/[routeId]/route.ts
//
// Рейс как запись в таблице Route (задача 2):
//   GET    — рейс с заказами, водителем, машиной и итогами
//   PATCH  — порядок точек, статус рейса, имя/заметки, переназначение водителя/машины
//   DELETE — отмена рейса (заказы отменяются, водитель и машина освобождаются)

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireStaff } from "@/lib/auth/session"
import { findVehicleOccupant, linkDriverToVehicle } from "@/lib/fleet/assignment"
import {
  ROUTE_STATUSES,
  OCCUPYING_ORDER_STATUSES,
  isRouteStatus,
  routeStatusLabel,
  summarizeRoute,
} from "@/lib/routes/model"
import {
  changeRouteStatus,
  ensureRouteRow,
  getRouteWithOrders,
  recalcRoute,
  routeOrdersOrderBy,
  serializeRoute,
} from "@/lib/routes/service"

type RouteParams = {
  params: Promise<{ routeId: string }>
}

type PatchBody = {
  orderSequence?: { orderId: string; sequence: number }[]
  status?: string
  name?: string | null
  notes?: string | null
  driverId?: string | null
  vehicleId?: string | null
  startedAt?: string | null
  completedAt?: string | null
}

/** Итоги рейса в форме, которую уже ждут клиенты (старые имена полей сохранены). */
function buildStats(orders: Parameters<typeof summarizeRoute>[0]) {
  const summary = summarizeRoute(orders)
  return {
    totalOrders: summary.totalOrders,
    totalDistance: summary.totalDistance,
    totalWeight: summary.cargoWeight,
    totalPrice: summary.revenue,
    completedOrders: summary.deliveredOrders,
    pendingOrders: summary.pendingOrders,
    additionalLoads: summary.additionalLoads,
    // новые поля модели Route
    cargoWeight: summary.cargoWeight,
    cargoVolume: summary.cargoVolume,
    revenue: summary.revenue,
    activeOrders: summary.activeOrders,
    cancelledOrders: summary.cancelledOrders,
  }
}

function buildCapacity(vehicleCapacity: number, usedWeight: number) {
  const total = Number.isFinite(vehicleCapacity) ? Math.max(0, vehicleCapacity) : 0
  const used = Number.isFinite(usedWeight) ? Math.max(0, usedWeight) : 0
  return {
    total,
    used,
    available: Math.max(0, total - used),
    utilizationPercent: total > 0 ? Math.round((used / total) * 100) : 0,
  }
}

// GET /api/routes/[routeId] – рейс со всеми заказами
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  try {
    const { routeId } = await params
    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 },
      )
    }

    let route = await prisma.route.findUnique({
      where: { id: routeId },
      include: {
        driver: true,
        vehicle: true,
        orders: { orderBy: routeOrdersOrderBy },
      },
    })

    // Исторический routeId: заказы есть, строки Route нет — добираем её,
    // чтобы старый рейс продолжал открываться после перехода на модель Route.
    if (!route) {
      const legacyOrders = await prisma.order.count({ where: { routeId } })
      if (legacyOrders === 0) {
        return NextResponse.json(
          { success: false, error: "Маршрут не найден" },
          { status: 404 },
        )
      }
      await ensureRouteRow(prisma, { routeId })
      route = await prisma.route.findUnique({
        where: { id: routeId },
        include: {
          driver: true,
          vehicle: true,
          orders: { orderBy: routeOrdersOrderBy },
        },
      })
    }

    if (!route) {
      return NextResponse.json(
        { success: false, error: "Маршрут не найден" },
        { status: 404 },
      )
    }

    const stats = buildStats(route.orders)

    return NextResponse.json({
      success: true,
      route: {
        ...serializeRoute(route),
        statusLabel: routeStatusLabel(route.status),
        driver: route.driver,
        vehicle: route.vehicle,
        orders: route.orders,
        stats,
        capacity: buildCapacity(route.vehicle?.capacity || 0, stats.totalWeight),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route API] GET Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// PATCH /api/routes/[routeId] – порядок точек, статус, имя, назначение
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  try {
    const { routeId } = await params
    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as PatchBody
    const { orderSequence, status, name, notes, driverId, vehicleId } = body

    const hasOrderSequence = Array.isArray(orderSequence)
    const hasRouteFields =
      status !== undefined ||
      name !== undefined ||
      notes !== undefined ||
      driverId !== undefined ||
      vehicleId !== undefined

    if (!hasOrderSequence && !hasRouteFields) {
      return NextResponse.json(
        {
          success: false,
          error: "Нечего обновлять: передайте orderSequence[], status, name, notes, driverId или vehicleId",
        },
        { status: 400 },
      )
    }

    const route = await prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true, status: true, driverId: true, vehicleId: true },
    })
    if (!route) {
      return NextResponse.json(
        { success: false, error: "Маршрут не найден" },
        { status: 404 },
      )
    }

    // ---------- 1. порядок точек ----------
    if (hasOrderSequence) {
      if (!orderSequence || orderSequence.length === 0) {
        return NextResponse.json(
          { success: false, error: "orderSequence[] required" },
          { status: 400 },
        )
      }

      const normalized = (orderSequence as { orderId?: unknown; sequence?: unknown }[])
        .filter((x) => x && typeof x.orderId === "string")
        .map((x) => ({
          orderId: x.orderId as string,
          sequence: Number.isFinite(Number(x.sequence)) ? Math.floor(Number(x.sequence)) : NaN,
        }))
        .filter((x) => x.orderId.length > 0 && Number.isFinite(x.sequence) && x.sequence >= 1)

      if (normalized.length !== orderSequence.length) {
        return NextResponse.json(
          { success: false, error: "Invalid orderSequence payload" },
          { status: 400 },
        )
      }

      const ids = normalized.map((x) => x.orderId)
      if (new Set(ids).size !== ids.length) {
        return NextResponse.json(
          { success: false, error: "Duplicate orderId in orderSequence" },
          { status: 400 },
        )
      }

      const existing = await prisma.order.findMany({
        where: { routeId, id: { in: ids } },
        select: { id: true },
      })
      if (existing.length !== ids.length) {
        return NextResponse.json(
          { success: false, error: "Some orders do not belong to this route" },
          { status: 400 },
        )
      }

      await prisma.$transaction(
        normalized.map(({ orderId, sequence }) =>
          prisma.order.updateMany({
            where: { id: orderId, routeId },
            data: { routeSequence: sequence },
          }),
        ),
      )
    }

    // ---------- 2. переназначение водителя/машины ----------
    if (driverId !== undefined || vehicleId !== undefined) {
      const nextDriverId = driverId === undefined ? route.driverId : driverId
      const nextVehicleId = vehicleId === undefined ? route.vehicleId : vehicleId

      if (nextDriverId) {
        const driver = await prisma.driver.findUnique({
          where: { id: nextDriverId },
          select: { id: true, name: true },
        })
        if (!driver) {
          return NextResponse.json(
            { success: false, error: "Водитель не найден" },
            { status: 404 },
          )
        }
      }

      if (nextVehicleId) {
        const vehicle = await prisma.vehicle.findUnique({
          where: { id: nextVehicleId },
          select: { id: true, plate: true },
        })
        if (!vehicle) {
          return NextResponse.json(
            { success: false, error: "Машина не найдена" },
            { status: 404 },
          )
        }

        const occupant = await findVehicleOccupant(prisma, nextVehicleId, nextDriverId)
        if (occupant) {
          return NextResponse.json(
            {
              success: false,
              error: `Машина уже закреплена за ${occupant.name || "другим водителем"}`,
            },
            { status: 409 },
          )
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.route.update({
          where: { id: routeId },
          data: { driverId: nextDriverId, vehicleId: nextVehicleId },
        })

        // заказы рейса едут с тем же водителем и машиной
        await tx.order.updateMany({
          where: { routeId },
          data: {
            assignedDriverId: nextDriverId,
            assignedVehicleId: nextVehicleId,
          },
        })

        // единственная запись связи «водитель ↔ машина»
        if (nextDriverId) {
          await linkDriverToVehicle(tx, nextDriverId, nextVehicleId)
        }
      })
    }

    // ---------- 3. статус рейса (с проверкой перехода) ----------
    if (status !== undefined) {
      if (!isRouteStatus(status)) {
        return NextResponse.json(
          {
            success: false,
            error: `Неизвестный статус рейса: ${status}. Доступно: ${ROUTE_STATUSES.join(", ")}`,
          },
          { status: 400 },
        )
      }

      const result = await changeRouteStatus(prisma, routeId, {
        status,
        reason: typeof body.notes === "string" ? body.notes : undefined,
        actorName: auth.value.kind === "staff" ? auth.value.user.name : undefined,
        startedAt: parseDate(body.startedAt),
        completedAt: parseDate(body.completedAt),
      })

      if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: 409 })
      }
    } else if (body.startedAt !== undefined || body.completedAt !== undefined) {
      await prisma.route.update({
        where: { id: routeId },
        data: {
          ...(body.startedAt !== undefined ? { startedAt: parseDate(body.startedAt) } : {}),
          ...(body.completedAt !== undefined ? { completedAt: parseDate(body.completedAt) } : {}),
        },
      })
    }

    // ---------- 4. имя и заметки ----------
    if (name !== undefined || notes !== undefined) {
      await prisma.route.update({
        where: { id: routeId },
        data: {
          ...(name !== undefined ? { name: name?.trim() ? name.trim() : null } : {}),
          ...(notes !== undefined ? { notes: notes?.trim() ? notes.trim() : null } : {}),
        },
      })
    }

    // ---------- 5. пересчёт итогов ----------
    const summary = await recalcRoute(prisma, routeId)

    const updated = await getRouteWithOrders(prisma, routeId)
    if (!updated) {
      return NextResponse.json({ success: false, error: "Маршрут не найден" }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      updated: hasOrderSequence ? (orderSequence?.length ?? 0) : 0,
      route: {
        ...serializeRoute(updated),
        statusLabel: routeStatusLabel(updated.status),
        orders: updated.orders,
        stats: buildStats(updated.orders),
      },
      summary,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route API] PATCH Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === "") return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? undefined : date
}

// DELETE /api/routes/[routeId] – отменить рейс
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  try {
    const { routeId } = await params
    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 },
      )
    }

    const route = await prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true, status: true, driverId: true, vehicleId: true },
    })

    if (!route) {
      const ordersCount = await prisma.order.count({ where: { routeId } })
      if (ordersCount === 0) {
        return NextResponse.json(
          { success: false, error: "Маршрут не найден" },
          { status: 404 },
        )
      }
      await ensureRouteRow(prisma, { routeId })
    }

    const cancelled = await changeRouteStatus(prisma, routeId, {
      status: "cancelled",
      reason: "Отмена рейса диспетчером",
      actorName: auth.value.kind === "staff" ? auth.value.user.name : undefined,
    })

    if (!cancelled.ok) {
      return NextResponse.json({ success: false, error: cancelled.error }, { status: 409 })
    }

    const orders = await prisma.order.findMany({
      where: { routeId },
      select: { id: true, status: true },
    })

    await prisma.$transaction(async (tx) => {
      // закрываем только незавершённые точки: доставленные остаются доставленными
      await tx.order.updateMany({
        where: {
          routeId,
          status: { notIn: ["delivered", "cancelled", "rejected"] },
        },
        data: { status: "cancelled", updatedAt: new Date() },
      })

      const current = await tx.route.findUnique({
        where: { id: routeId },
        select: { driverId: true, vehicleId: true },
      })

      if (current?.driverId) {
        const otherActive = await tx.order.count({
          where: {
            assignedDriverId: current.driverId,
            routeId: { not: routeId },
            status: { in: [...OCCUPYING_ORDER_STATUSES] },
          },
        })
        if (otherActive === 0) {
          await tx.driver.update({
            where: { id: current.driverId },
            data: { status: "available" },
          })
        }
      }

      if (current?.vehicleId) {
        const otherActive = await tx.order.count({
          where: {
            assignedVehicleId: current.vehicleId,
            routeId: { not: routeId },
            status: { in: [...OCCUPYING_ORDER_STATUSES] },
          },
        })
        if (otherActive === 0) {
          await tx.vehicle.update({
            where: { id: current.vehicleId },
            data: { status: "available" },
          })
        }
      }
    })

    await recalcRoute(prisma, routeId)

    return NextResponse.json({
      success: true,
      message: "Рейс отменён",
      cancelledOrders: orders.filter(
        (o: { status: string }) =>
          !["delivered", "cancelled", "rejected"].includes(o.status),
      ).length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route API] DELETE Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
