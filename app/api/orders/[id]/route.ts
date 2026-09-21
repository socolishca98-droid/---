// app/api/orders/[id]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { canDriverAccessOrder, forbidden, requireAnySession, requireStaff } from "@/lib/auth/session"
const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

type RouteParams = {
  params: Promise<{ id: string }>
}

// GET /api/orders/[id]
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Order ID is required" },
        { status: 400 }
      )
    }

    // Водитель читает только свой заказ
    if (!(await canDriverAccessOrder(auth.value, id))) {
      return forbidden("Заказ назначен другому водителю")
    }

    const order = await prisma.order.findUnique({
      where: { id },
    })

    if (!order) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, order })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order GET error"
    console.error("[Order API] GET Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// PATCH /api/orders/[id]
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Order ID is required" },
        { status: 400 }
      )
    }

    // Водитель меняет только свой заказ
    if (!(await canDriverAccessOrder(auth.value, id))) {
      return forbidden("Заказ назначен другому водителю")
    }

    const body = await request.json()
    const { status, assignedDriverId, assignedVehicleId, ...other } = body as {
      status?: string
      assignedDriverId?: string | null
      assignedVehicleId?: string | null
      [key: string]: unknown
    }

    // Назначение водителя и машины — решение логиста, водителю доступен только статус
    if (auth.value.kind === "driver") {
      const extraFields = Object.keys(body).filter((key) => key !== "status")
      if (extraFields.length > 0) {
        return forbidden(
          `Водителю доступно изменение только статуса заказа (лишние поля: ${extraFields.join(", ")})`
        )
      }
    }

    const existing = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        assignedDriverId: true,
        assignedVehicleId: true,
      },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 }
      )
    }

    const wasActive = ACTIVE_ORDER_STATUSES.includes(existing.status as typeof ACTIVE_ORDER_STATUSES[number])
    const willBeActive = status 
      ? ACTIVE_ORDER_STATUSES.includes(status as typeof ACTIVE_ORDER_STATUSES[number]) 
      : wasActive
    const isCompleting = status === "delivered" || status === "cancelled" || status === "rejected"

    const updatedOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id },
        data: {
          ...(status && { status }),
          ...(assignedDriverId !== undefined && { assignedDriverId }),
          ...(assignedVehicleId !== undefined && { assignedVehicleId }),
          ...other,
        },
      })

      const driverId = order.assignedDriverId
      const vehicleId = order.assignedVehicleId

      // Если заказ переходит из активного в неактивный – освобождаем ресурсы
      if (wasActive && isCompleting) {
        if (driverId) {
          const otherActive = await tx.order.count({
            where: {
              assignedDriverId: driverId,
              status: { in: [...ACTIVE_ORDER_STATUSES] },
              id: { not: order.id },
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
              status: { in: [...ACTIVE_ORDER_STATUSES] },
              id: { not: order.id },
            },
          })
          if (otherActive === 0) {
            await tx.vehicle.update({
              where: { id: vehicleId },
              data: { status: "available" },
            })
          }
        }
      }

      // Если заказ стал активным – проставляем busy/in_use
      if (!wasActive && willBeActive) {
        if (driverId) {
          await tx.driver.update({
            where: { id: driverId },
            data: { status: "busy" },
          })
        }
        if (vehicleId) {
          await tx.vehicle.update({
            where: { id: vehicleId },
            data: { status: "in_use" },
          })
        }
      }

      return order
    })

    return NextResponse.json({ success: true, order: updatedOrder })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order PATCH error"
    console.error("[Order API] PATCH Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// DELETE /api/orders/[id]
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Order ID is required" },
        { status: 400 }
      )
    }

    const existing = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        assignedDriverId: true,
        assignedVehicleId: true,
      },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Заказ не найден" },
        { status: 404 }
      )
    }

    const wasActive = ACTIVE_ORDER_STATUSES.includes(existing.status as typeof ACTIVE_ORDER_STATUSES[number])

    await prisma.$transaction(async (tx) => {
      await tx.order.delete({ where: { id } })

      if (wasActive) {
        if (existing.assignedDriverId) {
          const otherActive = await tx.order.count({
            where: {
              assignedDriverId: existing.assignedDriverId,
              status: { in: [...ACTIVE_ORDER_STATUSES] },
            },
          })
          if (otherActive === 0) {
            await tx.driver.update({
              where: { id: existing.assignedDriverId },
              data: { status: "available" },
            })
          }
        }

        if (existing.assignedVehicleId) {
          const otherActive = await tx.order.count({
            where: {
              assignedVehicleId: existing.assignedVehicleId,
              status: { in: [...ACTIVE_ORDER_STATUSES] },
            },
          })
          if (otherActive === 0) {
            await tx.vehicle.update({
              where: { id: existing.assignedVehicleId },
              data: { status: "available" },
            })
          }
        }
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order DELETE error"
    console.error("[Order API] DELETE Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}