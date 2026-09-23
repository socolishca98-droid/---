// app/api/m/maintenance/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { forbidden, requireAnySession } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
// GET — текущее активное ТО
// Доступ: водитель (только своя машина) и логист (любая машина) —
// эндпоинт используют и мобильное приложение, и экран автопарка.
export async function GET(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { searchParams } = new URL(request.url)

    let targetVehicleId = searchParams.get("vehicleId")

    if (auth.value.kind === "driver") {
      // Водитель видит ТО только своей машины
      const ownVehicleId = auth.value.driver.vehicleId
      if (targetVehicleId && targetVehicleId !== ownVehicleId) {
        return forbidden("Можно смотреть ТО только своей машины")
      }
      targetVehicleId = ownVehicleId
    } else if (!targetVehicleId) {
      // Логист может запросить ТО по водителю
      const driverId = searchParams.get("driverId")
      if (driverId) {
        const driver = await prisma.driver.findFirst({
          where: scopedWhere(org.organizationId, { id: driverId }),
          select: { vehicleId: true },
        })
        targetVehicleId = driver?.vehicleId || null
      }
    }

    if (!targetVehicleId) {
      return NextResponse.json({
        success: true,
        maintenance: null,
      })
    }

    const maintenance = await prisma.maintenanceLog.findFirst({
      where: scopedWhere(org.organizationId, {
        vehicleId: targetVehicleId,
        status: { in: ["in_progress", "planned"] },
      }),
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
export async function POST(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const body = await request.json()

    const {
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

    // Водитель создаёт ТО только на свою машину; логист — на любую
    // и может указать водителя, который выполняет работы
    let finalVehicleId = vehicleId
    let recordDriverId: string | null = null

    if (auth.value.kind === "driver") {
      const ownVehicleId = auth.value.driver.vehicleId
      if (finalVehicleId && finalVehicleId !== ownVehicleId) {
        return forbidden("ТО можно создать только на свою машину")
      }
      finalVehicleId = ownVehicleId || undefined
      recordDriverId = auth.value.driver.id
    } else {
      recordDriverId = (body as { driverId?: string }).driverId ?? null
      if (!finalVehicleId && recordDriverId) {
        const driver = await prisma.driver.findFirst({
          where: scopedWhere(org.organizationId, { id: recordDriverId }),
          select: { vehicleId: true },
        })
        finalVehicleId = driver?.vehicleId || undefined
      }
    }

    if (!finalVehicleId) {
      return NextResponse.json(
        { success: false, error: "Не указан автомобиль" },
        { status: 400 }
      )
    }

    const startDate = plannedDate ? new Date(plannedDate) : new Date()

    // ТО создаётся только на машину своей организации
    const ownVehicle = await prisma.vehicle.findFirst({
      where: scopedWhere(org.organizationId, { id: finalVehicleId }),
      select: { id: true },
    })
    if (!ownVehicle) {
      return NextResponse.json(
        { success: false, error: "Автомобиль не найден" },
        { status: 404 }
      )
    }

    const maintenance = await prisma.maintenanceLog.create({
      data: {
        organizationId: org.organizationId,
        vehicleId: finalVehicleId,
        driverId: recordDriverId, // может быть null
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
      await prisma.vehicle.updateMany({
        where: scopedWhere(org.organizationId, { id: finalVehicleId }),
        data: { status: "maintenance" },
      })

      // Обновляем всех водителей, привязанных к этой машине
      // (Убрали лишний запрос findUnique с include, который вызывал ошибку)
      await prisma.driver.updateMany({
        where: scopedWhere(org.organizationId, { vehicleId: finalVehicleId }),
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
export async function PATCH(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const body = await request.json()

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

    const existing = await prisma.maintenanceLog.findFirst({
      where: scopedWhere(org.organizationId, { id: maintenanceId }),
      select: { id: true, vehicleId: true },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Запись ТО не найдена" },
        { status: 404 }
      )
    }

    if (auth.value.kind === "driver" && existing.vehicleId !== auth.value.driver.vehicleId) {
      return forbidden("Завершать можно только ТО своей машины")
    }

    await prisma.maintenanceLog.updateMany({
      where: scopedWhere(org.organizationId, { id: maintenanceId }),
      data: {
        status: "completed",
        completedAt: new Date(),
        ...(cost == null ? {} : { cost }),
      },
    })

    const maintenance = await prisma.maintenanceLog.findFirstOrThrow({
      where: scopedWhere(org.organizationId, { id: maintenanceId }),
    })

    // Машина снова свободна
    await prisma.vehicle.updateMany({
      where: scopedWhere(org.organizationId, { id: maintenance.vehicleId }),
      data: {
        status: "available",
        lastMaintenanceDate: new Date(),
      },
    })

    // Водители снова свободны
    await prisma.driver.updateMany({
      where: scopedWhere(org.organizationId, { vehicleId: maintenance.vehicleId }),
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