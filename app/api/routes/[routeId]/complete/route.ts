// app/api/routes/[routeId]/complete/route.ts
// Завершение рейса: закрывает незавершённые точки (с force), переводит Route
// в статус completed, фиксирует время финиша и итоги, освобождает водителя
// и машину, пишет событие в таймлайн рейса.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import {
  canDriverAccessRoute,
  forbidden,
  requireAnySession,
} from "@/lib/auth/session"
import { OCCUPYING_ORDER_STATUSES, type RouteOrderLike } from "@/lib/routes/model"
import {
  changeRouteStatus,
  ensureRouteRow,
  recalcRoute,
  routeOrdersOrderBy,
  serializeRoute,
} from "@/lib/routes/service"

type RouteParams = {
  params: Promise<{ routeId: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  try {
    const { routeId } = await params
    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 },
      )
    }

    // Водитель может завершить только свой рейс
    if (!(await canDriverAccessRoute(auth.value, routeId))) {
      return forbidden("Рейс назначен другому водителю")
    }

    const body = await request.json().catch(() => ({}))
    const { force = false } = body as { force?: boolean }

    let route = await prisma.route.findUnique({
      where: { id: routeId },
      include: { orders: { orderBy: routeOrdersOrderBy } },
    })

    if (!route) {
      const legacyOrders = await prisma.order.count({ where: { routeId } })
      if (legacyOrders === 0) {
        return NextResponse.json(
          { success: false, error: "Маршрут не найден" },
          { status: 404 },
        )
      }
      // исторический routeId без строки Route — добираем запись
      await ensureRouteRow(prisma, { routeId })
      route = await prisma.route.findUnique({
        where: { id: routeId },
        include: { orders: { orderBy: routeOrdersOrderBy } },
      })
    }

    if (!route) {
      return NextResponse.json(
        { success: false, error: "Маршрут не найден" },
        { status: 404 },
      )
    }

    const orders = route.orders
    const assignedDriverId = route.driverId
    const assignedVehicleId = route.vehicleId

    const pendingOrders = (orders as (RouteOrderLike & { id: string })[]).filter(
      (o) => !["delivered", "cancelled", "rejected"].includes(o.status),
    )

    if (pendingOrders.length > 0 && !force) {
      return NextResponse.json(
        {
          success: false,
          error: "Не все точки маршрута завершены",
          pendingOrders: pendingOrders.map((o) => ({
            id: o.id,
            from: o.routeFrom,
            to: o.routeTo,
            status: o.status,
          })),
        },
        { status: 400 },
      )
    }

    const now = new Date()

    await prisma.$transaction(async (tx) => {
      if (force && pendingOrders.length > 0) {
        await tx.order.updateMany({
          where: { id: { in: pendingOrders.map((o) => o.id) } },
          data: { status: "delivered", updatedAt: now },
        })
      }

      // статус + время финиша + событие в таймлайн
      const transition = await changeRouteStatus(tx, routeId, {
        status: "completed",
        completedAt: now,
        reason: force && pendingOrders.length > 0 ? "Завершён принудительно" : "Рейс завершён",
        actorName: auth.value.kind === "driver" ? auth.value.driver.name : auth.value.user.name,
      })
      if (!transition.ok) throw new Error(transition.error)

      // пересчёт итогов рейса по заказам
      const summary = await recalcRoute(tx, routeId)

      if (assignedDriverId) {
        const otherActiveOrders = await tx.order.count({
          where: {
            assignedDriverId,
            routeId: { not: routeId },
            status: { in: [...OCCUPYING_ORDER_STATUSES] },
          },
        })

        if (otherActiveOrders === 0) {
          await tx.driver.update({
            where: { id: assignedDriverId },
            data: { status: "available" },
          })
        }

        await tx.driverShift.updateMany({
          where: { driverId: assignedDriverId, endedAt: null },
          data: { endedAt: now, status: "completed" },
        })

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
          data: { ordersCompleted: { increment: summary.deliveredOrders } },
        })
      }

      if (assignedVehicleId) {
        const otherActiveOrders = await tx.order.count({
          where: {
            assignedVehicleId,
            routeId: { not: routeId },
            status: { in: [...OCCUPYING_ORDER_STATUSES] },
          },
        })

        if (otherActiveOrders === 0) {
          await tx.vehicle.update({
            where: { id: assignedVehicleId },
            data: { status: "available" },
          })
        }
      }
    })

    const updated = await prisma.route.findUnique({ where: { id: routeId } })
    const finalOrders = (await prisma.order.findMany({
      where: { routeId },
      orderBy: routeOrdersOrderBy,
    })) as (RouteOrderLike & { id: string })[]

    return NextResponse.json({
      success: true,
      message: "Рейс завершён",
      route: updated ? serializeRoute(updated) : null,
      stats: {
        ordersCount: finalOrders.length,
        totalDistance: finalOrders.reduce((sum, o) => sum + (o.distance || 0), 0),
        totalWeight: finalOrders.reduce((sum, o) => sum + (o.weight || 0), 0),
        totalRevenue: finalOrders
          .filter((o) => o.status !== "cancelled" && o.status !== "rejected")
          .reduce((sum, o) => sum + (o.price || 0), 0),
        additionalLoads: finalOrders.filter((o) => o.isAdditionalLoad).length,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route Complete] Error:", message)

    // доменная ошибка (недопустимый переход статуса) — это 409, а не 500
    if (/статус|Рейс в статусе|Нельзя перевести/i.test(message)) {
      return NextResponse.json({ success: false, error: message }, { status: 409 })
    }

    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
