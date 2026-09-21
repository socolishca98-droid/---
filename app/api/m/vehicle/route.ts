import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireDriver } from "@/lib/auth/session"
// GET — список доступных машин
export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  try {
    const vehicles = await prisma.vehicle.findMany({
      orderBy: { plate: "asc" },
    })

    // Получаем информацию о привязанных водителях
    const drivers = await prisma.driver.findMany({
      where: {
        vehicleId: { not: null },
      },
      select: {
        id: true,
        name: true,
        vehicleId: true,
      },
    })

    const driverMap = new Map(
      drivers.map((d) => [d.vehicleId, { id: d.id, name: d.name }])
    )

    const vehiclesWithDrivers = vehicles.map((v) => ({
      ...v,
      assignedDriver: driverMap.get(v.id) || null,
    }))

    return NextResponse.json({
      success: true,
      vehicles: vehiclesWithDrivers,
    })
  } catch (error) {
    console.error("GET /api/m/vehicle error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}

// POST — водитель выбирает машину (привязывает её к себе)
export async function POST(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  // Водитель может привязать машину только к себе
  const driverId = auth.value.driver.id

  try {
    const body = await request.json()

    const { vehicleId } = body as {
      vehicleId?: string
    }

    if (!vehicleId) {
      return NextResponse.json(
        { success: false, error: "vehicleId обязателен" },
        { status: 400 }
      )
    }

    // Проверяем что машина существует и доступна
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
    })

    if (!vehicle) {
      return NextResponse.json(
        { success: false, error: "Машина не найдена" },
        { status: 404 }
      )
    }

    if (vehicle.status === "maintenance") {
      return NextResponse.json(
        { success: false, error: "Машина на ТО" },
        { status: 400 }
      )
    }

    // Обновляем водителя
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data: {
        vehicleId: vehicleId,
        vehiclePlate: vehicle.plate,
        vehicleType: vehicle.type,
      },
    })

    return NextResponse.json({
      success: true,
      driver,
      vehicle,
    })
  } catch (error) {
    console.error("POST /api/m/vehicle error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}