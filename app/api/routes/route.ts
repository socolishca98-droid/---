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
import {
  canChangeOrderStatus,
  isOrderRouteable,
  normalizeOrderStatus,
  orderStatusLabel,
} from "@/lib/orders/stages"

/** Сколько заказов можно включить в один рейс одним запросом. */
const MAX_ROUTE_ORDERS = 50

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
  /** Машина необязательна: рейс можно собрать до этапа «Назначение». */
  vehicleId?: string | null
  driverId?: string | null
  /** Новые грузы (путь песочницы): по ним создаются заказы организации. */
  orders?: SandboxOrderPayload[]
  /**
   * Существующие заказы организации, которые включаются в рейс.
   * Основной путь: на холст попадают только согласованные заказы.
   */
  orderIds?: string[]
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

    const { vehicleId, driverId, orders, orderIds, name, notes } = body

    const payloads = Array.isArray(orders) ? orders : []
    const linkIds = Array.isArray(orderIds)
      ? orderIds.filter((value): value is string => typeof value === "string" && value.length > 0)
      : []

    if (payloads.length === 0 && linkIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Передайте orderIds[] (существующие заказы) или orders[] (новые грузы)",
        },
        { status: 400 },
      )
    }
    if (linkIds.length > MAX_ROUTE_ORDERS) {
      return NextResponse.json(
        { success: false, error: `В одном рейсе максимум ${MAX_ROUTE_ORDERS} заказов` },
        { status: 400 },
      )
    }

    // ── Машина и водитель: необязательны ──
    // Этап «Маршрут» идёт раньше этапов «Документы» и «Назначение», поэтому
    // рейс можно собрать, ещё не выбрав машину.
    let vehicle: {
      id: string
      plate: string | null
      type: string | null
      capacity: number
      status: string
    } | null = null

    if (vehicleId) {
      const found = await prisma.vehicle.findFirst({
        where: scopedWhere(org.organizationId, { id: vehicleId }),
        select: { id: true, plate: true, type: true, capacity: true, status: true },
      })
      if (!found) {
        return NextResponse.json({ success: false, error: "Машина не найдена" }, { status: 404 })
      }
      vehicle = found
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
      if (vehicle) {
        const occupant = await findVehicleOccupant(prisma, vehicle.id, driverId, org.organizationId)
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
    }

    // ── Существующие заказы, которые привязываются к рейсу ──
    const linked =
      linkIds.length > 0
        ? await prisma.order.findMany({
            where: scopedWhere(org.organizationId, { id: { in: linkIds } }),
            select: {
              id: true,
              status: true,
              routeId: true,
              routeFrom: true,
              routeTo: true,
              distance: true,
              weight: true,
              volume: true,
              price: true,
              isAdditionalLoad: true,
            },
          })
        : []

    const notFound = linkIds.filter((id) => !linked.some((order) => order.id === id))
    if (notFound.length > 0) {
      return NextResponse.json(
        { success: false, error: `Заказы не найдены: ${notFound.join(", ")}` },
        { status: 404 },
      )
    }

    // На холст и в рейс попадают только согласованные заказы
    const notAgreed = linked.filter((order) => !isOrderRouteable(order.status))
    if (notAgreed.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `В рейс можно брать только согласованные заказы. Не подходят: ${notAgreed
            .map((order) => `${order.routeFrom} → ${order.routeTo} (${orderStatusLabel(order.status)})`)
            .join("; ")}`,
          code: "orders_not_agreed",
          orderIds: notAgreed.map((order) => order.id),
        },
        { status: 409 },
      )
    }

    const alreadyInRoute = linked.filter((order) => order.routeId)
    if (alreadyInRoute.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Заказы уже включены в другой рейс: ${alreadyInRoute
            .map((order) => `${order.routeFrom} → ${order.routeTo}`)
            .join("; ")}`,
          code: "orders_already_in_route",
          orderIds: alreadyInRoute.map((order) => order.id),
        },
        { status: 409 },
      )
    }

    // ── Новые грузы: проверяем, нет ли уже заказа на эту строку базы ATI ──
    const payloadCacheIds = payloads
      .map((o) => o.atiCacheId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
    const duplicatePayloads = payloadCacheIds.filter(
      (value, index) => payloadCacheIds.indexOf(value) !== index,
    )
    if (duplicatePayloads.length > 0) {
      return NextResponse.json(
        { success: false, error: "Один и тот же груз передан в рейс дважды" },
        { status: 400 },
      )
    }

    const existingByCache =
      payloadCacheIds.length > 0
        ? await prisma.order.findMany({
            where: scopedWhere(org.organizationId, { atiCacheId: { in: payloadCacheIds } }),
            select: {
              id: true,
              atiCacheId: true,
              status: true,
              routeId: true,
              routeFrom: true,
              routeTo: true,
              distance: true,
              weight: true,
              volume: true,
              price: true,
              isAdditionalLoad: true,
            },
          })
        : []

    const conflicting = existingByCache.filter((order) => order.routeId)
    if (conflicting.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Заказы уже включены в другой рейс: ${conflicting
            .map((order) => `${order.routeFrom} → ${order.routeTo}`)
            .join("; ")}`,
          code: "orders_already_in_route",
          orderIds: conflicting.map((order) => order.id),
        },
        { status: 409 },
      )
    }

    const totalWeight =
      payloads.reduce((sum, o) => sum + (o.weight || 0), 0) +
      linked.reduce((sum, o) => sum + (o.weight || 0), 0)
    if (vehicle && vehicle.capacity > 0 && totalWeight > vehicle.capacity) {
      return NextResponse.json(
        {
          success: false,
          error: "Превышена грузоподъёмность машины",
          details: { capacity: vehicle.capacity, totalWeight },
        },
        { status: 400 },
      )
    }

    const created = await prisma.$transaction(async (tx: any) => {
      const route = await tx.route.create({
        data: {
          organizationId: org.organizationId,
          name: name?.trim() || null,
          status: "planned",
          driverId: driverId || null,
          vehicleId: vehicle?.id ?? null,
          notes: notes?.trim() || null,
        },
      })

      const actorName = auth.value.user?.name ?? auth.value.user?.email ?? null
      const routeOrders: RouteOrderLike[] = []
      const takenOrderIds = new Set<string>(linkIds)
      let sequence = 0

      /** Запись в ленту согласования: статус заказа изменился сервером. */
      const logStatusChange = async (
        orderId: string,
        from: string,
        to: string,
        reason: string,
      ) => {
        await tx.orderNegotiation.create({
          data: {
            organizationId: org.organizationId,
            orderId,
            kind: "status_change",
            text: `Статус: ${orderStatusLabel(from)} → ${orderStatusLabel(to)} (${reason})`,
            priceOffer: null,
            authorId: org.userId,
            authorName: actorName,
          },
        })
      }

      // 1) Существующие согласованные заказы — основной путь сборки рейса
      for (const order of linked) {
        sequence += 1
        const current = normalizeOrderStatus(order.status)
        const next = canChangeOrderStatus(order.status, "in_route") ? "in_route" : current

        await tx.order.updateMany({
          where: scopedWhere(org.organizationId, { id: order.id, routeId: null }),
          data: {
            routeId: route.id,
            routeSequence: sequence,
            addedToRouteAt: new Date(),
            ...(next && { status: next }),
            ...(vehicle && { assignedVehicleId: vehicle.id }),
            ...(driverId && { assignedDriverId: driverId }),
          },
        })

        if (next && current && next !== current) {
          await logStatusChange(order.id, order.status, next, "включён в рейс")
        }

        routeOrders.push({ ...order, status: next ?? order.status, routeSequence: sequence })
      }

      // 2) Новые грузы из песочницы. Если заказ на эту строку базы ATI у
      //    организации уже есть — дубль не создаём (в схеме уникальность
      //    [organizationId, atiCacheId]), а привязываем существующий.
      for (const payload of payloads) {
        const existing = payload.atiCacheId
          ? existingByCache.find((order) => order.atiCacheId === payload.atiCacheId)
          : undefined

        if (existing) {
          if (takenOrderIds.has(existing.id)) continue // уже включён в этот рейс
          takenOrderIds.add(existing.id)
          sequence += 1
          const current = normalizeOrderStatus(existing.status)
          const next = canChangeOrderStatus(existing.status, "in_route") ? "in_route" : current

          await tx.order.updateMany({
            where: scopedWhere(org.organizationId, { id: existing.id, routeId: null }),
            data: {
              routeId: route.id,
              routeSequence: sequence,
              addedToRouteAt: new Date(),
              ...(next && { status: next }),
              ...(vehicle && { assignedVehicleId: vehicle.id }),
              ...(driverId && { assignedDriverId: driverId }),
            },
          })

          if (next && current && next !== current) {
            await logStatusChange(existing.id, existing.status, next, "включён в рейс")
          }

          routeOrders.push({ ...existing, status: next ?? existing.status, routeSequence: sequence })
          continue
        }

        sequence += 1
        const createdOrder = await tx.order.create({
          data: {
            organizationId: org.organizationId,
            source: payload.atiCacheId ? "ATI" : "manual",
            sourceId: payload.atiCacheId || null,
            // связь со строкой накопленной базы: по ней заказ находится в базе ATI
            atiCacheId: payload.atiCacheId || null,
            routeFrom: payload.routeFrom,
            routeTo: payload.routeTo,
            distance: payload.distance || 0,
            weight: payload.weight || 0,
            volume: payload.volume ?? null,
            cargoType: payload.cargo || "Груз",
            loadingType: "other",
            price: payload.price || 0,
            priceNegotiable: !payload.price || payload.price === 0,
            clientName: payload.clientCompany || null,
            clientContact: payload.clientPhone || "",
            deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            // заказ сразу в рейсе: согласование пройдено до сборки маршрута
            status: "in_route",
            priority: "needs_clarification",
            aiScore: 50,
            assignedDriverId: driverId || null,
            assignedVehicleId: vehicle?.id ?? null,
            routeId: route.id,
            isAdditionalLoad: false,
            addedToRouteAt: new Date(),
            proposedToDriver: false,
            routeSequence: sequence,
          },
        })
        routeOrders.push(createdOrder)
      }

      // Общая таблица AtiCache намеренно не меняется: это накопленная база всей
      // платформы, и пометка «imported» спрятала бы груз от других организаций.
      // Принадлежность заказа строке базы хранится в Order.atiCacheId.

      // связь «водитель ↔ машина» пишется ровно один раз и только здесь
      if (driverId && vehicle) {
        await linkDriverToVehicle(tx, driverId, vehicle.id, org.organizationId)
        await tx.driver.updateMany({
          where: scopedWhere(org.organizationId, { id: driverId }),
          data: { status: "busy" },
        })
      }

      if (vehicle) {
        await tx.vehicle.updateMany({
          where: scopedWhere(org.organizationId, { id: vehicle.id }),
          data: { status: "in_use" },
        })
      }

      const summary = summarizeRoute(routeOrders)
      // org-audit: manual — рейс создан этой же транзакцией с organizationId вызывающего
      const finalRoute = await tx.route.update({
        where: { id: route.id },
        data: {
          name: name?.trim() || buildRouteName(routeOrders) || null,
          status: deriveRouteStatus(routeOrders.map((o) => o.status)),
          totalDistance: summary.totalDistance || null,
          cargoWeight: summary.cargoWeight || null,
          cargoVolume: summary.cargoVolume || null,
        },
      })

      return { route: finalRoute, orders: routeOrders }
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
