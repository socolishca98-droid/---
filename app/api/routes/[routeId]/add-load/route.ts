// app/api/routes/[routeId]/add-load/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

type RouteParams = {
  params: Promise<{ routeId: string }>
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
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

    const existingOrders = await prisma.order.findMany({
      where: {
        routeId,
        status: { in: ["confirmed", "in_transit", "loading", "unloading"] },
      },
      orderBy: { routeSequence: "asc" },
    })

    if (existingOrders.length === 0) {
      return NextResponse.json(
        { success: false, error: "Активный маршрут не найден" },
        { status: 404 }
      )
    }

    const driverId = existingOrders[0].assignedDriverId
    const vehicleId = existingOrders[0].assignedVehicleId

    if (vehicleId) {
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
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
          where: {
            routeId,
            routeSequence: { gte: routeSequence },
          },
          data: {
            routeSequence: { increment: 1 },
          },
        })
      }
    }

    const newOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
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

    return NextResponse.json({
      success: true,
      order: newOrder,
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