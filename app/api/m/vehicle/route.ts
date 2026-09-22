import { NextRequest, NextResponse } from "next/server"
import { requireDriverAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// GET — список доступных машин
export async function GET(req: NextRequest) {
  const __auth = await requireDriverAuth(req);
  if (__auth.error) return __auth.error;

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
      drivers.map((d: any) => [d.vehicleId, { id: d.id, name: d.name }])
    )

    const vehiclesWithDrivers = vehicles.map((v: any) => ({
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

// POST — водитель выбирает машину
export async function POST(req: NextRequest) {
  const __auth = await requireDriverAuth(req);
  if (__auth.error) return __auth.error;

  try {
    const body = await req.json()

    const { driverId, vehicleId } = body as {
      driverId?: string
      vehicleId?: string
    }

    if (!driverId || !vehicleId) {
      return NextResponse.json(
        { success: false, error: "driverId и vehicleId обязательны" },
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