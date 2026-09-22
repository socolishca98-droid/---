// app/api/drivers/locations/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;


  try {
    const [allDrivers, activeShifts, activeOrders] = await Promise.all([
      prisma.driver.findMany({
        orderBy: { name: "asc" },
      }),
      prisma.driverShift.findMany({
        where: { endedAt: null },
        select: {
          id: true,
          driverId: true,
          status: true,
          startedAt: true,
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
          status: true,
          routeFrom: true,
          routeTo: true,
          cargoType: true,
          price: true,
          assignedDriverId: true,
        },
      }),
    ])

    const shiftMap = new Map(
      activeShifts.map((s: any) => [s.driverId, s]),
    )

    const orderMap = new Map<string, (typeof activeOrders)[number]>()
    activeOrders.forEach((o: any) => {
      if (o.assignedDriverId && !orderMap.has(o.assignedDriverId)) {
        orderMap.set(o.assignedDriverId, o)
      }
    })

    const now = Date.now()

    const drivers = allDrivers.map((driver: any) => {
      const shift = shiftMap.get(driver.id) as any
      const order = orderMap.get(driver.id)

      const hasActiveOrder = !!order

      let uiStatus: string
      if (driver.status === "maintenance") {
        uiStatus = "maintenance"
      } else if ((shift as any)?.status) {
        // Статус берется напрямую из мобильного приложения водителя (смена)
        uiStatus = (shift as any).status
      } else if (hasActiveOrder) {
        uiStatus = "busy"
      } else if (driver.status === "offline") {
        uiStatus = "offline"
      } else {
        uiStatus = "available"
      }

      let statusDuration = 0
      if ((shift as any)?.lastStatusChangeAt) {
        statusDuration = Math.floor((now - (shift as any).lastStatusChangeAt.getTime()) / 1000)
      }

      return {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        latitude: driver.latitude,
        longitude: driver.longitude,
        status: uiStatus,
        rawStatus: driver.status,
        statusDuration,
        vehiclePlate: driver.vehiclePlate,
        vehicleType: driver.vehicleType,
        currentLocation: driver.currentLocation,
        hasOrder: hasActiveOrder,
        routeFrom: (order as any)?.routeFrom || null,
        routeTo: (order as any)?.routeTo || null,
        cargoType: (order as any)?.cargoType || null,
        orderPrice: (order as any)?.price || null,
      }
    })

    const online = drivers.filter((d: any) => d.status !== "offline" && d.latitude != null).length
    const inRoute = drivers.filter((d: any) =>
      ["driving", "in_transit", "loading", "unloading", "busy"].includes(d.status),
    ).length

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [completedToday, newToday, totalOrders, activeOrdersCount] = await Promise.all([
      prisma.order.count({
        where: {
          status: "delivered",
          updatedAt: { gte: todayStart },
        },
      }),
      prisma.order.count({
        where: {
          createdAt: { gte: todayStart },
        },
      }),
      prisma.order.count(),
      prisma.order.count({
        where: {
          status: { in: ACTIVE_ORDER_STATUSES as any },
        },
      }),
    ])

    return NextResponse.json({
      success: true,
      drivers,
      stats: {
        online,
        inRoute,
        total: allDrivers.length,
        orders: {
          total: totalOrders,
          active: activeOrdersCount,
          completedToday,
          newToday,
        },
        revenue: 0,
        alerts: 0,
      },
    })
  } catch (error: any) {
    console.warn("[Drivers Locations] Safe fallback notice:", error?.message || error)
    return NextResponse.json(
      { 
        success: false, 
        error: error?.message || "Unknown error", 
        drivers: [], 
        stats: {
          online: 0,
          inRoute: 0,
          total: 0,
          orders: { total: 0, active: 0, completedToday: 0, newToday: 0 },
          revenue: 0,
          alerts: 0,
        }
      },
      { status: 200 },
    )
  }
}