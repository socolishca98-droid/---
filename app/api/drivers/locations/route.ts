// app/api/drivers/locations/route.ts

import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

export async function GET() {
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
      activeShifts.map((s) => [s.driverId, s]),
    )

    const orderMap = new Map<string, (typeof activeOrders)[number]>()
    activeOrders.forEach((o) => {
      if (o.assignedDriverId && !orderMap.has(o.assignedDriverId)) {
        orderMap.set(o.assignedDriverId, o)
      }
    })

    const now = Date.now()

    const drivers = allDrivers.map((driver) => {
      const shift = shiftMap.get(driver.id)
      const order = orderMap.get(driver.id)

      const hasActiveOrder = !!order

      let uiStatus: string
      if (driver.status === "maintenance") {
        uiStatus = "maintenance"
      } else if (hasActiveOrder) {
        const shiftStatus = shift?.status
        if (shiftStatus === "driving" || shiftStatus === "loading" || shiftStatus === "unloading") {
          uiStatus = shiftStatus
        } else {
          uiStatus = "busy"
        }
      } else if (!shift) {
        uiStatus = "offline"
      } else {
        uiStatus = "available"
      }

      let statusDuration = 0
      if (shift?.lastStatusChangeAt) {
        statusDuration = Math.floor((now - shift.lastStatusChangeAt.getTime()) / 1000)
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
        routeFrom: order?.routeFrom || null,
        routeTo: order?.routeTo || null,
        cargoType: order?.cargoType || null,
        orderPrice: order?.price || null,
      }
    })

    const online = drivers.filter((d) => d.status !== "offline" && d.latitude != null).length
    const inRoute = drivers.filter((d) =>
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
    console.error("[Drivers Locations] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message, drivers: [], stats: {} },
      { status: 500 },
    )
  }
}