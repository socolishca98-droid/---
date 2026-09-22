// app/api/routes/route.ts - P1-6 zod
import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { randomUUID } from "crypto"
import { createRouteSchema, zodErrorResponse } from "@/lib/validators"

type SandboxOrderPayload = {
  atiCacheId?: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  price: number
  cargo: string
  clientCompany?: string
  clientPhone?: string
  groupId?: string | null
}

function generateRouteId(): string {
  try {
    return randomUUID()
  } catch {
    return `route_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}

export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error

  try {
    const rawBody = await request.json().catch(() => null)
    if (!rawBody) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 })
    }

    const parsed = createRouteSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 })
    }

    const { vehicleId, driverId, orders } = parsed.data as any

    if (!vehicleId) {
      return NextResponse.json({ success: false, error: "vehicleId is required" }, { status: 400 })
    }

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ success: false, error: "orders[] is required" }, { status: 400 })
    }

    const routeId = generateRouteId()

    const created = await prisma.$transaction(async (tx: any) => {
      const fromCity = orders[0]?.routeFrom || "Пункт А"
      const toCity = orders[orders.length - 1]?.routeTo || "Пункт Б"
      const totalDist = orders.reduce((sum: any, o: any) => sum + (o.distance || 0), 0)
      const totalCost = orders.reduce((sum: any, o: any) => sum + (o.price || 0), 0)
      const totalWeight = orders.reduce((sum: any, o: any) => sum + (o.weight || 0), 0)

      await tx.route.create({
        data: {
          id: routeId,
          name: `Рейс: ${fromCity} — ${toCity}`,
          status: "active",
          driverId: driverId || null,
          vehicleId: vehicleId,
          totalDistance: totalDist,
          totalCost: totalCost,
          cargoWeight: totalWeight,
        },
      })

      const createdOrders = await Promise.all(
        orders.map((o: any, idx: any) =>
          tx.order.create({
            data: {
              source: o.atiCacheId ? "ATI" : "manual",
              sourceId: o.atiCacheId || null,
              routeFrom: o.routeFrom,
              routeTo: o.routeTo,
              distance: o.distance || 0,
              weight: o.weight || 0,
              cargoType: o.cargo || "Груз",
              loadingType: "other",
              price: o.price || 0,
              priceNegotiable: !o.price || o.price === 0,
              clientName: o.clientCompany || null,
              clientContact: o.clientPhone || "",
              deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              status: "confirmed",
              priority: "needs_clarification",
              aiScore: 50,
              assignedDriverId: driverId || null,
              assignedVehicleId: vehicleId,
              routeId,
              isAdditionalLoad: false,
              addedToRouteAt: new Date(),
              proposedToDriver: false,
              routeSequence: idx + 1,
            },
          })
        )
      )

      if (driverId) {
        await tx.driver.updateMany({ where: { id: driverId }, data: { status: "busy" } })
      }
      await tx.vehicle.updateMany({ where: { id: vehicleId }, data: { status: "in_use" } })

      return createdOrders
    })

    return NextResponse.json({ success: true, routeId, ordersCount: created.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Route creation error"
    console.error("[Routes API] POST /api/routes error:", message, error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error

  return NextResponse.json({
    success: true,
    message: "POST /api/routes создаёт рейс из песочницы. Для расчёта ETA используйте POST /api/routes/calculate-eta",
  })
}
