// app/api/m/sos/route.ts

import { NextRequest, NextResponse } from "next/server"
import { requireDriverAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// Типы SOS сигналов
const SOS_LABELS: Record<string, string> = {
  accident: "🚨 ДТП / Авария",
  breakdown: "🔧 Поломка ТС",
  medical: "🏥 Проблемы со здоровьем",
  robbery: "🚔 Ограбление / Угроза",
  cargo: "📦 Проблема с грузом",
  other: "⚠️ Другая ситуация",
}

// POST - отправить SOS сигнал
export async function POST(request: NextRequest) {
  const __auth = await requireDriverAuth(request);
  if (__auth.error) return __auth.error;

  try {
    const body = await request.json()
    const { driverId, latitude, longitude, message, orderId } = body
    const type = body.type || body.reason || "other"

    // Валидация
    if (!driverId) {
      return NextResponse.json(
        { success: false, error: "driverId is required" },
        { status: 400 },
      )
    }

    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { success: false, error: "GPS coordinates required for SOS" },
        { status: 400 },
      )
    }

    // Получаем данные водителя
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        name: true,
        phone: true,
        vehiclePlate: true,
        vehicleType: true,
      },
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 },
      )
    }

    // Создаём SOS алерт
    const sos = await prisma.sosAlert.create({
      data: {
        driverId,
        type,
        latitude,
        longitude,
        message: message || null,
        orderId: orderId || null,
        status: "active",
      },
    })

    // Создаём уведомление для логистов
    const sosLabel = SOS_LABELS[type] || SOS_LABELS.other

    await prisma.notification.create({
      data: {
        userId: "all_logists",
        userRole: "logist",
        type: "sos_alert",
        title: "🆘 SOS от водителя",
        message: `${driver.name} (${driver.vehiclePlate || "Нет ТС"}) отправил сигнал: ${sosLabel}${
          message ? `. ${message}` : ""
        }`,
        driverId,
        orderId: orderId || null,
        sosId: sos.id,
        priority: "critical",
      },
    })

    // Добавляем сообщение в чат как системное уведомление
    await prisma.chatMessage.create({
      data: {
        senderId: driverId,
        senderRole: "driver",
        senderName: driver.name,
        recipientId: null, // Для всех логистов
        content: `🆘 SOS: ${sosLabel}${message ? ` - ${message}` : ""}`,
        type: "alert",
        isImportant: true,
        importantReason: "SOS сигнал",
      },
    })

    // Событие в таймлайне рейса (если SOS связан с заказом, у которого есть маршрут)
    try {
      let routeId: string | null = null
      let vehicleId: string | null = null

      if (orderId) {
        const order = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            routeId: true,
            assignedVehicleId: true,
          },
        })
        if (order?.routeId) {
          routeId = order.routeId
          vehicleId = order.assignedVehicleId ?? null
        }
      }

      if (routeId) {
        await prisma.routeEvent.create({
          data: {
            routeId,
            driverId,
            vehicleId,
            orderId: orderId || null,
            type: "sos",
            status: type,
            latitude,
            longitude,
            address: null,
            data: message ? JSON.stringify({ message }) : null,
          },
        })
      }
    } catch (e) {
      console.error("[SOS API] routeEvent error:", e)
    }

    console.log(
      `🆘 SOS Alert created: ${sos.id} | Driver: ${driver.name} | Type: ${type}`,
    )

    return NextResponse.json({
      success: true,
      sosId: sos.id,
      message: "SOS сигнал отправлен",
    })
  } catch (error: any) {
    console.error("[SOS API] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    )
  }
}

// GET - получить SOS алерты (для дашборда логиста)
export async function GET(request: NextRequest) {
  const __auth = await requireDriverAuth(request);
  if (__auth.error) return __auth.error;

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || "active"
    const limit = parseInt(searchParams.get("limit") || "50", 10)

    const alerts = await prisma.sosAlert.findMany({
      where: {
        status: status === "all" ? undefined : status,
      },
      orderBy: { createdAt: "desc" },
      take: Number.isFinite(limit) && limit > 0 ? limit : 50,
    })

    const driverIds = [...new Set(alerts.map((a) => a.driverId))]
    const drivers = await prisma.driver.findMany({
      where: { id: { in: driverIds } },
      select: { id: true, name: true, phone: true, vehiclePlate: true },
    })

    const alertsWithDrivers = alerts.map((alert) => ({
      ...alert,
      driver: drivers.find((d) => d.id === alert.driverId),
      typeLabel: SOS_LABELS[alert.type] || alert.type,
    }))

    return NextResponse.json({
      success: true,
      alerts: alertsWithDrivers,
      total: alertsWithDrivers.length,
    })
  } catch (error: any) {
    console.error("[SOS API] GET Error:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    )
  }
}

// PATCH - обновить статус SOS (отметить как обработанный)
export async function PATCH(request: NextRequest) {
  const __auth = await requireDriverAuth(request);
  if (__auth.error) return __auth.error;

  try {
    const body = await request.json()
    const { sosId, status, resolution, resolvedBy } = body

    if (!sosId || !status) {
      return NextResponse.json(
        { success: false, error: "sosId and status required" },
        { status: 400 },
      )
    }

    const validStatuses = ["active", "responding", "resolved", "false_alarm"]
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(
            ", ",
          )}`,
        },
        { status: 400 },
      )
    }

    const updateData: Record<string, any> = { status }

    if (status === "resolved" || status === "false_alarm") {
      updateData.resolvedAt = new Date()
      updateData.resolvedBy = resolvedBy || null
      updateData.resolution = resolution || null
    }

    if (status === "responding") {
      updateData.respondedAt = new Date()
      updateData.respondedBy = resolvedBy || null
    }

    const updated = await prisma.sosAlert.update({
      where: { id: sosId },
      data: updateData,
    })

    return NextResponse.json({
      success: true,
      sos: updated,
    })
  } catch (error: any) {
    console.error("[SOS API] PATCH Error:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    )
  }
}