// app/api/drivers/[id]/active-order/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { OCCUPYING_ORDER_STATUSES } from "@/lib/orders/stages"

// Заказ занимает водителя/машину, пока он в рейсе, на документах, назначен или на контроле
// (канон жизненного цикла заказа — lib/orders/stages.ts)
const ACTIVE_ORDER_STATUSES = OCCUPYING_ORDER_STATUSES

type RouteParams = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    // ✅ Next.js 15+ требует await для params
    const { id: driverId } = await params

    if (!driverId) {
      return NextResponse.json(
        { success: false, error: "Driver ID is required" },
        { status: 400 }
      )
    }

    // Водитель должен быть из организации вызывающего: чужой id даёт 404
    const driver = await prisma.driver.findFirst({
      where: scopedWhere(__org.organizationId, { id: driverId }),
      select: { id: true },
    })
    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден" },
        { status: 404 }
      )
    }

    // Получаем первый активный заказ
    const activeOrder = await prisma.order.findFirst({
      where: scopedWhere(__org.organizationId, {
        assignedDriverId: driverId,
        status: { in: [...ACTIVE_ORDER_STATUSES] },
      }),
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
        where: scopedWhere(__org.organizationId, {
          routeId: activeOrder.routeId,
        }),
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