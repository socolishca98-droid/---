// app/api/dashboard/stats/route.ts
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { OCCUPYING_ORDER_STATUSES } from "@/lib/orders/stages"

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      totalOrders,
      activeOrders,
      completedTodayOrders,
      ordersRevenue,
      vehicles,
      drivers,
      activeRoutes,
      completedRoutes,
    ] = await Promise.all([
      prisma.order.count({ where: scopedWhere(__org.organizationId) }),
      prisma.order.count({
        where: scopedWhere(__org.organizationId, {
          // заказы в работе: канон — lib/orders/stages.ts
          status: { in: [...OCCUPYING_ORDER_STATUSES] },
        }),
      }),
      prisma.order.count({
        where: scopedWhere(__org.organizationId, {
          status: "delivered",
          updatedAt: { gte: today },
        }),
      }),
      prisma.order.aggregate({
        _sum: { price: true },
        where: scopedWhere(__org.organizationId, {
          // выручка = доставленные + те, что ещё в работе
          status: { in: [...OCCUPYING_ORDER_STATUSES, "delivered"] },
        }),
      }),
      prisma.vehicle.findMany({
        where: scopedWhere(__org.organizationId),
        select: { status: true },
      }),
      prisma.driver.findMany({
        where: scopedWhere(__org.organizationId),
        select: { status: true, latitude: true, longitude: true },
      }),
      prisma.route.count({
        where: scopedWhere(__org.organizationId, {
          status: { in: ["active", "in_transit"] },
        }),
      }),
      prisma.route.count({
        where: scopedWhere(__org.organizationId, { status: "completed" }),
      }),
    ])


    const totalVehicles = vehicles.length
    const availableVehicles = vehicles.filter((v: any) => v.status === "available").length
    const inUseVehicles = vehicles.filter((v: any) => v.status === "in_use" || v.status === "busy").length
    const maintenanceVehicles = vehicles.filter((v: any) => v.status === "maintenance").length

    const totalDrivers = drivers.length
    const busyDrivers = drivers.filter((d: any) => d.status === "busy" || d.status === "driving").length
    const availableDrivers = drivers.filter((d: any) => d.status === "available").length
    const onlineDrivers = drivers.filter((d: any) => d.status !== "offline").length

    const vehicleUtilization = totalVehicles > 0 ? Math.round((inUseVehicles / totalVehicles) * 100) : 0

    return NextResponse.json({
      success: true,
      stats: {
        totalOrders,
        activeOrders,
        completedToday: completedTodayOrders,
        revenue: ordersRevenue._sum.price || 0,
        vehicleUtilization,
        orders: {
          total: totalOrders,
          active: activeOrders,
          completedToday: completedTodayOrders,
          newToday: totalOrders,
        },
        fleet: {
          total: totalVehicles,
          available: availableVehicles,
          inUse: inUseVehicles,
          maintenance: maintenanceVehicles,
        },
        drivers: {
          total: totalDrivers,
          online: onlineDrivers,
          busy: busyDrivers,
          available: availableDrivers,
        },
        routes: {
          active: activeRoutes,
          completed: completedRoutes,
        },
      },
    })
  } catch (error: any) {
    console.error("[Dashboard Stats] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load dashboard stats" },
      { status: 500 },
    )
  }
}
