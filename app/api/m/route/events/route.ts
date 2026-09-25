// app/api/m/route/events/route.ts
// Мобильный API: приём событий рейса от водителя
//
// POST /api/m/route/events
// body: { routeId, orderId?, driverId, vehicleId?, type, status?, latitude?, longitude?, address?, data? }

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"

import {
  calculateAllCoefficients,
  calculateRouteCost,
  type ETARequest,
} from "@/lib/eta"
import { logRouteEvent } from "@/lib/routes/service"

const COMPLETED_STATUSES = ["delivered", "cancelled", "rejected"]

export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  // Автор события — всегда водитель из сессии, поле driverId из тела не принимается
  const driverId = auth.value.driver.id

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          routeId?: string
          orderId?: string | null
          vehicleId?: string | null
          stageId?: string | null
          type?: string
          status?: string | null
          latitude?: number | null
          longitude?: number | null
          address?: string | null
          data?: any
        }
      | null

    if (!body) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 },
      )
    }

    const { routeId, vehicleId, stageId, orderId } = body
    const { type, status, latitude, longitude, address, data } = body

    if (!routeId || !type) {
      return NextResponse.json(
        {
          success: false,
          error: "routeId и type обязательны",
        },
        { status: 400 },
      )
    }

    // Рейс должен принадлежать организации водителя: иначе событие ушло бы в чужой таймлайн.
    // «Исторический» routeId (строки Route ещё нет) проверяем по заказам своей организации.
    const [ownRoute, ownOrders] = await Promise.all([
      prisma.route.findFirst({
        where: scopedWhere(org.organizationId, { id: routeId }),
        select: { id: true },
      }),
      prisma.order.count({
        where: scopedWhere(org.organizationId, { routeId }),
      }),
    ])
    if (!ownRoute && ownOrders === 0) {
      return NextResponse.json(
        { success: false, error: "Рейс не найден" },
        { status: 404 },
      )
    }

    // Ссылки на заказ, машину и этап приходят из тела запроса, поэтому проверяем
    // их принадлежность организации водителя: иначе в событии своей организации
    // окажутся id чужих записей, а таймлайн рейса (/api/routes/:id/events отдаёт
    // строку события целиком) показал бы их логисту.
    const [ownVehicle, ownStage, ownOrder] = await Promise.all([
      vehicleId
        ? prisma.vehicle.findFirst({
            where: scopedWhere(org.organizationId, { id: vehicleId }),
            select: { id: true },
          })
        : null,
      stageId
        ? prisma.routeStage.findFirst({
            where: scopedWhere(org.organizationId, { id: stageId }),
            select: { id: true },
          })
        : null,
      orderId
        ? prisma.order.findFirst({
            where: scopedWhere(org.organizationId, { id: orderId }),
            select: { id: true },
          })
        : null,
    ])
    if ((vehicleId && !ownVehicle) || (stageId && !ownStage) || (orderId && !ownOrder)) {
      return NextResponse.json(
        { success: false, error: "Запись не найдена" },
        { status: 404 },
      )
    }

    // Пишем событие через единую точку записи: она же добирает строку Route,
    // если рейс «исторический» (routeId есть в заказах, а в таблице Route нет)
    await logRouteEvent(prisma, {
      organizationId: org.organizationId,
      routeId,
      driverId,
      vehicleId: ownVehicle?.id ?? null,
      stageId: ownStage?.id ?? null,
      orderId: ownOrder?.id ?? null,
      type,
      status: status || null,
      latitude: typeof latitude === "number" ? latitude : null,
      longitude: typeof longitude === "number" ? longitude : null,
      address: address || null,
      data: data != null ? JSON.stringify(data) : null,
    })

    const event = await prisma.routeEvent.findFirst({
      where: scopedWhere(org.organizationId, { routeId, driverId, type }),
      orderBy: { createdAt: "desc" },
    })

    // Пересчёт Live ETA (упрощённый, без OSRM, по остаточному расстоянию)
    const etaInfo = await recalcLiveEta(routeId, org.organizationId)

    return NextResponse.json({
      success: true,
      event,
      eta: etaInfo,
    })
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error"
    console.error("[RouteEvents API] POST error:", message, error)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}

async function recalcLiveEta(routeId: string, organizationId: string) {
  // Берём все заказы по маршруту
  const orders = await prisma.order.findMany({
    where: scopedWhere(organizationId, { routeId }),
    orderBy: [
      { routeSequence: "asc" },
      { createdAt: "asc" },
    ],
  })

  if (!orders.length) {
    return null
  }

  const remainingOrders = orders.filter(
    (o) => !COMPLETED_STATUSES.includes(o.status),
  )

  const remainingDistance =
    remainingOrders.reduce((sum, o) => sum + (o.distance || 0), 0) || 0

  const remainingWeight =
    remainingOrders.reduce((sum, o) => sum + (o.weight || 0), 0) || 0

  if (remainingDistance <= 0) {
    const now = new Date()
    return {
      remainingDistanceMeters: 0,
      durationBaseSec: 0,
      durationWithTrafficSec: 0,
      liveEta: now.toISOString(),
      plannedEta: now.toISOString(),
      cost: { fuel: 0, tolls: 0, total: 0 },
    }
  }

  const distanceKm = remainingDistance / 1000
  const baseSpeedKmH = 60
  const durationBaseSec = (distanceKm / baseSpeedKmH) * 3600

  const etaRequest: ETARequest = {
    origin: { lat: 0, lng: 0 },
    destination: { lat: 0, lng: 0 },
    departureTime: new Date(),
    cargo: {
      weight: remainingWeight / 1000,
      type: "standard",
    },
    vehicle: {
      type: "truck",
    },
    useCache: false,
  }

  const coeffs = calculateAllCoefficients(etaRequest, distanceKm)
  const durationWithTrafficSec = Math.round(
    durationBaseSec * coeffs.total,
  )

  const cost = calculateRouteCost(distanceKm, etaRequest.vehicle)

  const now = Date.now()
  const plannedEta = new Date(now + durationBaseSec * 1000)
  const liveEta = new Date(now + durationWithTrafficSec * 1000)

  return {
    remainingDistanceMeters: remainingDistance,
    durationBaseSec: Math.round(durationBaseSec),
    durationWithTrafficSec,
    plannedEta: plannedEta.toISOString(),
    liveEta: liveEta.toISOString(),
    cost,
    coefficients: coeffs,
  }
}