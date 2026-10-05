// app/api/vehicles/[id]/route.ts

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { OCCUPYING_ORDER_STATUSES } from "@/lib/orders/stages"

const ALLOWED_VEHICLE_STATUSES = ["available", "in_use", "maintenance"] as const
type VehicleStatus = typeof ALLOWED_VEHICLE_STATUSES[number]

type RouteParams = {
  params: Promise<{ id: string }>
}

// GET /api/vehicles/[id]
export async function GET(_request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Vehicle ID is required" },
        { status: 400 }
      )
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: scopedWhere(__org.organizationId, { id }),
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
export async function PATCH(request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Vehicle ID is required" },
        { status: 400 }
      )
    }

    // Менять можно только машину своей организации: чужой id — 404,
    // чтобы не подтверждать существование записи в другой компании.
    const existing = await prisma.vehicle.findFirst({
      where: scopedWhere(__org.organizationId, { id }),
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Vehicle not found" },
        { status: 404 }
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
      data.year = Number.isNaN(y) || y < 1900 || y > 2100 ? null : y
    }
    if (capacity !== undefined) {
      // Грузоподъёмность участвует в проверке перегруза (capacity > 0):
      // отрицательное или мусорное значение молча отключило бы контроль
      // перегруза для машины. Пусто — как «не задана» (0), контроль не мешает.
      if (capacity === null || capacity === "") {
        data.capacity = 0
      } else {
        const c = typeof capacity === "string" ? parseInt(capacity, 10) : capacity
        if (!Number.isFinite(c) || c < 0 || c > 100000) {
          return NextResponse.json(
            {
              success: false,
              error: "Грузоподъёмность должна быть целым числом от 0 до 100000 кг",
            },
            { status: 400 }
          )
        }
        data.capacity = Math.round(c)
      }
    }
    // Топливные поля: число, пусто — сброс в null
    for (const key of ["fuelTankL", "fuelConsumptionPer100", "fuelLevelL"] as const) {
      const raw = (body as Record<string, unknown>)[key]
      if (raw === undefined) continue
      if (raw === null || raw === "") {
        data[key] = null
        continue
      }
      const value = typeof raw === "string" ? parseFloat(raw.replace(",", ".")) : raw
      data[key] = typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
    }
    if (volume !== undefined) {
      const v = typeof volume === "string" ? parseFloat(volume.replace(",", ".")) : volume
      data.volume = Number.isNaN(v) || v < 0 ? null : v
    }
    if (length !== undefined) {
      const l = typeof length === "string" ? parseFloat(length.replace(",", ".")) : length
      data.length = Number.isNaN(l) || l < 0 ? null : l
    }
    if (width !== undefined) {
      const w = typeof width === "string" ? parseFloat(width.replace(",", ".")) : width
      data.width = Number.isNaN(w) || w < 0 ? null : w
    }
    if (height !== undefined) {
      const h = typeof height === "string" ? parseFloat(height.replace(",", ".")) : height
      data.height = Number.isNaN(h) || h < 0 ? null : h
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

    // org-audit: ok — машина найдена выше внутри организации вызывающего
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
export async function DELETE(_request: NextRequest,
  { params }: RouteParams) {
  const __auth = await requireStaffAuth(_request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Vehicle ID is required" },
        { status: 400 }
      )
    }

    // Удаляем только машину своей организации: чужой id — 404
    const existing = await prisma.vehicle.findFirst({
      where: scopedWhere(__org.organizationId, { id }),
      select: { id: true },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Vehicle not found" },
        { status: 404 }
      )
    }

    // Машина с открытым рейсом или активными заказами не удаляется:
    // иначе рейс молча потеряет машину посреди исполнения.
    const openRoutes = await prisma.route.count({
      where: scopedWhere(__org.organizationId, {
        vehicleId: id,
        status: { notIn: ["completed", "cancelled"] },
      }),
    })
    const busyOrders = await prisma.order.count({
      where: scopedWhere(__org.organizationId, {
        assignedVehicleId: id,
        status: { in: [...OCCUPYING_ORDER_STATUSES] },
      }),
    })
    if (openRoutes > 0 || busyOrders > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "У машины есть открытые рейсы или активные заказы — сначала завершите их или снимите назначение",
          code: "vehicle_busy",
        },
        { status: 409 },
      )
    }

    // Отвязываем водителя
    await prisma.driver.updateMany({
      where: scopedWhere(__org.organizationId, { vehicleId: id }),
      data: { vehicleId: null },
    })

    await prisma.vehicle.deleteMany({
      where: scopedWhere(__org.organizationId, { id }),
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