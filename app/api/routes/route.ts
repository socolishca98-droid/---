// app/api/routes/route.ts
// Рейсы (задача 2: Route — настоящая модель в БД, а не «виртуальная» группа заказов)
//
// GET  /api/routes            — список рейсов из таблицы Route
// POST /api/routes            — создать рейс из песочницы заказов

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { findVehicleOccupant, linkDriverToVehicle } from "@/lib/fleet/assignment"
import {
  ROUTE_STATUSES,
  buildRouteName,
  deriveRouteStatus,
  isRouteStatus,
  summarizeRoute,
  type RouteOrderLike,
} from "@/lib/routes/model"
import { routeOrdersOrderBy, serializeRoute } from "@/lib/routes/service"

type SandboxOrderPayload = {
  atiCacheId?: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  volume?: number
  price: number
  cargo: string
  clientCompany?: string
  clientPhone?: string
  groupId?: string | null
}

type CreateRouteBody = {
  vehicleId: string
  driverId?: string | null
  orders: SandboxOrderPayload[]
  name?: string | null
  notes?: string | null
  totalPrice?: number
  totalDistance?: number
  totalWeight?: number
}

/** Строка списка рейсов: запись Route + подгруженные водитель, машина и заказы. */
type RouteListRow = Parameters<typeof serializeRoute>[0] & {
  driver: unknown
  vehicle: unknown
  orders: RouteOrderLike[]
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

/**
 * GET /api/routes
 *   ?status=planned,active,in_transit — фильтр по статусам рейса
 *   ?includeClosed=1                  — не отрезать завершённые/отменённые
 *   ?limit=50&offset=0                — пагинация (без неё список рос бы вечно)
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { searchParams } = new URL(request.url)

    const statusFilter = (searchParams.get("status") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    const invalid = statusFilter.filter((s) => !isRouteStatus(s))
    if (invalid.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Неизвестные статусы рейса: ${invalid.join(", ")}. Доступно: ${ROUTE_STATUSES.join(", ")}`,
        },
        { status: 400 },
      )
    }

    const includeClosed = searchParams.get("includeClosed") === "1"
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(searchParams.get("limit") || "", 10) || DEFAULT_PAGE_SIZE),
    )
    const offset = Math.max(0, Number.parseInt(searchParams.get("offset") || "", 10) || 0)

    const where: Record<string, unknown> = {}
    if (statusFilter.length > 0) {
      where.status = { in: statusFilter }
    } else if (!includeClosed) {
      where.status = { notIn: ["completed", "cancelled"] }
    }

    const [total, rows] = await Promise.all([
      prisma.route.count({ where: scopedWhere(org.organizationId, where) }),
      prisma.route.findMany({
        where: scopedWhere(org.organizationId, where),
        include: {
          driver: { select: { id: true, name: true, phone: true, status: true, vehiclePlate: true } },
          vehicle: { select: { id: true, plate: true, type: true, capacity: true, status: true } },
          orders: {
            where: scopedWhere(org.organizationId, {}),
            orderBy: routeOrdersOrderBy,
          },
        },
        orderBy: [{ createdAt: "desc" }],
        take: limit,
        skip: offset,
      }),
    ])

    const routes = (rows as RouteListRow[]).map((route) => ({
      ...serializeRoute(route),
      driver: route.driver,
      vehicle: route.vehicle,
      orders: route.orders,
      stats: summarizeRoute(route.orders),
    }))

    return NextResponse.json({
      success: true,
      routes,
      // форма ответа для клиентов, которые ждут массив в поле data
      count: routes.length,
      total,
      limit,
      offset,
      hasMore: offset + routes.length < total,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Route list error"
    console.error("[Routes API] GET /api/routes error:", message, error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * POST /api/routes — собрать рейс из песочницы заказов.
 * Создаёт запись Route, привязывает к ней заказы (Order.routeId — внешний ключ),
 * закрепляет машину за водителем через единый путь записи (lib/fleet/assignment)
 * и сразу считает итоги рейса по заказам.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const body = (await request.json().catch(() => null)) as CreateRouteBody | null

    if (!body) {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 })
    }

    const { vehicleId, driverId, orders, name, notes } = body

    if (!vehicleId) {
      return NextResponse.json({ success: false, error: "vehicleId is required" }, { status: 400 })
    }

    if (!Array.isArray(orders) || orders.length === 0) {
      return NextResponse.json({ success: false, error: "orders[] is required" }, { status: 400 })
    }

    const vehicle = await prisma.vehicle.findFirst({
      where: scopedWhere(org.organizationId, { id: vehicleId }),
      select: { id: true, plate: true, type: true, capacity: true, status: true },
    })
    if (!vehicle) {
      return NextResponse.json({ success: false, error: "Машина не найдена" }, { status: 404 })
    }

    if (driverId) {
      const driver = await prisma.driver.findFirst({
        where: scopedWhere(org.organizationId, { id: driverId }),
        select: { id: true, name: true },
      })
      if (!driver) {
        return NextResponse.json({ success: false, error: "Водитель не найден" }, { status: 404 })
      }

      // машина может быть закреплена только за одним водителем
      const occupant = await findVehicleOccupant(prisma, vehicleId, driverId, org.organizationId)
      if (occupant) {
        return NextResponse.json(
          {
            success: false,
            error: `Машина уже закреплена за ${occupant.name || "другим водителем"}`,
          },
          { status: 409 },
        )
      }
    }

    const totalWeight = orders.reduce((sum, o) => sum + (o.weight || 0), 0)
    if (vehicle.capacity > 0 && totalWeight > vehicle.capacity) {
      return NextResponse.json(
        {
          success: false,
          error: "Превышена грузоподъёмность машины",
          details: { capacity: vehicle.capacity, totalWeight },
        },
        { status: 400 },
      )
    }

    const created = await prisma.$transaction(async (tx) => {
      const route = await tx.route.create({
        data: {
          organizationId: org.organizationId,
          name: name?.trim() || null,
          status: "planned",
          driverId: driverId || null,
          vehicleId: vehicle.id,
          notes: notes?.trim() || null,
        },
      })

      const createdOrders = await Promise.all(
        orders.map((o, idx) =>
          tx.order.create({
            data: {
              organizationId: org.organizationId,
              source: o.atiCacheId ? "ATI" : "manual",
              sourceId: o.atiCacheId || null,
              routeFrom: o.routeFrom,
              routeTo: o.routeTo,
              distance: o.distance || 0,
              weight: o.weight || 0,
              volume: o.volume ?? null,
              cargoType: o.cargo || "Груз",
              loadingType: "other",
              price: o.price || 0,
              priceNegotiable: !o.price || o.price === 0,
              clientName: o.clientCompany || null,
              clientContact: o.clientPhone || "",
              deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              status: "confirmed", // заказ сразу в работе
              priority: "needs_clarification",
              aiScore: 50,
              assignedDriverId: driverId || null,
              assignedVehicleId: vehicle.id,
              routeId: route.id,
              isAdditionalLoad: false,
              addedToRouteAt: new Date(),
              proposedToDriver: false,
              routeSequence: idx + 1,
            },
          }),
        ),
      )

      // связь «водитель ↔ машина» пишется ровно один раз и только здесь
      if (driverId) {
        await linkDriverToVehicle(tx, driverId, vehicle.id, org.organizationId)
        await tx.driver.updateMany({
          where: scopedWhere(org.organizationId, { id: driverId }),
          data: { status: "busy" },
        })
      }

      await tx.vehicle.updateMany({
        where: scopedWhere(org.organizationId, { id: vehicle.id }),
        data: { status: "in_use" },
      })

      // заказы, пришедшие из кэша ATI, помечаем импортированными
      const atiCacheIds = orders.map((o) => o.atiCacheId).filter(Boolean) as string[]
      if (atiCacheIds.length > 0) {
        await tx.atiCache.updateMany({
          where: { id: { in: atiCacheIds } },
          data: { status: "imported" },
        })
      }

      const summary = summarizeRoute(createdOrders)
      // org-audit: manual — рейс создан этой же транзакцией с organizationId вызывающего
      const finalRoute = await tx.route.update({
        where: { id: route.id },
        data: {
          name: name?.trim() || buildRouteName(createdOrders) || null,
          status: deriveRouteStatus(createdOrders.map((o) => o.status)),
          totalDistance: summary.totalDistance || null,
          cargoWeight: summary.cargoWeight || null,
          cargoVolume: summary.cargoVolume || null,
        },
      })

      return { route: finalRoute, orders: createdOrders }
    })

    return NextResponse.json({
      success: true,
      routeId: created.route.id,
      ordersCount: created.orders.length,
      route: serializeRoute(created.route),
      stats: summarizeRoute(created.orders),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Route creation error"
    console.error("[Routes API] POST /api/routes error:", message, error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
