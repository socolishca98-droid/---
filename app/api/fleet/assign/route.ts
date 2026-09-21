// app/api/fleet/assign/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { driverId, vehicleId } = body as {
      driverId?: string
      vehicleId?: string
    }

    if (!driverId || !vehicleId) {
      return NextResponse.json(
        { success: false, error: "Укажите driverId и vehicleId" },
        { status: 400 },
      )
    }

    const [driver, vehicle, currentAssignedDriver] = await Promise.all([
      prisma.driver.findUnique({ where: { id: driverId } }),
      prisma.vehicle.findUnique({ where: { id: vehicleId } }),
      prisma.driver.findFirst({
        where: { vehicleId, id: { not: driverId } },
        select: { id: true, name: true },
      }),
    ])

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Водитель не найден" },
        { status: 404 },
      )
    }

    if (!vehicle) {
      return NextResponse.json(
        { success: false, error: "Машина не найдена" },
        { status: 404 },
      )
    }

    if (currentAssignedDriver) {
      return NextResponse.json(
        {
          success: false,
          error: `Машина уже закреплена за водителем ${currentAssignedDriver.name}`,
        },
        { status: 400 },
      )
    }

    // Если за этим водителем была другая машина, просто перезаписываем vehicleId
    await prisma.driver.update({
      where: { id: driverId },
      data: {
        vehicleId,
        vehiclePlate: vehicle.plate,
        vehicleType: vehicle.type,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[Fleet Assign] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Ошибка назначения водителя" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const driverId = searchParams.get("driverId")
    const vehicleId = searchParams.get("vehicleId")

    if (!driverId && !vehicleId) {
      return NextResponse.json(
        { success: false, error: "Укажите driverId или vehicleId" },
        { status: 400 },
      )
    }

    if (driverId) {
      await prisma.driver.update({
        where: { id: driverId },
        data: { vehicleId: null },
      })
    } else if (vehicleId) {
      await prisma.driver.updateMany({
        where: { vehicleId },
        data: { vehicleId: null },
      })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[Fleet Unassign] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Ошибка отвязки" },
      { status: 500 },
    )
  }
}
