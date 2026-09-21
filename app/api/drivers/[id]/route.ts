// app/api/drivers/[id]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  forbidden,
  isSelfOrStaff,
  requireAnySession,
  requireStaff,
  revokeAllSessions,
} from "@/lib/auth/session"
// ✅ Добавлен 'offline' в список разрешённых статусов
const ALLOWED_DRIVER_STATUSES = ["available", "busy", "maintenance", "offline"] as const
type DriverStatus = typeof ALLOWED_DRIVER_STATUSES[number]

type RouteParams = {
  params: Promise<{ id: string }>
}

// GET /api/drivers/[id]
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Driver ID is required" },
        { status: 400 }
      )
    }

    // Водитель читает только свою карточку
    if (!isSelfOrStaff(auth.value, id)) {
      return forbidden("Недостаточно прав для просмотра этой карточки водителя")
    }

    const driver = await prisma.driver.findUnique({
      where: { id },
    })

    if (!driver) {
      return NextResponse.json(
        { success: false, error: "Driver not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, driver })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Driver GET error"
    console.error("[Driver] GET Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// PATCH /api/drivers/[id]
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Driver ID is required" },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const {
      name,
      phone,
      status,
      vehicleId,
      vehicleType,
      vehiclePlate,
      licenseNumber,
      licenseExpiry,
      medicalExpiry,
      currentLocation,
      latitude,
      longitude,
    } = body as {
      name?: string
      phone?: string
      status?: string
      vehicleId?: string | null
      vehicleType?: string
      vehiclePlate?: string
      licenseNumber?: string | null
      licenseExpiry?: string | null
      medicalExpiry?: string | null
      currentLocation?: string | null
      latitude?: number
      longitude?: number
    }

    const data: Record<string, unknown> = {}

    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone

    // ✅ Проверка статуса с поддержкой 'offline'
    if (status !== undefined) {
      if (!ALLOWED_DRIVER_STATUSES.includes(status as DriverStatus)) {
        return NextResponse.json(
          { success: false, error: `Invalid driver status. Allowed: ${ALLOWED_DRIVER_STATUSES.join(", ")}` },
          { status: 400 }
        )
      }
      data.status = status
    }

    if (vehicleId !== undefined) data.vehicleId = vehicleId
    if (vehicleType !== undefined) data.vehicleType = vehicleType
    if (vehiclePlate !== undefined) data.vehiclePlate = vehiclePlate
    if (licenseNumber !== undefined) data.licenseNumber = licenseNumber
    if (licenseExpiry !== undefined) {
      data.licenseExpiry = licenseExpiry ? new Date(licenseExpiry) : null
    }
    if (medicalExpiry !== undefined) {
      data.medicalExpiry = medicalExpiry ? new Date(medicalExpiry) : null
    }
    if (currentLocation !== undefined) data.currentLocation = currentLocation
    if (latitude !== undefined) data.latitude = latitude
    if (longitude !== undefined) data.longitude = longitude

    const driver = await prisma.driver.update({
      where: { id },
      data,
    })

    return NextResponse.json({ success: true, driver })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Driver PATCH error"
    console.error("[Driver] PATCH Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// DELETE /api/drivers/[id]
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Driver ID is required" },
        { status: 400 }
      )
    }

    // Доступ водителя закрываем вместе с карточкой: иначе учётка останется
    // активной, а войти по ней будет нельзя (связь с Driver обнулится)
    const linkedUser = await prisma.user.findFirst({
      where: { driverId: id },
      select: { id: true, name: true },
    })
    if (linkedUser) {
      await prisma.user.update({
        where: { id: linkedUser.id },
        data: {
          status: "suspended",
          suspendedAt: new Date(),
          suspendReason: `Карточка водителя «${linkedUser.name}» удалена`,
        },
      })
      await revokeAllSessions(linkedUser.id, "Карточка водителя удалена")
    }

    // Отвязываем машину, если была
    await prisma.vehicle.updateMany({
      where: { driverId: id },
      data: { driverId: null },
    })

    await prisma.driver.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Driver DELETE error"
    console.error("[Driver] DELETE Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}