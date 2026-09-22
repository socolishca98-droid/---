// app/api/m/route/events/route.ts
// Мобильный API: приём событий рейса от водителя
//
// POST /api/m/route/events
// body: { routeId, orderId?, driverId, vehicleId?, type, status?, latitude?, longitude?, address?, data? }

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  calculateAllCoefficients,
  calculateRouteCost,
  type ETARequest,
} from "@/lib/eta"

const COMPLETED_STATUSES = ["delivered", "cancelled", "rejected"]

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          routeId?: string
          orderId?: string | null
          driverId?: string
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

    const { routeId, driverId, vehicleId, stageId, orderId } = body
    const { type, status, latitude, longitude, address, data } = body

    if (!routeId || !driverId || !type) {
      return NextResponse.json(
        {
          success: false,
          error: "routeId, driverId и type обязательны",
        },
        { status: 400 },
      )
    }

    // Пишем событие
    const event = await prisma.routeEvent.create({
      data: {
        routeId,
        driverId,
        vehicleId: vehicleId || null,
        stageId: stageId || null,
        orderId: orderId || null,
        type,
        status: status || null,
        latitude: typeof latitude === "number" ? latitude : null,
        longitude: typeof longitude === "number" ? longitude : null,
        address: address || null,
        data: data != null ? JSON.stringify(data) : null,
      },
    })

    // Пересчёт Live ETA (упрощённый, без OSRM, по остаточному расстоянию)
    const etaInfo = await recalcLiveEta(routeId)

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

async function recalcLiveEta(routeId: string) {
  // Берём все заказы по маршруту
  const orders = await prisma.order.findMany({
    where: { routeId },
    orderBy: [
      { routeSequence: "asc" },
      { createdAt: "asc" },
    ],
  })

  if (!orders.length) {
    return null
  }

  const remainingOrders = orders.filter((o: any) => !COMPLETED_STATUSES.includes(o.status),
  )

  const remainingDistance =
    remainingOrders.reduce((sum: any, o: any) => sum + (o.distance || 0), 0) || 0

  const remainingWeight =
    remainingOrders.reduce((sum: any, o: any) => sum + (o.weight || 0), 0) || 0

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