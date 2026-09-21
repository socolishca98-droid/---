// app/api/m/location/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireDriver } from "@/lib/auth/session"
import { logRouteEvent } from "@/lib/routes/service"

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
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  // Водитель отправляет только свою позицию: driverId из тела запроса больше не принимается
  const driverId = auth.value.driver.id

  try {
    const body = await request.json().catch(() => ({}))

    // Поддержка обоих вариантов именования координат
    const lat = typeof body.lat === "number" ? body.lat : body.latitude
    const lng = typeof body.lng === "number" ? body.lng : body.longitude

    if (typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json(
        { success: false, error: "lat и lng обязательны" },
        { status: 400 },
      )
    }

    // Карточка водителя гарантированно существует — её проверила сессия

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
        await logRouteEvent(prisma, {
          routeId: activeOrder.routeId,
          driverId,
          vehicleId: updated.vehicleId || null,
          orderId: activeOrder.id,
          type: "location",
          latitude: lat,
          longitude: lng,
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