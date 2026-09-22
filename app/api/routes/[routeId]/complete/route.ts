// app/api/routes/[routeId]/complete/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

type RouteParams = {
  params: Promise<{ routeId: string }>
}

export async function POST(request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;


  try {
    const { routeId } = await params

    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const { force = false } = body as {
      driverId?: string
      force?: boolean
    }

    const orders = await prisma.order.findMany({
      where: { routeId },
    })

    if (orders.length === 0) {
      return NextResponse.json(
        { success: false, error: "Маршрут не найден" },
        { status: 404 }
      )
    }

    const assignedDriverId = orders[0].assignedDriverId
    const assignedVehicleId = orders[0].assignedVehicleId

    const pendingOrders = orders.filter((o: any) => !["delivered", "cancelled", "rejected"].includes(o.status)
    )

    if (pendingOrders.length > 0 && !force) {
      return NextResponse.json(
        {
          success: false,
          error: "Не все точки маршрута завершены",
          pendingOrders: pendingOrders.map((o: any) => ({
            id: o.id,
            from: o.routeFrom,
            to: o.routeTo,
            status: o.status,
          })),
        },
        { status: 400 }
      )
    }

    await prisma.$transaction(async (tx: any) => {
      // 1. Помечаем сам рейс завершённым
      await tx.route.updateMany({
        where: { id: routeId },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      })

      if (force && pendingOrders.length > 0) {
        await tx.order.updateMany({
          where: {
            id: { in: pendingOrders.map((o: any) => o.id) },
          },
          data: {
            status: "delivered",
            updatedAt: new Date(),
          },
        })
      }

      if (assignedDriverId) {
        const otherActiveOrders = await tx.order.count({
          where: {
            assignedDriverId,
            routeId: { not: routeId },
            status: { in: ["confirmed", "in_transit", "loading", "unloading"] },
          },
        })

        if (otherActiveOrders === 0) {
          await tx.driver.update({
            where: { id: assignedDriverId },
            data: { status: "available" },
          })
        }

        await tx.driverShift.updateMany({
          where: {
            driverId: assignedDriverId,
            endedAt: null,
          },
          data: {
            endedAt: new Date(),
            status: "completed",
          },
        })
      }

      if (assignedVehicleId) {
        const otherActiveOrders = await tx.order.count({
          where: {
            assignedVehicleId,
            routeId: { not: routeId },
            status: { in: ["confirmed", "in_transit", "loading", "unloading"] },
          },
        })

        if (otherActiveOrders === 0) {
          await tx.vehicle.update({
            where: { id: assignedVehicleId },
            data: { status: "available" },
          })
        }
      }

      if (assignedDriverId) {
        await tx.notification.create({
          data: {
            userId: assignedDriverId,
            userRole: "driver",
            type: "route_completed",
            title: "Рейс завершён",
            message: `Маршрут из ${orders.length} точек успешно завершён`,
            routeId,
            priority: "normal",
          },
        })

        await tx.driver.update({
          where: { id: assignedDriverId },
          data: {
            ordersCompleted: { increment: orders.length },
          },
        })
      }
    })

    const stats = {
      ordersCount: orders.length,
      totalDistance: orders.reduce((sum: any, o: any) => sum + (o.distance || 0), 0),
      totalWeight: orders.reduce((sum: any, o: any) => sum + (o.weight || 0), 0),
      totalRevenue: orders.reduce((sum: any, o: any) => sum + (o.price || 0), 0),
      additionalLoads: orders.filter((o: any) => o.isAdditionalLoad).length,
    }

    return NextResponse.json({
      success: true,
      message: "Рейс завершён",
      stats,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route Complete] Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}