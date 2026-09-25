// app/api/fleet/vehicles/route.ts
//
// Список машин автопарка для диалогов назначения.
// Закрепление машины за водителем хранится только на стороне водителя
// (Driver.vehicleId), поэтому водитель подтягивается обратной связью
// Vehicle.drivers одним include — без N+1 запросов и без поля Vehicle.driverId
// (удалено из схемы в задаче 2).

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { OCCUPYING_ORDER_STATUSES } from "@/lib/routes/model"

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { searchParams } = new URL(request.url)
    const minCapacity = parseInt(searchParams.get("minCapacity") || "0", 10)
    // UI-статус: available | in_use | maintenance
    const statusFilter = searchParams.get("status") || undefined

    const where: Record<string, unknown> = {}
    if (!Number.isNaN(minCapacity) && minCapacity > 0) {
      where.capacity = { gte: minCapacity }
    }

    const [vehicles, activeOrders] = await Promise.all([
      prisma.vehicle.findMany({
        where: scopedWhere(org.organizationId, where),
        include: {
          drivers: {
            where: scopedWhere(org.organizationId, {}),
            select: { id: true, name: true, phone: true, status: true },
          },
        },
        orderBy: [{ status: "asc" }, { capacity: "asc" }],
        take: 100,
      }),
      prisma.order.findMany({
        where: scopedWhere(org.organizationId, {
          status: { in: [...OCCUPYING_ORDER_STATUSES] },
          assignedVehicleId: { not: null },
        }),
        select: { id: true, assignedVehicleId: true },
      }),
    ])

    // Подсчёт активных заказов по машине
    const activeOrdersByVehicle = new Map<string, number>()
    for (const o of activeOrders) {
      if (o.assignedVehicleId) {
        activeOrdersByVehicle.set(
          o.assignedVehicleId,
          (activeOrdersByVehicle.get(o.assignedVehicleId) || 0) + 1,
        )
      }
    }

    const vehiclesWithDrivers = vehicles.map((vehicle) => {
      const { drivers, ...v } = vehicle
      // машина закреплена максимум за одним водителем (гарантирует
      // lib/fleet/assignment.linkDriverToVehicle)
      const driver = drivers[0] ?? null

      const hasActiveOrder = (activeOrdersByVehicle.get(v.id) || 0) > 0

      // UI-статус машины:
      // maintenance → maintenance, есть активный заказ → in_use, иначе → available
      let uiStatus: string
      if (v.status === "maintenance") {
        uiStatus = "maintenance"
      } else if (hasActiveOrder) {
        uiStatus = "in_use"
      } else {
        uiStatus = "available"
      }

      return {
        ...v,
        status: uiStatus,
        rawStatus: v.status,
        hasActiveOrder,
        driver,
        // производное поле: форма ответа не меняется для клиентов
        driverId: driver?.id ?? null,
      }
    })

    const filtered =
      statusFilter && statusFilter !== "all"
        ? vehiclesWithDrivers.filter((v) => v.status === statusFilter)
        : vehiclesWithDrivers

    return NextResponse.json({
      success: true,
      vehicles: filtered,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fleet vehicles error"
    console.error("[Fleet Vehicles] Error:", message)
    return NextResponse.json(
      { success: false, error: message, vehicles: [] },
      { status: 500 },
    )
  }
}
