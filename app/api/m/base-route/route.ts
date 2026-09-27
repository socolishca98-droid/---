// app/api/m/base-route/route.ts
//
// «Возврат на базу» в приложении водителя: сколько километров до базы своей
// компании и сколько это займёт.
//
// База у каждой организации своя (FleetSettings.baseLat/baseLng/baseAddress),
// поэтому координаты берутся из настроек организации водителя, а не из общей
// константы: иначе все компании считали бы расстояние до одной точки.
// Организация — из проверенной сессии; driverId из тела запроса игнорируется.

import { NextRequest, NextResponse } from "next/server"

import { requireDriver } from "@/lib/auth/session"
import { prisma } from "@/lib/prisma"

/** Средняя скорость для оценки времени: город/трасса пополам. */
const AVERAGE_SPEED_KMH = 60

function toRad(deg: number) {
  return (deg * Math.PI) / 180
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Координата похожа на настоящую: число в допустимых пределах. */
function isValidCoordinate(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit
}

export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const organizationId = auth.value.driver.organizationId
  if (!organizationId) {
    return NextResponse.json(
      { success: false, error: "Организация водителя не определена" },
      { status: 403 },
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const latitude = body?.latitude
    const longitude = body?.longitude

    if (!isValidCoordinate(latitude, 90) || !isValidCoordinate(longitude, 180)) {
      return NextResponse.json(
        { success: false, error: "latitude и longitude обязательны" },
        { status: 400 },
      )
    }

    const settings = await prisma.fleetSettings.findFirst({
      where: { organizationId },
      select: { parkName: true, baseAddress: true, baseLat: true, baseLng: true },
    })

    if (!settings || !isValidCoordinate(settings.baseLat, 90) || !isValidCoordinate(settings.baseLng, 180)) {
      // Не выдумываем точку на карте: логист должен указать базу своей компании
      return NextResponse.json(
        {
          success: false,
          configured: false,
          error:
            "Адрес базы не указан. Диспетчер задаёт его в разделе «Автопарк» → «Настройки автопарка».",
        },
        { status: 409 },
      )
    }

    const distanceKm = haversineDistanceKm(latitude, longitude, settings.baseLat, settings.baseLng)
    const etaMinutes = Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60)

    return NextResponse.json({
      success: true,
      distanceKm: Math.round(distanceKm),
      etaMinutes,
      baseName: settings.parkName,
      baseAddress: settings.baseAddress ?? null,
      baseLat: settings.baseLat,
      baseLng: settings.baseLng,
    })
  } catch (error) {
    console.error("POST /api/m/base-route error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    )
  }
}
