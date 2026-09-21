// app/api/vehicles/[id]/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireStaff } from "@/lib/auth/session"

const ALLOWED_VEHICLE_STATUSES = ["available", "in_use", "maintenance"] as const
type VehicleStatus = typeof ALLOWED_VEHICLE_STATUSES[number]

type RouteParams = {
  params: Promise<{ id: string }>
}

// GET /api/vehicles/[id]
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Vehicle ID is required" },
        { status: 400 }
      )
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
    })

    if (!vehicle) {
      return NextResponse.json(
        { success: false, error: "Vehicle not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, vehicle })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vehicle GET error"
    console.error("[Vehicle] GET Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// PATCH /api/vehicles/[id]
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
        { success: false, error: "Vehicle ID is required" },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const {
      plate,
      type,
      brand,
      model,
      year,
      capacity,
      volume,
      length,
      width,
      height,
      status,
      features,
    } = body as {
      plate?: string
      type?: string
      brand?: string
      model?: string
      year?: string | number
      capacity?: string | number
      volume?: string | number
      length?: string | number
      width?: string | number
      height?: string | number
      status?: string
      features?: string[] | string
    }

    const data: Record<string, unknown> = {}

    if (plate !== undefined) data.plate = plate
    if (type !== undefined) data.type = type
    if (brand !== undefined) data.brand = brand
    if (model !== undefined) data.model = model

    if (year !== undefined) {
      const y = typeof year === "string" ? parseInt(year, 10) : year
      data.year = Number.isNaN(y) ? null : y
    }
    if (capacity !== undefined) {
      const c = typeof capacity === "string" ? parseInt(capacity, 10) : capacity
      data.capacity = Number.isNaN(c) ? 0 : c
    }
    if (volume !== undefined) {
      const v = typeof volume === "string" ? parseFloat(volume) : volume
      data.volume = Number.isNaN(v) ? null : v
    }
    if (length !== undefined) {
      const l = typeof length === "string" ? parseFloat(length) : length
      data.length = Number.isNaN(l) ? null : l
    }
    if (width !== undefined) {
      const w = typeof width === "string" ? parseFloat(width) : width
      data.width = Number.isNaN(w) ? null : w
    }
    if (height !== undefined) {
      const h = typeof height === "string" ? parseFloat(height) : height
      data.height = Number.isNaN(h) ? null : h
    }

    if (status !== undefined) {
      if (!ALLOWED_VEHICLE_STATUSES.includes(status as VehicleStatus)) {
        return NextResponse.json(
          { success: false, error: `Invalid vehicle status. Allowed: ${ALLOWED_VEHICLE_STATUSES.join(", ")}` },
          { status: 400 }
        )
      }
      data.status = status
    }

    if (features !== undefined) {
      data.features =
        Array.isArray(features) || typeof features === "string"
          ? JSON.stringify(features)
          : "[]"
    }

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data,
    })

    return NextResponse.json({ success: true, vehicle })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vehicle PATCH error"
    console.error("[Vehicle] PATCH Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}

// DELETE /api/vehicles/[id]
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
        { success: false, error: "Vehicle ID is required" },
        { status: 400 }
      )
    }

    // Отвязываем водителя
    await prisma.driver.updateMany({
      where: { vehicleId: id },
      data: { vehicleId: null },
    })

    await prisma.vehicle.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vehicle DELETE error"
    console.error("[Vehicle] DELETE Error:", message)
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}