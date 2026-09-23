// app/api/fleet/drivers/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;


  try {
    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get("status") || undefined // UI-статус: available | busy | maintenance | offline | driving/loading/unloading

    const [drivers, vehicles, activeShifts, activeOrders] = await Promise.all([
      prisma.driver.findMany({
        orderBy: { name: "asc" },
      }),
      prisma.vehicle.findMany(),
      prisma.driverShift.findMany({
        where: { endedAt: null },
        select: {
          id: true,
          driverId: true,
          status: true,
          lastStatusChangeAt: true,
        },
      }),
      prisma.order.findMany({
        where: {
          status: { in: ACTIVE_ORDER_STATUSES as any },
          assignedDriverId: { not: null },
        },
        select: {
          id: true,
          assignedDriverId: true,
        },
      }),
    ])

    const shiftByDriver = new Map(
      activeShifts.map((s: any) => [s.driverId, s]),
    )

    const activeOrdersByDriver = new Map<string, number>()
    for (const o of activeOrders) {
      if (o.assignedDriverId) {
        activeOrdersByDriver.set(
          o.assignedDriverId,
          (activeOrdersByDriver.get(o.assignedDriverId) || 0) + 1,
        )
      }
    }

    const now = Date.now()

    const driversOut = drivers.map((d: any) => {
      const shift = shiftByDriver.get(d.id) as any
      const hasActiveOrder = (activeOrdersByDriver.get(d.id) || 0) > 0

      let uiStatus: string
      if (d.status === "maintenance") {
        uiStatus = "maintenance"
      } else if ((shift as any)?.status) {
        // Статус из мобильного приложения водителя
        uiStatus = (shift as any).status
      } else if (hasActiveOrder) {
        uiStatus = "busy"
      } else if (d.status === "offline") {
        uiStatus = "offline"
      } else {
        uiStatus = "available"
      }

      let statusDuration = 0
      if ((shift as any)?.lastStatusChangeAt) {
        statusDuration = Math.floor(
          (now - (shift as any).lastStatusChangeAt.getTime()) / 1000,
        )
      }

      const vehicle = (vehicles as any).find((v: any) => v.id === d.vehicleId)

      return {
        ...d,
        status: uiStatus, // UI-статус
        rawStatus: d.status, // что в БД
        hasActiveOrder,
        shiftStatus: (shift as any)?.status ?? null,
        shiftId: shift?.id ?? null,
        statusDuration,
        vehicle: vehicle
          ? { id: (vehicle as any).id, plate: (vehicle as any).plate, type: (vehicle as any).type }
          : null,
      }
    })

    const filtered =
      statusFilter && statusFilter !== "all"
        ? driversOut.filter((d: any) => d.status === statusFilter)
        : driversOut

    return NextResponse.json({ success: true, drivers: filtered })
  } catch (error: any) {
    console.error("[Fleet Drivers] GET error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Fleet drivers error" },
      { status: 500 },
    )
  }
}