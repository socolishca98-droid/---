// app/api/orders/[id]/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

type RouteParams = {
  params: Promise<{ id: string }>
}

// GET /api/orders/[id]
export async function GET(_request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Order ID is required" },
        { status: 400 }
      )
    }

    // чужой заказ не отличим от несуществующего: ищем внутри своей организации
    const order = await prisma.order.findFirst({
      where: scopedWhere(__org.organizationId, { id }),
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
export async function PATCH(request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Order ID is required" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { status, assignedDriverId, assignedVehicleId, ...other } = body as {
      status?: string
      assignedDriverId?: string | null
      assignedVehicleId?: string | null
      [key: string]: unknown
    }

    const existing = await prisma.order.findFirst({
      where: scopedWhere(__org.organizationId, { id }),
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

    // Назначить заказу можно только своего водителя и свою машину
    if (assignedDriverId) {
      const driver = await prisma.driver.findFirst({
        where: scopedWhere(__org.organizationId, { id: assignedDriverId }),
        select: { id: true },
      })
      if (!driver) {
        return NextResponse.json(
          { success: false, error: "Водитель не найден" },
          { status: 404 }
        )
      }
    }
    if (assignedVehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: scopedWhere(__org.organizationId, { id: assignedVehicleId }),
        select: { id: true },
      })
      if (!vehicle) {
        return NextResponse.json(
          { success: false, error: "Машина не найдена" },
          { status: 404 }
        )
      }
    }

    const wasActive = ACTIVE_ORDER_STATUSES.includes(existing.status as typeof ACTIVE_ORDER_STATUSES[number])
    const willBeActive = status 
      ? ACTIVE_ORDER_STATUSES.includes(status as typeof ACTIVE_ORDER_STATUSES[number]) 
      : wasActive
    const isCompleting = status === "delivered" || status === "cancelled" || status === "rejected"

    const updatedOrder = await prisma.$transaction(async (tx: any) => {
      // org-audit: ok — id заказа проверен на принадлежность организации выше
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
            where: scopedWhere(__org.organizationId, {
              assignedDriverId: driverId,
              status: { in: [...ACTIVE_ORDER_STATUSES] },
              id: { not: order.id },
            }),
          })
          if (otherActive === 0) {
            await tx.driver.updateMany({
              where: scopedWhere(__org.organizationId, { id: driverId }),
              data: { status: "available" },
            })
          }
        }

        if (vehicleId) {
          const otherActive = await tx.order.count({
            where: scopedWhere(__org.organizationId, {
              assignedVehicleId: vehicleId,
              status: { in: [...ACTIVE_ORDER_STATUSES] },
              id: { not: order.id },
            }),
          })
          if (otherActive === 0) {
            await tx.vehicle.updateMany({
              where: scopedWhere(__org.organizationId, { id: vehicleId }),
              data: { status: "available" },
            })
          }
        }
      }

      // Если заказ стал активным – проставляем busy/in_use
      if (!wasActive && willBeActive) {
        if (driverId) {
          await tx.driver.updateMany({
            where: scopedWhere(__org.organizationId, { id: driverId }),
            data: { status: "busy" },
          })
        }
        if (vehicleId) {
          await tx.vehicle.updateMany({
            where: scopedWhere(__org.organizationId, { id: vehicleId }),
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
export async function DELETE(_request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Order ID is required" },
        { status: 400 }
      )
    }

    const existing = await prisma.order.findFirst({
      where: scopedWhere(__org.organizationId, { id }),
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

    await prisma.$transaction(async (tx: any) => {
      // deleteMany с фильтром организации: чужой заказ удалить нельзя
      await tx.order.deleteMany({ where: scopedWhere(__org.organizationId, { id }) })

      if (wasActive) {
        if (existing.assignedDriverId) {
          const otherActive = await tx.order.count({
            where: scopedWhere(__org.organizationId, {
              assignedDriverId: existing.assignedDriverId,
              status: { in: [...ACTIVE_ORDER_STATUSES] },
            }),
          })
          if (otherActive === 0) {
            await tx.driver.updateMany({
              where: scopedWhere(__org.organizationId, { id: existing.assignedDriverId }),
              data: { status: "available" },
            })
          }
        }

        if (existing.assignedVehicleId) {
          const otherActive = await tx.order.count({
            where: scopedWhere(__org.organizationId, {
              assignedVehicleId: existing.assignedVehicleId,
              status: { in: [...ACTIVE_ORDER_STATUSES] },
            }),
          })
          if (otherActive === 0) {
            await tx.vehicle.updateMany({
              where: scopedWhere(__org.organizationId, { id: existing.assignedVehicleId }),
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