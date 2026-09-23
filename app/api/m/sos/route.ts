// app/api/m/sos/route.ts
// Водитель отправляет SOS-сигнал. Список сигналов и их обработка —
// штабная операция и живёт в /api/sos (доступ только для admin/logist).

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { SOS_LABELS } from "@/lib/sos-labels"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { logRouteEvent } from "@/lib/routes/service"
// POST - отправить SOS сигнал
export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  // Автор сигнала — водитель из проверенной сессии
  const driverId = auth.value.driver.id

  try {
    const body = await request.json()
    const { type, latitude, longitude, message, orderId } = body

    // Валидация
    if (!type) {
      return NextResponse.json(
        { success: false, error: "type is required" },
        { status: 400 },
      )
    }

    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { success: false, error: "GPS coordinates required for SOS" },
        { status: 400 },
      )
    }

    // Данные водителя — из карточки, привязанной к сессии
    const driver = await prisma.driver.findFirst({
      where: scopedWhere(org.organizationId, { id: driverId }),
      select: {
        name: true,
        phone: true,
        vehiclePlate: true,
        vehicleType: true,
      },
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Карточка водителя не найдена" },
        { status: 404 },
      )
    }

    // Создаём SOS алерт
    const sos = await prisma.sosAlert.create({
      data: {
        organizationId: org.organizationId,
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
        organizationId: org.organizationId,
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
        organizationId: org.organizationId,
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
        const order = await prisma.order.findFirst({
          where: scopedWhere(org.organizationId, { id: orderId }),
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
        await logRouteEvent(prisma, {
          organizationId: org.organizationId,
          routeId,
          driverId,
          vehicleId,
          orderId: orderId || null,
          type: "sos",
          status: type,
          latitude,
          longitude,
          data: message ? JSON.stringify({ message }) : null,
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

