// app/api/vehicles/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET /api/vehicles?available=true
// GET /api/vehicles?ids=id1,id2,id3 — bulk fetch
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const available = searchParams.get("available")
    const idsParam = searchParams.get("ids")

    // ✅ Bulk fetch по списку ID
    if (idsParam) {
      const ids = idsParam.split(",").filter(Boolean)

      if (ids.length === 0) {
        return NextResponse.json({ success: true, vehicles: [] })
      }

      if (ids.length > 100) {
        return NextResponse.json(
          { success: false, error: "Maximum 100 IDs allowed per request" },
          { status: 400 }
        )
      }

      const vehicles = await prisma.vehicle.findMany({
        where: { id: { in: ids } },
      })

      // Возвращаем Map для быстрого доступа на клиенте
      const vehiclesMap: Record<string, typeof vehicles[0]> = {}
      vehicles.forEach((vehicle) => {
        vehiclesMap[vehicle.id] = vehicle
      })

      return NextResponse.json({
        success: true,
        vehicles,
        vehiclesMap,
      })
    }

    // Стандартный запрос
    const where: Record<string, unknown> = {}
    if (available === "true") {
      where.status = "available"
    }

    const vehicles = await prisma.vehicle.findMany({
      where,
      orderBy: [{ status: "asc" }, { plate: "asc" }],
    })

    return NextResponse.json({ success: true, vehicles })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vehicles GET error"
    console.error("[Vehicles] GET Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// POST /api/vehicles
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const {
      plate,
      type,
      brand,
      model,
      year,
      capacity,
      volume,
      length,
      width,
      height,
      features,
    } = body as {
      plate?: string
      type?: string
      brand?: string
      model?: string
      year?: string | number
      capacity?: string | number
      volume?: string | number
      length?: string | number
      width?: string | number
      height?: string | number
      features?: string[] | string
    }

    if (!plate || !type || !capacity) {
      return NextResponse.json(
        { success: false, error: "plate, type and capacity are required" },
        { status: 400 }
      )
    }

    const parsedCapacity =
      typeof capacity === "string" ? parseInt(capacity, 10) : capacity
    const parsedYear = year
      ? typeof year === "string"
        ? parseInt(year, 10)
        : year
      : undefined
    const parsedVolume = volume
      ? typeof volume === "string"
        ? parseFloat(volume)
        : volume
      : undefined
    const parsedLength = length
      ? typeof length === "string"
        ? parseFloat(length)
        : length
      : undefined
    const parsedWidth = width
      ? typeof width === "string"
        ? parseFloat(width)
        : width
      : undefined
    const parsedHeight = height
      ? typeof height === "string"
        ? parseFloat(height)
        : height
      : undefined

    const featuresJson =
      Array.isArray(features) || typeof features === "string"
        ? JSON.stringify(features)
        : "[]"

    const vehicle = await prisma.vehicle.create({
      data: {
        plate,
        type,
        brand: brand || null,
        model: model || null,
        year: parsedYear || null,
        capacity: parsedCapacity || 0,
        volume: parsedVolume || null,
        length: parsedLength || null,
        width: parsedWidth || null,
        height: parsedHeight || null,
        features: featuresJson,
        status: "available",
      },
    })

    return NextResponse.json({ success: true, vehicle })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vehicles POST error"
    console.error("[Vehicles] POST Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}