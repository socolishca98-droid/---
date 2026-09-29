// app/api/vehicles/[id]/refuel/route.ts
//
// Заправка машины: до горловины или на указанное число литров. Уровень топлива
// живёт на машине и списывается оценочно по завершении рейса.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { fuelAfterRefuel } from "@/lib/fleet/fuel"

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as { liters?: unknown }

    let liters: number | null = null
    if (body.liters !== undefined && body.liters !== null && body.liters !== "") {
      const value = Number(body.liters)
      if (!Number.isFinite(value) || value <= 0 || value > 5000) {
        return NextResponse.json(
          { success: false, error: "Литры должны быть числом от 1 до 5000" },
          { status: 400 },
        )
      }
      liters = value
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: scopedWhere(org.organizationId, { id }),
      select: { id: true, plate: true, fuelTankL: true, fuelLevelL: true },
    })
    if (!vehicle) {
      return NextResponse.json({ success: false, error: "Машина не найдена" }, { status: 404 })
    }
    if (vehicle.fuelTankL === null && liters === null) {
      return NextResponse.json(
        {
          success: false,
          error: "У машины не задан объём бака: укажите литраж или бак в карточке машины",
        },
        { status: 400 },
      )
    }

    const level = fuelAfterRefuel(vehicle, liters)
    await prisma.vehicle.update({
      // защита в глубину: обновление не выходит за пределы организации сессии
      where: { id: vehicle.id, organizationId: org.organizationId },
      data: { fuelLevelL: level },
    })

    return NextResponse.json({
      success: true,
      fuelLevelL: level,
      message: `Бак ${vehicle.plate}: ${level} л`,
    })
  } catch (error: any) {
    console.error("[Vehicle Refuel] POST Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Refuel error" },
      { status: 500 },
    )
  }
}
