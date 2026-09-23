// app/api/routes/[routeId]/add-load/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { OCCUPYING_ORDER_STATUSES, type RouteOrderLike } from "@/lib/routes/model"
import { ensureRouteRow, recalcRoute } from "@/lib/routes/service"

type RouteParams = {
  params: Promise<{ routeId: string }>
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response
  try {
    const { routeId } = await params

    if (!routeId) {
      return NextResponse.json(
        { success: false, error: "Route ID is required" },
        { status: 400 }
      )
    }

    const body = await request.json()

    const {
      atiCacheId,
      routeFrom,
      routeTo,
      distance,
      weight,
      price,
      cargoType,
      clientName,
      clientContact,
      proposeToDriver = false,
      insertAfterOrderId,
    } = body

    const route = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: routeId }),
      select: { id: true, status: true, driverId: true, vehicleId: true },
    })

    const existingOrders = (await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        routeId,
        status: { in: [...OCCUPYING_ORDER_STATUSES] },
      }),
      orderBy: { routeSequence: "asc" },
    })) as (RouteOrderLike & {
      id: string
      assignedDriverId: string | null
      assignedVehicleId: string | null
      routeSequence: number | null
    })[]

    if (!route && existingOrders.length === 0) {
      return NextResponse.json(
        { success: false, error: "Активный маршрут не найден" },
        { status: 404 }
      )
    }

    if (route?.status === "cancelled" || route?.status === "completed") {
      return NextResponse.json(
        { success: false, error: "Рейс закрыт — догруз добавить нельзя" },
        { status: 409 }
      )
    }

    // исторический routeId без строки Route — добираем запись
    if (!route) {
      await ensureRouteRow(prisma, { organizationId: org.organizationId, routeId })
    }

    const driverId = route?.driverId ?? existingOrders[0]?.assignedDriverId ?? null
    const vehicleId = route?.vehicleId ?? existingOrders[0]?.assignedVehicleId ?? null

    if (vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: scopedWhere(org.organizationId, { id: vehicleId }),
        select: { capacity: true },
      })

      const currentWeight = existingOrders.reduce((sum, o) => sum + (o.weight || 0), 0)
      const newTotalWeight = currentWeight + (weight || 0)

      if (vehicle && newTotalWeight > vehicle.capacity) {
        return NextResponse.json(
          {
            success: false,
            error: "Превышена грузоподъёмность машины",
            details: {
              capacity: vehicle.capacity,
              currentWeight,
              newWeight: weight,
              overflow: newTotalWeight - vehicle.capacity,
            },
          },
          { status: 400 }
        )
      }
    }

    let routeSequence = existingOrders.length + 1

    if (insertAfterOrderId) {
      const insertAfterOrder = existingOrders.find((o) => o.id === insertAfterOrderId)
      if (insertAfterOrder?.routeSequence) {
        routeSequence = insertAfterOrder.routeSequence + 1

        await prisma.order.updateMany({
          where: scopedWhere(org.organizationId, {
            routeId,
            routeSequence: { gte: routeSequence },
          }),
          data: {
            routeSequence: { increment: 1 },
          },
        })
      }
    }

    const newOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          organizationId: org.organizationId,
          source: atiCacheId ? "ATI" : "manual",
          sourceId: atiCacheId || null,
          routeId,
          routeFrom,
          routeTo,
          distance: distance || 0,
          weight: weight || 0,
          cargoType: cargoType || "Груз",
          price: price || 0,
          clientName,
          clientContact: clientContact || "",
          status: proposeToDriver ? "proposed" : "confirmed",
          isAdditionalLoad: true,
          addedToRouteAt: new Date(),
          proposedToDriver: proposeToDriver,
          proposedAt: proposeToDriver ? new Date() : null,
          routeSequence,
          assignedDriverId: driverId,
          assignedVehicleId: vehicleId,
          deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      if (atiCacheId) {
        await tx.atiCache
          .update({
            where: { id: atiCacheId },
            data: { status: "imported" },
          })
          .catch(() => {})
      }

      if (driverId) {
        await tx.notification.create({
          data: {
            organizationId: org.organizationId,
            userId: driverId,
            userRole: "driver",
            type: proposeToDriver ? "load_proposal" : "load_added",
            title: proposeToDriver ? "Предложен догруз" : "Добавлен догруз",
            message: `${routeFrom} → ${routeTo}, ${((weight || 0) / 1000).toFixed(1)}т`,
            orderId: order.id,
            routeId,
            priority: "high",
          },
        })
      }

      return order
    })

    // итоги и имя рейса пересчитываются по его заказам
    const summary = await recalcRoute(prisma, routeId, org.organizationId)

    return NextResponse.json({
      success: true,
      order: newOrder,
      summary,
      message: proposeToDriver ? "Догруз предложен водителю" : "Догруз добавлен к маршруту",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Route Add Load] Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}