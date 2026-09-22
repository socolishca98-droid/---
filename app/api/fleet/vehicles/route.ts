// app/api/fleet/vehicles/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

export async function GET(req: NextRequest) {
  const __auth = await requireStaffAuth(req);
  if (__auth.error) return __auth.error;


  try {
    const { searchParams } = new URL(req.url)
    const minCapacity = parseInt(searchParams.get("minCapacity") || "0", 10)
    const statusFilter = searchParams.get("status") || undefined // UI-статус: available | in_use | maintenance

    // Базовый фильтр только по грузоподъёмности
    const where: any = {}
    if (!Number.isNaN(minCapacity) && minCapacity > 0) {
      where.capacity = { gte: minCapacity }
    }

    const [vehicles, activeOrders] = await Promise.all([
      prisma.vehicle.findMany({
        where,
        orderBy: [
          { status: "asc" },
          { capacity: "asc" },
        ],
        take: 100,
      }),
      prisma.order.findMany({
        where: {
          status: { in: ACTIVE_ORDER_STATUSES as any },
          assignedVehicleId: { not: null },
        },
        select: {
          id: true,
          assignedVehicleId: true,
        },
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

    const vehiclesWithDrivers = await Promise.all(
      vehicles.map(async (v: any) => {
        const driver = await prisma.driver.findFirst({
          where: { vehicleId: v.id },
          select: {
            id: true,
            name: true,
            phone: true,
            status: true,
          },
        })

        const hasActiveOrder =
          (activeOrdersByVehicle.get(v.id) || 0) > 0

        // UI-статус машины:
        // maintenance → maintenance
        // есть активный заказ → in_use
        // иначе → available
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
        }
      }),
    )

    const filtered =
      statusFilter && statusFilter !== "all"
        ? vehiclesWithDrivers.filter((v: any) => v.status === statusFilter)
        : vehiclesWithDrivers

    return NextResponse.json({
      success: true,
      vehicles: filtered,
    })
  } catch (error: any) {
    console.error("[Fleet Vehicles] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Fleet vehicles error",
        vehicles: [],
      },
      { status: 500 },
    )
  }
}