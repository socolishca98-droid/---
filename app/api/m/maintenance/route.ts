// app/api/m/maintenance/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET — текущее активное ТО
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const driverId = searchParams.get("driverId")
    const vehicleId = searchParams.get("vehicleId")

    let targetVehicleId = vehicleId

    // Если нет vehicleId, ищем машину водителя
    if (!targetVehicleId && driverId) {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
      })
      // Используем null, чтобы совпадало с типом переменной
      targetVehicleId = driver?.vehicleId || null
    }

    if (!targetVehicleId) {
      return NextResponse.json({
        success: true,
        maintenance: null,
      })
    }

    const maintenance = await prisma.maintenanceLog.findFirst({
      where: {
        vehicleId: targetVehicleId,
        status: { in: ["in_progress", "planned"] },
      },
      orderBy: { startedAt: "desc" },
    })

    return NextResponse.json({
      success: true,
      maintenance,
    })
  } catch (error) {
    console.error("GET /api/m/maintenance error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}

// POST — начать/запланировать ТО
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const {
      driverId,
      vehicleId,
      type,
      description,
      mileage,
      cost,
      performer,
      serviceName,
      status = "in_progress",
      plannedDate,
    } = body as {
      driverId?: string
      vehicleId?: string
      type?: string
      description?: string
      mileage?: number | null
      cost?: number | null
      performer?: "driver" | "service"
      serviceName?: string | null
      status?: "in_progress" | "planned"
      plannedDate?: string
    }

    if (!type || !description) {
      return NextResponse.json(
        { success: false, error: "type и description обязательны" },
        { status: 400 }
      )
    }

    let finalVehicleId = vehicleId

    if (!finalVehicleId && driverId) {
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
      })
      finalVehicleId = driver?.vehicleId || undefined
    }

    if (!finalVehicleId) {
      return NextResponse.json(
        { success: false, error: "Не указан автомобиль" },
        { status: 400 }
      )
    }

    const startDate = plannedDate ? new Date(plannedDate) : new Date()

    const maintenance = await prisma.maintenanceLog.create({
      data: {
        vehicleId: finalVehicleId,
        driverId, // может быть null
        type,
        description,
        mileage: mileage ?? null,
        cost: cost ?? null,
        performer: performer === "service" ? "service" : "driver",
        serviceName: performer === "service" ? serviceName || null : null,
        status: status,
        startedAt: startDate,
      },
    })

    // Если статус "in_progress" — обновляем статус машины и водителей
    if (status === "in_progress") {
      // Обновляем машину
      await prisma.vehicle.update({
        where: { id: finalVehicleId },
        data: { status: "maintenance" },
      })

      // Обновляем всех водителей, привязанных к этой машине
      // (Убрали лишний запрос findUnique с include, который вызывал ошибку)
      await prisma.driver.updateMany({
        where: { vehicleId: finalVehicleId },
        data: { status: "maintenance" },
      })
    }

    return NextResponse.json({
      success: true,
      maintenance,
    })
  } catch (error) {
    console.error("POST /api/m/maintenance error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}

// PATCH — завершить ТО
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()

    const { maintenanceId, cost } = body as {
      maintenanceId?: string
      cost?: number | null
    }

    if (!maintenanceId) {
      return NextResponse.json(
        { success: false, error: "maintenanceId обязателен" },
        { status: 400 }
      )
    }

    const maintenance = await prisma.maintenanceLog.update({
      where: { id: maintenanceId },
      data: {
        status: "completed",
        completedAt: new Date(),
        cost: cost ?? undefined,
      },
    })

    // Машина снова свободна
    await prisma.vehicle.update({
      where: { id: maintenance.vehicleId },
      data: {
        status: "available",
        lastMaintenanceDate: new Date(),
      },
    })

    // Водители снова свободны
    await prisma.driver.updateMany({
      where: { vehicleId: maintenance.vehicleId },
      data: { status: "available" },
    })

    return NextResponse.json({
      success: true,
      maintenance,
    })
  } catch (error) {
    console.error("PATCH /api/m/maintenance error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}