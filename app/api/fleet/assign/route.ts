// app/api/fleet/assign/route.ts
//
// Закрепление машины за водителем.
// Задача 2: связь «водитель ↔ машина» хранится один раз — в Driver.vehicleId.
// Поле Vehicle.driverId удалено из схемы, а кэш Driver.vehicleType/vehiclePlate
// пишется только через lib/fleet/assignment (единый путь записи).
//
// POST   /api/fleet/assign?{driverId, vehicleId} — закрепить
// DELETE /api/fleet/assign?driverId=…             — снять машину с водителя
// DELETE /api/fleet/assign?vehicleId=…            — отвязать машину от всех водителей

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireStaff } from "@/lib/auth/session"
import {
  findVehicleOccupant,
  linkDriverToVehicle,
  unlinkVehicle,
} from "@/lib/fleet/assignment"

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  try {
    const body = await request.json().catch(() => ({}))
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

    const [driver, vehicle] = await Promise.all([
      prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, name: true } }),
      prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true, plate: true, type: true },
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

    const occupant = await findVehicleOccupant(prisma, vehicleId, driverId)
    if (occupant) {
      return NextResponse.json(
        {
          success: false,
          error: `Машина уже закреплена за ${occupant.name || "другим водителем"}`,
        },
        { status: 400 },
      )
    }

    const assignment = await prisma.$transaction((tx) =>
      linkDriverToVehicle(tx, driverId, vehicleId),
    )

    return NextResponse.json({ success: true, assignment })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка назначения водителя"
    console.error("[Fleet Assign] Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

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

    const result = await prisma.$transaction(async (tx) => {
      if (driverId) {
        // снимаем машину с водителя: обнуляется и кэш номера/типа
        return linkDriverToVehicle(tx, driverId, null)
      }
      const unlinked = await unlinkVehicle(tx, vehicleId as string)
      return { vehicleId: vehicleId as string, unlinkedDrivers: unlinked }
    })

    return NextResponse.json({ success: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка отвязки"
    console.error("[Fleet Unassign] Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
