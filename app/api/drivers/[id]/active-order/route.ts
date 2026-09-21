// app/api/drivers/[id]/active-order/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { forbidden, isSelfOrStaff, requireAnySession } from "@/lib/auth/session"
const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

type RouteParams = {
  params: Promise<{ id: string }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  try {
    // ✅ Next.js 15+ требует await для params
    const { id: driverId } = await params

    if (!driverId) {
      return NextResponse.json(
        { success: false, error: "Driver ID is required" },
        { status: 400 }
      )
    }

    // Водитель видит только свой активный заказ
    if (!isSelfOrStaff(auth.value, driverId)) {
      return forbidden("Недостаточно прав для просмотра этого водителя")
    }

    // Получаем первый активный заказ
    const activeOrder = await prisma.order.findFirst({
      where: {
        assignedDriverId: driverId,
        status: { in: [...ACTIVE_ORDER_STATUSES] },
      },
      orderBy: [
        { routeSequence: "asc" },
        { createdAt: "asc" },
      ],
    })

    if (!activeOrder) {
      return NextResponse.json({
        success: true,
        order: null,
        allRouteOrders: [],
      })
    }

    // Если есть routeId – получаем все заказы маршрута
    let allRouteOrders: typeof activeOrder[] = []

    if (activeOrder.routeId) {
      allRouteOrders = await prisma.order.findMany({
        where: {
          routeId: activeOrder.routeId,
        },
        orderBy: [
          { routeSequence: "asc" },
          { createdAt: "asc" },
        ],
      })
    } else {
      allRouteOrders = [activeOrder]
    }

    return NextResponse.json({
      success: true,
      order: activeOrder,
      allRouteOrders,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Active Order API] Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}