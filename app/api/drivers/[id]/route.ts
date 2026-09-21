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
import { friendlyDbError, friendlyDbErrorStatus } from "@/lib/db/errors"
import { linkDriverToVehicle } from "@/lib/fleet/assignment"
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

    // Закрепление машины пишется только через единый путь (задача 2):
    // Driver.vehicleId — источник правды, vehicleType/vehiclePlate — кэш,
    // который заполняется из данных машины, а не из тела запроса.
    let driver
    if (vehicleId !== undefined) {
      await prisma.$transaction(async (tx) => {
        await tx.driver.update({ where: { id }, data })
        await linkDriverToVehicle(tx, id, vehicleId)
      })
      driver = await prisma.driver.findUniqueOrThrow({ where: { id } })
    } else {
      driver = await prisma.driver.update({ where: { id }, data })
    }

    return NextResponse.json({ success: true, driver })
  } catch (error) {
    // повтор телефона (Driver.phone @unique) → 409 с понятным текстом
    const friendly = friendlyDbError(error)
    const message = friendly || (error instanceof Error ? error.message : "Driver PATCH error")
    console.error("[Driver] PATCH Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: friendly ? friendlyDbErrorStatus(error) : 500 }
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

    // Машина отвязывается автоматически: связь хранится в Driver.vehicleId
    // и удаляется вместе с карточкой водителя (поле Vehicle.driverId удалено
    // из схемы в задаче 2).
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