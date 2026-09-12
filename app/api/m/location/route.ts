// app/api/m/location/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const ACTIVE_ORDER_STATUSES = [
  "confirmed",
  "in_transit",
  "loading",
  "unloading",
] as const

async function getActiveOrderForDriver(driverId: string) {
  return prisma.order.findFirst({
    where: {
      assignedDriverId: driverId,
      status: { in: ACTIVE_ORDER_STATUSES as any },
    },
    orderBy: { createdAt: "asc" },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    
    // Поддержка обоих вариантов именования
    const driverId = body.driverId
    const lat = typeof body.lat === "number" ? body.lat : body.latitude
    const lng = typeof body.lng === "number" ? body.lng : body.longitude

    if (!driverId || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json(
        { success: false, error: "driverId, lat, lng required" },
        { status: 400 },
      )
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 },
      )
    }

    const updated = await prisma.driver.update({
      where: { id: driverId },
      data: {
        latitude: lat,
        longitude: lng,
        lastGpsUpdate: new Date(),
      },
    })

    // Пишем событие локации в таймлайн (если есть активный маршрут)
    // Опционально можно писать не каждую точку, а раз в N минут/метров
    try {
      const activeOrder = await getActiveOrderForDriver(driverId)
      if (activeOrder?.routeId) {
        await prisma.routeEvent.create({
          data: {
            routeId: activeOrder.routeId,
            driverId,
            vehicleId: updated.vehicleId || null,
            orderId: activeOrder.id,
            type: "location",
            status: null,
            latitude: lat,
            longitude: lng,
            address: null,
            data: null,
          },
        })
      }
    } catch (e) {
      console.error("[m/location] routeEvent error:", e)
    }

    return NextResponse.json({ success: true, driver: updated })
  } catch (error: any) {
    console.error("[m/location] POST Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Location update error" },
      { status: 500 },
    )
  }
}