// app/api/fleet/load/route.ts
//
// Загрузка и топливо каждой машины организации одним запросом: карточки
// автопарка рисуют полосу «сколько везёт» и остаток в баке, а диалог догруза
// видит запас до грузоподъёмности. Данные только своей организации.

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { ACTIVE_LOAD_STATUSES } from "@/lib/fleet/load"

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const vehicles = await prisma.vehicle.findMany({
      where: scopedWhere(org.organizationId),
      select: {
        id: true,
        plate: true,
        capacity: true,
        fuelTankL: true,
        fuelConsumptionPer100: true,
        fuelLevelL: true,
        orders: {
          where: { status: { in: [...ACTIVE_LOAD_STATUSES] } },
          select: { weight: true, distance: true },
        },
      },
    })

    const items = vehicles.map((vehicle: any) => {
      const loadKg = vehicle.orders.reduce(
        (sum: any, order: any) => sum + (Number(order.weight) || 0),
        0,
      )
      return {
        id: vehicle.id,
        plate: vehicle.plate,
        capacity: vehicle.capacity,
        loadKg,
        freeKg: Math.max(0, vehicle.capacity - loadKg),
        ratio: vehicle.capacity > 0 ? loadKg / vehicle.capacity : null,
        fuelTankL: vehicle.fuelTankL,
        fuelConsumptionPer100: vehicle.fuelConsumptionPer100,
        fuelLevelL: vehicle.fuelLevelL,
      }
    })

    return NextResponse.json({ success: true, items })
  } catch (error: any) {
    console.error("[Fleet Load] GET Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Fleet load GET error" },
      { status: 500 },
    )
  }
}
