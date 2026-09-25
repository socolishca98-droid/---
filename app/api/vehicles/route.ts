// app/api/vehicles/route.ts - P1-6 zod

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createVehicleSchema, zodErrorResponse } from "@/lib/validators"

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error
  const __org = requireStaffOrganization(__auth.user)
  if (!__org.ok) return __org.response

  try {
    const { searchParams } = new URL(request.url)
    const available = searchParams.get("available")
    const idsParam = searchParams.get("ids")

    if (idsParam) {
      const ids = idsParam.split(",").filter(Boolean)
      if (ids.length === 0) {
        return NextResponse.json({ success: true, vehicles: [] })
      }
      if (ids.length > 100) {
        return NextResponse.json(
          { success: false, error: "Maximum 100 IDs allowed per request" },
          { status: 400 }
        )
      }
      const vehicles = await prisma.vehicle.findMany({
        where: scopedWhere(__org.organizationId, { id: { in: ids } }),
      })
      const vehiclesMap: Record<string, typeof vehicles[0]> = {}
      vehicles.forEach((vehicle: any) => {
        vehiclesMap[vehicle.id] = vehicle
      })
      return NextResponse.json({ success: true, vehicles, vehiclesMap })
    }

    const where: Record<string, unknown> = {}
    if (available === "true") {
      where.status = "available"
    }

    const vehicles = await prisma.vehicle.findMany({
      where: scopedWhere(__org.organizationId, where),
      orderBy: [{ status: "asc" }, { plate: "asc" }],
    })

    return NextResponse.json({ success: true, vehicles })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vehicles GET error"
    console.error("[Vehicles] GET Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error
  const __org = requireStaffOrganization(__auth.user)
  if (!__org.ok) return __org.response

  try {
    const rawBody = await request.json().catch(() => null)
    if (!rawBody) {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = createVehicleSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 })
    }

    const { plate, type, brand, model, year, capacity, volume, length, width, height, features } = parsed.data

    const featuresJson = Array.isArray(features) || typeof features === "string" ? JSON.stringify(features) : "[]"

    const vehicle = await prisma.vehicle.create({
      data: {
        organizationId: __org.organizationId,
        plate,
        type,
        brand: brand || null,
        model: model || null,
        year: year || null,
        capacity: capacity || 0,
        volume: volume || null,
        length: length || null,
        width: width || null,
        height: height || null,
        features: featuresJson,
        status: "available",
      },
    })

    return NextResponse.json({ success: true, vehicle })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vehicles POST error"
    console.error("[Vehicles] POST Error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
