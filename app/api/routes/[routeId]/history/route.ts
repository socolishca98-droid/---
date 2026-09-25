// app/api/routes/[routeId]/history/route.ts
//
// История рейса (задача 7): одна карточка на вопрос «как прошёл рейс».
//
// Отдаётся всё сразу: хронология (события, статусы заказов, расходы, границы
// рейса), расходы с разбивкой по видам, документы и фото рейса, и итог —
// пробег, заработок, расход и что осталось.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { orderStatusLabel } from "@/lib/orders/stages"
import {
  EVENT_TYPE_LABELS,
  buildTripSummary,
  buildTripTimeline,
  fuelConsumptionPer100Km,
  groupExpensesByType,
} from "@/lib/trips/history"

/** Подпись типа события рейса (location, status, photo, sos, note…). */
function eventTypeLabel(type: string | null | undefined): string {
  if (!type) return "Событие рейса"
  return EVENT_TYPE_LABELS[type] ?? type
}

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ routeId: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { routeId } = await params

    const route = (await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, { id: routeId }),
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        totalDistance: true,
        totalCost: true,
        fuelExpense: true,
        cargoWeight: true,
        startOdometer: true,
        endOdometer: true,
        notes: true,
        driver: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, plate: true, brand: true, model: true } },
      },
    })) as Record<string, any> | null

    if (!route) {
      return NextResponse.json({ success: false, error: "Рейс не найден" }, { status: 404 })
    }

    const [events, orders, expenses, photos] = await Promise.all([
      prisma.routeEvent.findMany({
        where: scopedWhere(org.organizationId, { routeId }),
        orderBy: [{ createdAt: "asc" }],
        take: 300,
        select: {
          id: true,
          type: true,
          status: true,
          address: true,
          data: true,
          orderId: true,
          createdAt: true,
          latitude: true,
          longitude: true,
        },
      }),
      prisma.order.findMany({
        where: scopedWhere(org.organizationId, { routeId }),
        orderBy: [{ routeSequence: "asc" }],
        select: {
          id: true,
          status: true,
          routeFrom: true,
          routeTo: true,
          cargoType: true,
          weight: true,
          distance: true,
          price: true,
          agreedPrice: true,
          createdAt: true,
          deliveredAt: true,
          deadline: true,
          clientName: true,
          isPaid: true,
          driver: { select: { name: true } },
        },
      }),
      prisma.routeExpense.findMany({
        where: scopedWhere(org.organizationId, { routeId }),
        orderBy: [{ spentAt: "desc" }],
        select: {
          id: true,
          type: true,
          amount: true,
          liters: true,
          odometer: true,
          vendor: true,
          spentAt: true,
          note: true,
          source: true,
          photoId: true,
        },
      }),
      prisma.photo.findMany({
        where: scopedWhere(org.organizationId, { routeId }),
        orderBy: [{ createdAt: "asc" }],
        take: 200,
        select: {
          id: true,
          url: true,
          type: true,
          description: true,
          ocrData: true,
          createdAt: true,
          orderId: true,
        },
      }),
    ])

    const summary = buildTripSummary({
      route: {
        id: route.id,
        name: route.name,
        createdAt: route.createdAt,
        startedAt: route.startedAt,
        completedAt: route.completedAt,
        totalDistance: route.totalDistance,
        startOdometer: route.startOdometer,
        endOdometer: route.endOdometer,
      },
      orders: orders as any[],
      expenses: expenses as any[],
    })

    // Тексты событий: у события рейса нет отдельного поля сообщения, поэтому
    // читаем data (JSON) и превращаем его в понятную строку
    const timeline = buildTripTimeline({
      route: {
        id: route.id,
        name: route.name,
        createdAt: route.createdAt,
        startedAt: route.startedAt,
        completedAt: route.completedAt,
        startOdometer: route.startOdometer,
        endOdometer: route.endOdometer,
      },
      events: (events as any[]).map((event) => ({
        id: event.id,
        type: event.type,
        status: event.status,
        description: describeEvent(event),
        createdAt: event.createdAt,
        orderId: event.orderId,
        lat: event.latitude,
        lng: event.longitude,
      })),
      orders: orders as any[],
      expenses: expenses as any[],
      orderStatusLabel,
      eventTypeLabel,
    })

    return NextResponse.json({
      success: true,
      route: {
        id: route.id,
        name: route.name,
        status: route.status,
        createdAt: route.createdAt,
        startedAt: route.startedAt,
        completedAt: route.completedAt,
        startOdometer: route.startOdometer,
        endOdometer: route.endOdometer,
        notes: route.notes,
        driver: route.driver,
        vehicle: route.vehicle,
      },
      summary: {
        ...summary,
        fuelPer100Km: fuelConsumptionPer100Km({
          liters: summary.fuelLiters,
          distanceKm: summary.distanceKm,
        }),
      },
      timeline,
      orders: (orders as any[]).map((order) => ({
        id: order.id,
        status: order.status,
        statusLabel: orderStatusLabel(order.status),
        routeFrom: order.routeFrom,
        routeTo: order.routeTo,
        cargoType: order.cargoType,
        weight: order.weight,
        distance: order.distance,
        amount: order.agreedPrice ?? order.price ?? 0,
        isPaid: Boolean(order.isPaid),
        clientName: order.clientName,
        createdAt: order.createdAt,
        deliveredAt: order.deliveredAt,
      })),
      expenses,
      byType: groupExpensesByType(expenses as any[]),
      photos,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось открыть историю рейса"
    console.error("[Route history] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/** Человеческая подпись события рейса из его data/address/статуса. */
function describeEvent(event: {
  type?: string | null
  status?: string | null
  address?: string | null
  data?: string | null
}): string | null {
  const parts: string[] = []

  if (event.status) parts.push(orderStatusLabel(event.status))
  if (event.address) parts.push(event.address)

  if (event.data) {
    try {
      const parsed = JSON.parse(event.data) as Record<string, unknown>
      for (const key of ["message", "note", "comment", "photoType", "statusLabel"]) {
        const value = parsed[key]
        if (typeof value === "string" && value.trim()) parts.push(value.trim())
      }
      if (parts.length === 0 && typeof parsed.url === "string") parts.push("фото")
    } catch {
      // data может быть не JSON — тогда просто показываем как есть, если коротко
      if (event.data.length <= 120) parts.push(event.data)
    }
  }

  if (parts.length === 0 && event.type) parts.push(eventTypeLabel(event.type))

  return parts.length > 0 ? parts.join(" · ") : null
}
