// app/api/drivers/[id]/location/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma" // ✅ Используем синглтон

type RouteParams = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // ✅ Next.js 15+ требует await для params
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, message: "Driver ID is required" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { latitude, longitude } = body

    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json(
        { success: false, message: "Latitude and longitude are required" },
        { status: 400 }
      )
    }

    const lat = parseFloat(String(latitude))
    const lng = parseFloat(String(longitude))

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { success: false, message: "Invalid latitude or longitude values" },
        { status: 400 }
      )
    }

    const updatedDriver = await prisma.driver.update({
      where: { id },
      data: {
        latitude: lat,
        longitude: lng,
        lastGpsUpdate: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      driver: {
        id: updatedDriver.id,
        latitude: updatedDriver.latitude,
        longitude: updatedDriver.longitude,
        lastGpsUpdate: updatedDriver.lastGpsUpdate,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error"
    console.error("[Driver Location] Error:", message)
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    )
  }
}