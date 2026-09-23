// app/api/m/route/accept-load/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { logRouteEvent } from "@/lib/routes/service"

export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  // Водитель отвечает только за себя: driverId из сессии, а не из тела запроса
  const driverId = auth.value.driver.id

  try {
    const body = await request.json()
    const { orderId, accept, rejectionReason } = body as {
      orderId: string
      accept: boolean
      rejectionReason?: string
    }

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "orderId обязателен" },
        { status: 400 },
      )
    }

    const order = await prisma.order.findFirst({
      where: scopedWhere(org.organizationId, { id: orderId }),
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
      await prisma.order.updateMany({
        where: scopedWhere(org.organizationId, { id: orderId }),
        data: {
          status: "confirmed",
          proposedToDriver: false,
          acceptedAt: new Date(),
        },
      })

      // Событие "догруз принят"
      try {
        if (order.routeId) {
          await logRouteEvent(prisma, {
            organizationId: org.organizationId,
            routeId: order.routeId,
            driverId,
            vehicleId: order.assignedVehicleId || null,
            orderId: order.id,
            type: "status",
            status: "load_accepted",
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
        await tx.order.updateMany({
          where: scopedWhere(org.organizationId, { id: orderId }),
          data: {
            status: "rejected",
            proposedToDriver: false,
            rejectedAt: new Date(),
            rejectionReason: rejectionReason || "Отклонено водителем",
          },
        })

        await tx.notification.create({
          data: {
            organizationId: org.organizationId,
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
          await logRouteEvent(prisma, {
            organizationId: org.organizationId,
            routeId: order.routeId,
            driverId,
            vehicleId: order.assignedVehicleId || null,
            orderId: order.id,
            type: "status",
            status: "load_rejected",
            data: rejectionReason ? JSON.stringify({ rejectionReason }) : null,
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