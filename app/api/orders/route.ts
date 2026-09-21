// app/api/orders/route.ts

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const driverId = searchParams.get("driverId")
    const routeId = searchParams.get("routeId")
    const limit = parseInt(searchParams.get("limit") || "100", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)

    const where: any = {}

    if (status) {
      if (status.includes(",")) {
        where.status = { in: status.split(",") }
      } else {
        where.status = status
      }
    }

    if (driverId) {
      where.assignedDriverId = driverId
    }

    if (routeId) {
      where.routeId = routeId
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: [
          { routeSequence: "asc" },
          { createdAt: "desc" },
        ],
        take: limit,
        skip: offset,
      }),
      prisma.order.count({ where }),
    ])

    return NextResponse.json({
      success: true,
      orders,
      total,
      limit,
      offset,
      hasMore: offset + orders.length < total,
    })
  } catch (error: any) {
    console.error("[Orders API] GET Error:", error)
    return NextResponse.json(
      { success: false, error: error.message, orders: [] },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const {
      source = "manual",
      sourceId,
      routeFrom,
      routeTo,
      distance,
      weight,
      volume,
      cargoType,
      price,
      clientName,
      clientContact,
      deadline,
      assignedDriverId,
      assignedVehicleId,
      routeId,
    } = body

    if (!routeFrom || !routeTo) {
      return NextResponse.json(
        { success: false, error: "routeFrom и routeTo обязательны" },
        { status: 400 }
      )
    }

    const order = await prisma.$transaction(async (tx) => {
      let finalRouteId = routeId
      if (!finalRouteId && (assignedDriverId || assignedVehicleId)) {
        finalRouteId = `route_${Date.now()}`
        await tx.route.create({
          data: {
            id: finalRouteId,
            name: `Рейс: ${routeFrom} — ${routeTo}`,
            status: "active",
            driverId: assignedDriverId || null,
            vehicleId: assignedVehicleId || null,
            totalDistance: distance || 0,
            totalCost: price || 0,
            cargoWeight: weight || 0,
          },
        })
      }

      const created = await tx.order.create({
        data: {
          source,
          sourceId,
          routeFrom,
          routeTo,
          distance: distance || 0,
          weight: weight || 0,
          volume,
          cargoType: cargoType || "Груз",
          price: price || 0,
          clientName,
          clientContact: clientContact || "",
          deadline: deadline ? new Date(deadline) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: assignedDriverId ? "confirmed" : "new",
          assignedDriverId,
          assignedVehicleId,
          routeId: finalRouteId,
        },
      })

      if (assignedDriverId) {
        await tx.driver.updateMany({
          where: { id: assignedDriverId },
          data: { status: "busy" },
        })
      }

      if (assignedVehicleId) {
        await tx.vehicle.updateMany({
          where: { id: assignedVehicleId },
          data: { status: "in_use" },
        })
      }

      return created
    })

    return NextResponse.json({ success: true, order })
  } catch (error: any) {
    console.error("[Orders API] POST Error:", error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}