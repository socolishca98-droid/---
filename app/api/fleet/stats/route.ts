// app/api/fleet/stats/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

export async function GET(_request: NextRequest) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const [vehicles, drivers] = await Promise.all([
      prisma.vehicle.findMany({ where: scopedWhere(__org.organizationId) }),
      prisma.driver.findMany({ where: scopedWhere(__org.organizationId) }),
    ])

    const vehicleStats = {
      total: vehicles.length,
      available: vehicles.filter((v: any) => v.status === "available").length,
      inUse: vehicles.filter((v: any) => v.status === "in_use").length,
      maintenance: vehicles.filter((v: any) => v.status === "maintenance").length,
    }

    const driverStats = {
      total: drivers.length,
      available: drivers.filter((d: any) => d.status === "available").length,
      busy: drivers.filter((d: any) => d.status === "busy").length,
      maintenance: drivers.filter((d: any) => d.status === "maintenance").length,
    }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [activeOrdersCount, completedToday, totalOrders] = await Promise.all([
      prisma.order.count({
        where: scopedWhere(__org.organizationId, { status: { in: ACTIVE_ORDER_STATUSES as any } }),
      }),
      prisma.order.count({
        where: scopedWhere(__org.organizationId, {
          status: "delivered",
          updatedAt: { gte: todayStart },
        }),
      }),
      prisma.order.count({ where: scopedWhere(__org.organizationId) }),
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