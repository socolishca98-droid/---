import { NextRequest, NextResponse } from "next/server"

import { requireDriver } from "@/lib/auth/session"

const BASE_LAT = 57.6261
const BASE_LNG = 39.8845

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()

    const latitude = body?.latitude as number | undefined
    const longitude = body?.longitude as number | undefined

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return NextResponse.json(
        { success: false, error: "latitude и longitude обязательны" },
        { status: 400 }
      )
    }

    const distanceKm = haversineDistanceKm(latitude, longitude, BASE_LAT, BASE_LNG)
    const avgSpeedKmH = 60
    const etaMinutes = Math.round((distanceKm / avgSpeedKmH) * 60)

    return NextResponse.json({
      success: true,
      distanceKm: Math.round(distanceKm),
      etaMinutes,
    })
  } catch (error) {
    console.error("POST /api/m/base-route error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}