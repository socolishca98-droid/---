// app/api/routes/[routeId]/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

type RouteParams = {
  params: Promise<{ routeId: string }>
}

// GET /api/routes/[routeId] – получить маршрут со всеми заказами
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;


  try {
    const { routeId } = await params

    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 },
      )
    }

    const orders = await prisma.order.findMany({
      where: { routeId },
      orderBy: [{ routeSequence: "asc" }, { createdAt: "asc" }],
    })

    if (orders.length === 0) {
      return NextResponse.json(
        { success: false, error: "Маршрут не найден" },
        { status: 404 },
      )
    }

    const driverId = orders[0].assignedDriverId
    const vehicleId = orders[0].assignedVehicleId

    const [driver, vehicle] = await Promise.all([
      driverId ? prisma.driver.findUnique({ where: { id: driverId } }) : null,
      vehicleId ? prisma.vehicle.findUnique({ where: { id: vehicleId } }) : null,
    ])

    const stats = {
      totalOrders: orders.length,
      totalDistance: orders.reduce((sum, o) => sum + (o.distance || 0), 0),
      totalWeight: orders.reduce((sum, o) => sum + (o.weight || 0), 0),
      totalPrice: orders.reduce((sum, o) => sum + (o.price || 0), 0),
      completedOrders: orders.filter((o) => o.status === "delivered").length,
      pendingOrders: orders.filter(
        (o) => !["delivered", "cancelled", "rejected"].includes(o.status),
      ).length,
      additionalLoads: orders.filter((o) => o.isAdditionalLoad).length,
    }

    const vehicleCapacity = vehicle?.capacity || 0
    const usedCapacity = stats.totalWeight
    const availableCapacity = Math.max(0, vehicleCapacity - usedCapacity)

    return NextResponse.json({
      success: true,
      route: {
        id: routeId,
        driver,
        vehicle,
        orders,
        stats,
        capacity: {
          total: vehicleCapacity,
          used: usedCapacity,
          available: availableCapacity,
          utilizationPercent:
            vehicleCapacity > 0
              ? Math.round((usedCapacity / vehicleCapacity) * 100)
              : 0,
        },
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route API] GET Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// PATCH /api/routes/[routeId] – обновить порядок точек (routeSequence)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;


  try {
    const { routeId } = await params

    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 },
      )
    }

    const body = (await request.json().catch(() => ({}))) as unknown
    const { orderSequence } = (body || {}) as {
      orderSequence?: { orderId: string; sequence: number }[]
    }

    if (!orderSequence || !Array.isArray(orderSequence) || orderSequence.length === 0) {
      return NextResponse.json(
        { success: false, error: "orderSequence[] required" },
        { status: 400 },
      )
    }

    // базовая валидация
    const normalized = orderSequence
      .filter((x) => x && typeof x.orderId === "string")
      .map((x) => ({
        orderId: x.orderId,
        sequence: Number.isFinite(x.sequence) ? Math.floor(x.sequence) : NaN,
      }))
      .filter((x) => x.orderId.length > 0 && Number.isFinite(x.sequence) && x.sequence >= 1)

    if (normalized.length !== orderSequence.length) {
      return NextResponse.json(
        { success: false, error: "Invalid orderSequence payload" },
        { status: 400 },
      )
    }

    const ids = normalized.map((x) => x.orderId)
    const uniqueIds = new Set(ids)
    if (uniqueIds.size !== ids.length) {
      return NextResponse.json(
        { success: false, error: "Duplicate orderId in orderSequence" },
        { status: 400 },
      )
    }

    // безопасность: проверяем, что все orderId действительно принадлежат routeId
    const existing = await prisma.order.findMany({
      where: { routeId, id: { in: ids } },
      select: { id: true },
    })

    if (existing.length !== ids.length) {
      return NextResponse.json(
        {
          success: false,
          error: "Some orders do not belong to this route",
        },
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

    return NextResponse.json({
      success: true,
      updated: normalized.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route API] PATCH Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// DELETE /api/routes/[routeId] – отменить весь маршрут
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;


  try {
    const { routeId } = await params

    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 },
      )
    }

    const orders = await prisma.order.findMany({
      where: { routeId },
      select: {
        id: true,
        assignedDriverId: true,
        assignedVehicleId: true,
        status: true,
      },
    })

    if (orders.length === 0) {
      return NextResponse.json(
        { success: false, error: "Маршрут не найден" },
        { status: 404 },
      )
    }

    const driverId = orders[0].assignedDriverId
    const vehicleId = orders[0].assignedVehicleId

    await prisma.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { routeId },
        data: { status: "cancelled" },
      })

      if (driverId) {
        const otherActive = await tx.order.count({
          where: {
            assignedDriverId: driverId,
            routeId: { not: routeId },
            status: { in: ["confirmed", "in_transit", "loading", "unloading"] },
          },
        })
        if (otherActive === 0) {
          await tx.driver.update({
            where: { id: driverId },
            data: { status: "available" },
          })
        }
      }

      if (vehicleId) {
        const otherActive = await tx.order.count({
          where: {
            assignedVehicleId: vehicleId,
            routeId: { not: routeId },
            status: { in: ["confirmed", "in_transit", "loading", "unloading"] },
          },
        })
        if (otherActive === 0) {
          await tx.vehicle.update({
            where: { id: vehicleId },
            data: { status: "available" },
          })
        }
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route API] DELETE Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}