// app/api/fleet/route.ts
// (обновлённая версия с nextAvailableAt для машин)

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_transit", "loading", "unloading"] as const

export async function GET(_req: NextRequest) {
  try {
    const [drivers, vehicles, activeShifts, activeOrders] = await Promise.all([
      prisma.driver.findMany({
        orderBy: { name: "asc" },
      }),
      prisma.vehicle.findMany({
        orderBy: [{ status: "asc" }, { plate: "asc" }],
      }),
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
        },
        select: {
          id: true,
          status: true,
          assignedDriverId: true,
          assignedVehicleId: true,
          deadline: true,
        },
      }),
    ])

    const shiftByDriver = new Map(
      activeShifts.map((s) => [s.driverId, s]),
    )

    const activeOrdersByDriver = new Map<string, typeof activeOrders>()
    const activeOrdersByVehicle = new Map<string, typeof activeOrders>()

    for (const o of activeOrders) {
      if (o.assignedDriverId) {
        const list = activeOrdersByDriver.get(o.assignedDriverId) || []
        activeOrdersByDriver.set(o.assignedDriverId, [...list, o])
      }
      if (o.assignedVehicleId) {
        const list = activeOrdersByVehicle.get(o.assignedVehicleId) || []
        activeOrdersByVehicle.set(o.assignedVehicleId, [...list, o])
      }
    }

    const now = Date.now()

    const driversOut = drivers.map((d) => {
      const shift = shiftByDriver.get(d.id)
      const driverOrders = activeOrdersByDriver.get(d.id) || []
      const hasActiveOrder = driverOrders.length > 0

      let uiStatus: string
      if (d.status === "maintenance") {
        uiStatus = "maintenance"
      } else if (hasActiveOrder) {
        const shiftStatus = shift?.status
        if (
          shiftStatus === "driving" ||
          shiftStatus === "loading" ||
          shiftStatus === "unloading"
        ) {
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
        statusDuration = Math.floor(
          (now - shift.lastStatusChangeAt.getTime()) / 1000,
        )
      }

      const vehicle = vehicles.find((v) => v.id === d.vehicleId)

      return {
        ...d,
        status: uiStatus,
        rawStatus: d.status,
        hasActiveOrder,
        shiftStatus: shift?.status ?? null,
        shiftId: shift?.id ?? null,
        statusDuration,
        vehicle: vehicle
          ? { id: vehicle.id, plate: vehicle.plate, type: vehicle.type }
          : null,
      }
    })

    const vehiclesOut = vehicles.map((v) => {
      const vehicleOrders = activeOrdersByVehicle.get(v.id) || []
      const hasActiveOrder = vehicleOrders.length > 0

      let uiStatus: string
      if (v.status === "maintenance") {
        uiStatus = "maintenance"
      } else if (hasActiveOrder) {
        uiStatus = "in_use"
      } else {
        uiStatus = "available"
      }

      // nextAvailableAt: берём максимум по deadline активных заказов,
      // иначе null
      let nextAvailableAt: string | null = null
      if (vehicleOrders.length > 0) {
        const maxDeadline = vehicleOrders.reduce<Date | null>((max, o) => {
          if (!o.deadline) return max
          if (!max) return o.deadline
          return o.deadline.getTime() > max.getTime() ? o.deadline : max
        }, null)
        if (maxDeadline) {
          nextAvailableAt = maxDeadline.toISOString()
        }
      }

      const driver = driversOut.find((d) => d.vehicleId === v.id || d.id === v.driverId)

      return {
        ...v,
        status: uiStatus,
        rawStatus: v.status,
        hasActiveOrder,
        nextAvailableAt,
        driver: driver
          ? {
              id: driver.id,
              name: driver.name,
              phone: driver.phone,
              status: driver.status,
            }
          : null,
      }
    })

    const vehicleStats = {
      total: vehiclesOut.length,
      available: vehiclesOut.filter((v) => v.status === "available").length,
      inUse: vehiclesOut.filter((v) => v.status === "in_use").length,
      maintenance: vehiclesOut.filter((v) => v.status === "maintenance").length,
    }

    const driverStats = {
      total: driversOut.length,
      available: driversOut.filter((d) => d.status === "available").length,
      busy: driversOut.filter((d) =>
        ["busy", "driving", "loading", "unloading"].includes(d.status),
      ).length,
      maintenance: driversOut.filter((d) => d.status === "maintenance").length,
      online: driversOut.filter((d) => d.status !== "offline").length,
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
      drivers: driversOut,
      vehicles: vehiclesOut,
      stats: {
        vehicleStats,
        driverStats,
        orders: {
          total: totalOrders,
          active: activeOrdersCount,
          completedToday,
        },
      },
    })
  } catch (error: any) {
    console.error("[Fleet API] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Fleet API error" },
      { status: 500 },
    )
  }
}