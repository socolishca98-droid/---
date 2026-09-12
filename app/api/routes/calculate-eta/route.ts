// app/api/routes/calculate-eta/route.ts
// Расчёт ETA: POST /api/routes/calculate-eta

import { NextRequest, NextResponse } from "next/server"
import { calculateETA, formatDuration, formatDistance } from "@/lib/eta/service"
import type { ETARequest } from "@/lib/eta/types"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.origin || !body.destination) {
      return NextResponse.json(
        { error: "Требуются origin и destination" },
        { status: 400 },
      )
    }

    const etaRequest: ETARequest = {
      origin: { lat: body.origin.lat, lng: body.origin.lng },
      destination: { lat: body.destination.lat, lng: body.destination.lng },
      waypoints: body.waypoints || [],
      departureTime: body.departureTime
        ? new Date(body.departureTime)
        : new Date(),
      cargo: body.cargo,
      vehicle: body.vehicle,
      weather: body.weather,
      useCache: body.useCache !== false,
    }

    const result = await calculateETA(etaRequest)

    return NextResponse.json({
      success: result.success,
      duration: {
        base: result.durationBase,
        withTraffic: result.durationWithTraffic,
        baseFormatted: formatDuration(result.durationBase),
        withTrafficFormatted: formatDuration(result.durationWithTraffic),
      },
      distance: {
        meters: result.distance,
        formatted: formatDistance(result.distance),
      },
      risk: {
        level: result.riskLevel,
        delayProbability: result.riskFactors.delayProbability,
        reasons: result.riskFactors.reasons,
        recommendations: result.riskFactors.recommendations,
      },
      eta: {
        planned: result.plannedETA.toISOString(),
        live: result.liveETA.toISOString(),
      },
      cost: result.estimatedCost,
      polyline: result.polyline,
    })
  } catch (error) {
    console.error("[API] calculate-eta error:", error)
    return NextResponse.json({ error: "Ошибка расчета ETA" }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    service: "ETA Calculator",
    status: "ok",
    example: {
      origin: { lat: 55.7558, lng: 37.6173 },
      destination: { lat: 59.9343, lng: 30.3351 },
    },
  })
}