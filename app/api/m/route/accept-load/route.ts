// app/api/m/route/accept-load/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, driverId, accept, rejectionReason } = body as {
      orderId: string
      driverId: string
      accept: boolean
      rejectionReason?: string
    }

    if (!orderId || !driverId) {
      return NextResponse.json(
        { success: false, error: "orderId и driverId обязательны" },
        { status: 400 },
      )
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    })

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 },
      )
    }

    if (order.assignedDriverId !== driverId) {
      return NextResponse.json(
        { success: false, error: "Заказ назначен другому водителю" },
        { status: 403 },
      )
    }

    if (!order.proposedToDriver) {
      return NextResponse.json(
        { success: false, error: "Заказ не требует подтверждения" },
        { status: 400 },
      )
    }

    if (accept) {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: "confirmed",
          proposedToDriver: false,
          acceptedAt: new Date(),
        },
      })

      // Событие "догруз принят"
      try {
        if (order.routeId) {
          await prisma.routeEvent.create({
            data: {
              routeId: order.routeId,
              driverId,
              vehicleId: order.assignedVehicleId || null,
              orderId: order.id,
              type: "status",
              status: "load_accepted",
              latitude: null,
              longitude: null,
              address: null,
              data: null,
            },
          })
        }
      } catch (e) {
        console.error("[Accept Load] routeEvent accept error:", e)
      }

      return NextResponse.json({
        success: true,
        message: "Догруз принят",
      })
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: "rejected",
            proposedToDriver: false,
            rejectedAt: new Date(),
            rejectionReason: rejectionReason || "Отклонено водителем",
          },
        })

        await tx.notification.create({
          data: {
            userId: "logist",
            userRole: "logist",
            type: "load_rejected",
            title: "Догруз отклонён",
            message: `Водитель отклонил: ${order.routeFrom} → ${order.routeTo}. Причина: ${rejectionReason || "Не указана"}`,
            orderId: order.id,
            routeId: order.routeId,
            priority: "high",
          },
        })
      })

      // Событие "догруз отклонён"
      try {
        if (order.routeId) {
          await prisma.routeEvent.create({
            data: {
              routeId: order.routeId,
              driverId,
              vehicleId: order.assignedVehicleId || null,
              orderId: order.id,
              type: "status",
              status: "load_rejected",
              latitude: null,
              longitude: null,
              address: null,
              data: rejectionReason
                ? JSON.stringify({ rejectionReason })
                : null,
            },
          })
        }
      } catch (e) {
        console.error("[Accept Load] routeEvent reject error:", e)
      }

      return NextResponse.json({
        success: true,
        message: "Догруз отклонён",
      })
    }
  } catch (error: any) {
    console.error("[Accept Load] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    )
  }
}