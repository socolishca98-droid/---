// app/api/fleet/stats/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

export async function GET(_request: NextRequest) {
  try {
    const [vehicles, drivers] = await Promise.all([
      prisma.vehicle.findMany(),
      prisma.driver.findMany(),
    ])

    const vehicleStats = {
      total: vehicles.length,
      available: vehicles.filter((v) => v.status === "available").length,
      inUse: vehicles.filter((v) => v.status === "in_use").length,
      maintenance: vehicles.filter((v) => v.status === "maintenance").length,
    }

    const driverStats = {
      total: drivers.length,
      available: drivers.filter((d) => d.status === "available").length,
      busy: drivers.filter((d) => d.status === "busy").length,
      maintenance: drivers.filter((d) => d.status === "maintenance").length,
    }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [activeOrdersCount, completedToday, totalOrders] = await Promise.all([
      prisma.order.count({
        where: { status: { in: ACTIVE_ORDER_STATUSES as any } },
      }),
      prisma.order.count({
        where: { status: "delivered", updatedAt: { gte: todayStart } },
      }),
      prisma.order.count(),
    ])

    return NextResponse.json({
      success: true,
      vehicleStats,
      driverStats,
      orders: {
        total: totalOrders,
        active: activeOrdersCount,
        completedToday,
      },
    })
  } catch (error: any) {
    console.error("[Fleet Stats] GET Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Fleet stats error" },
      { status: 500 },
    )
  }
}