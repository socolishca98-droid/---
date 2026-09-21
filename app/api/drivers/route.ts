// app/api/drivers/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// ✅ Допустимые статусы водителя
const ALLOWED_DRIVER_STATUSES = ["available", "busy", "maintenance", "offline"] as const

// GET /api/drivers?status=available|busy|maintenance|offline|all
// GET /api/drivers?ids=id1,id2,id3 — bulk fetch
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || undefined
    const idsParam = searchParams.get("ids")

    // ✅ Bulk fetch по списку ID
    if (idsParam) {
      const ids = idsParam.split(",").filter(Boolean)
      
      if (ids.length === 0) {
        return NextResponse.json({ success: true, drivers: [] })
      }

      if (ids.length > 100) {
        return NextResponse.json(
          { success: false, error: "Maximum 100 IDs allowed per request" },
          { status: 400 }
        )
      }

      const drivers = await prisma.driver.findMany({
        where: { id: { in: ids } },
      })

      // Возвращаем Map для быстрого доступа на клиенте
      const driversMap: Record<string, typeof drivers[0]> = {}
      drivers.forEach((driver) => {
        driversMap[driver.id] = driver
      })

      return NextResponse.json({ 
        success: true, 
        drivers,
        driversMap,
      })
    }

    // Стандартный запрос с фильтрацией по статусу
    const where: Record<string, unknown> = {}
    if (status && status !== "all") {
      where.status = status
    }

    const drivers = await prisma.driver.findMany({
      where,
      include: {
        vehicle: true,
      },
      orderBy: { name: "asc" },
    })

    return NextResponse.json({ success: true, drivers })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drivers GET error"
    console.error("[Drivers] GET Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// POST /api/drivers
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const {
      name,
      phone,
      vehicleId,
      vehicleType,
      vehiclePlate,
      licenseNumber,
      licenseExpiry,
      medicalExpiry,
    } = body as {
      name?: string
      phone?: string
      vehicleId?: string
      vehicleType?: string
      vehiclePlate?: string
      licenseNumber?: string
      licenseExpiry?: string
      medicalExpiry?: string
    }

    if (!name || !phone) {
      return NextResponse.json(
        { success: false, error: "name and phone are required" },
        { status: 400 }
      )
    }

    const driver = await prisma.driver.create({
      data: {
        name,
        phone,
        status: "available",
        vehicleId: vehicleId || null,
        vehicleType: vehicleType || "",
        vehiclePlate: vehiclePlate || "",
        licenseNumber: licenseNumber || null,
        licenseExpiry: licenseExpiry ? new Date(licenseExpiry) : null,
        medicalExpiry: medicalExpiry ? new Date(medicalExpiry) : null,
        hiredAt: new Date(),
      },
    })

    return NextResponse.json({ success: true, driver })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drivers POST error"
    console.error("[Drivers] POST Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}