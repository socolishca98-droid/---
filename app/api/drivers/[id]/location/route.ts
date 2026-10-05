// app/api/drivers/[id]/location/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma" // ✅ Используем синглтон

type RouteParams = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


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

    const lat = parseFloat(String(latitude).replace(",", "."))
    const lng = parseFloat(String(longitude).replace(",", "."))

    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return NextResponse.json(
        { success: false, message: "Invalid latitude or longitude values" },
        { status: 400 }
      )
    }

    // updateMany с фильтром организации: чужого водителя просто не обновит
    const updated = await prisma.driver.updateMany({
      where: scopedWhere(__org.organizationId, { id }),
      data: {
        latitude: lat,
        longitude: lng,
        lastGpsUpdate: new Date(),
      },
    })

    if (updated.count === 0) {
      return NextResponse.json(
        { success: false, message: "Водитель не найден" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      driver: {
        id,
        latitude: lat,
        longitude: lng,
        lastGpsUpdate: new Date(),
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