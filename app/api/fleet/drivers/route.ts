// app/api/fleet/drivers/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

export async function GET(request: NextRequest) {
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
      activeShifts.map((s) => [s.driverId, s]),
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

    const driversOut = drivers.map((d) => {
      const shift = shiftByDriver.get(d.id)
      const hasActiveOrder = (activeOrdersByDriver.get(d.id) || 0) > 0

      let uiStatus: string
      if (d.status === "maintenance") {
        uiStatus = "maintenance"
      } else if (shift?.status) {
        // Статус из мобильного приложения водителя
        uiStatus = shift.status
      } else if (hasActiveOrder) {
        uiStatus = "busy"
      } else if (d.status === "offline") {
        uiStatus = "offline"
      } else {
        uiStatus = "available"
      }

      let statusDuration = 0
      if (shift?.lastStatusChangeAt) {
        statusDuration = Math.floor(
          (now - shift.lastStatusChangeAt.getTime()) / 1000,
        )
      }

      const vehicle = vehicles.find((v) => v.id === d.vehicleId)

      return {
        ...d,
        status: uiStatus, // UI-статус
        rawStatus: d.status, // что в БД
        hasActiveOrder,
        shiftStatus: shift?.status ?? null,
        shiftId: shift?.id ?? null,
        statusDuration,
        vehicle: vehicle
          ? { id: vehicle.id, plate: vehicle.plate, type: vehicle.type }
          : null,
      }
    })

    const filtered =
      statusFilter && statusFilter !== "all"
        ? driversOut.filter((d) => d.status === statusFilter)
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