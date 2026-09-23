// app/api/m/location/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { logRouteEvent } from "@/lib/routes/service"

const ACTIVE_ORDER_STATUSES = [
  "confirmed",
  "in_transit",
  "loading",
  "unloading",
] as const

async function getActiveOrderForDriver(driverId: string, organizationId: string) {
  return prisma.order.findFirst({
    where: scopedWhere(organizationId, {
      assignedDriverId: driverId,
      status: { in: ACTIVE_ORDER_STATUSES as any },
    }),
    orderBy: { createdAt: "asc" },
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

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

    // updateMany с фильтром организации: чужую карточку водителя не изменить
    await prisma.driver.updateMany({
      where: scopedWhere(org.organizationId, { id: driverId }),
      data: {
        latitude: lat,
        longitude: lng,
        lastGpsUpdate: new Date(),
      },
    })

    const updated = await prisma.driver.findFirstOrThrow({
      where: scopedWhere(org.organizationId, { id: driverId }),
    })

    // Пишем событие локации в таймлайн (если есть активный маршрут)
    // Опционально можно писать не каждую точку, а раз в N минут/метров
    try {
      const activeOrder = await getActiveOrderForDriver(driverId, org.organizationId)
      if (activeOrder?.routeId) {
        await logRouteEvent(prisma, {
          organizationId: org.organizationId,
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