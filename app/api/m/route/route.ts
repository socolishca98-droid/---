// app/api/m/route/route.ts
//
// GET /api/m/route — рейс назначенного водителя для мобильного приложения
// (задача 3, пункт 3: «автоматическая передача информации назначенному
// водителю»).
//
// До этого главный экран водителя брал данные из штабных эндпоинтов
// (/api/drivers/[id]/active-order и /api/orders) — водительская сессия их не
// проходит, поэтому экран оставался пустым. Здесь всё берётся из сессии
// водителя: и рейс, и точки, и предложенные догрузы.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import {
  OCCUPYING_ORDER_STATUSES,
  isOrderClosed,
  normalizeOrderStatus,
  orderStatusLabel,
} from "@/lib/orders/stages"
import { buildTripSummary } from "@/lib/trips/history"

export const dynamic = "force-dynamic"

/** Статусы рейса, которые ещё считаются активными. */
const CLOSED_ROUTE_STATUSES = ["completed", "cancelled"]

export async function GET(request: NextRequest) {
  const auth = await requireDriver(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {
    // 1. Рейс водителя: сначала активный, иначе последний назначенный.
    let route = await prisma.route.findFirst({
      where: scopedWhere(org.organizationId, {
        driverId,
        status: { notIn: CLOSED_ROUTE_STATUSES },
      }),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        vehicleId: true,
        vehicle: { select: { id: true, plate: true, type: true, capacity: true } },
      },
    })

    if (!route) {
      route = await prisma.route.findFirst({
        where: scopedWhere(org.organizationId, { driverId }),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          vehicleId: true,
          vehicle: { select: { id: true, plate: true, type: true, capacity: true } },
        },
      })
    }

    // 2. Точки рейса — по порядку объезда.
    const routeOrders = route
      ? await prisma.order.findMany({
          where: scopedWhere(org.organizationId, { routeId: route.id }),
          orderBy: [{ routeSequence: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            routeFrom: true,
            routeTo: true,
            status: true,
            cargoType: true,
            weight: true,
            price: true,
            distance: true,
            clientName: true,
            clientContact: true,
            routeSequence: true,
            isAdditionalLoad: true,
          },
        })
      : []

    // 3. Догрузы, предложенные водителю (их принимает /api/m/route/accept-load).
    const proposedLoads = await prisma.order.findMany({
      where: scopedWhere(org.organizationId, {
        assignedDriverId: driverId,
        proposedToDriver: true,
      }),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        routeFrom: true,
        routeTo: true,
        status: true,
        cargoType: true,
        weight: true,
        price: true,
        distance: true,
        clientName: true,
      },
    })

    const points = routeOrders.map((order) => {
      const status = normalizeOrderStatus(order.status)
      return {
        id: order.id,
        sequence: order.routeSequence ?? null,
        from: order.routeFrom,
        to: order.routeTo,
        status: status ?? order.status,
        statusLabel: orderStatusLabel(order.status),
        cargoType: order.cargoType,
        weight: order.weight,
        price: order.price,
        distanceKm: order.distance,
        clientName: order.clientName,
        clientContact: order.clientContact,
        isAdditionalLoad: order.isAdditionalLoad,
        isDone: status === "delivered",
        isClosed: isOrderClosed(order.status),
      }
    })

    // Расходы рейса (задача 7): водитель видит, что уже записано, и итог рейса
    const expenses = route
      ? ((await prisma.routeExpense.findMany({
          where: scopedWhere(org.organizationId, { routeId: route.id }),
          orderBy: [{ spentAt: "desc" }],
          take: 100,
        })) as {
          id: string
          type: string | null
          amount: number
          liters: number | null
          odometer: number | null
          vendor: string | null
          spentAt: Date | null
          source: string | null
          photoId: string | null
        }[])
      : []

    const completedCount = points.filter((point) => point.isDone).length
    const totalDistance = points.reduce((sum, point) => sum + (point.distanceKm || 0), 0)
    const totalWeight = points.reduce((sum, point) => sum + (point.weight || 0), 0)
    const totalPrice = points.reduce((sum, point) => sum + (point.price || 0), 0)

    return NextResponse.json({
      success: true,
      route: route
        ? {
            id: route.id,
            name: route.name,
            status: route.status,
            vehiclePlate: route.vehicle?.plate ?? null,
            vehicleType: route.vehicle?.type ?? null,
            vehicleCapacity: route.vehicle?.capacity ?? null,
            ordersCount: points.length,
            completedCount,
            totalDistance,
            totalWeight,
            totalPrice,
            points,
            startOdometer: route.startOdometer ?? null,
            endOdometer: route.endOdometer ?? null,
            expenses: expenses.map((expense) => ({
              id: expense.id,
              type: expense.type ?? "fuel",
              amount: expense.amount,
              liters: expense.liters,
              odometer: expense.odometer,
              vendor: expense.vendor,
              spentAt: expense.spentAt,
              source: expense.source ?? "manual",
              photoId: expense.photoId,
            })),
            // Итог считается из тех же расходов и заказов, что и в кабинете логиста
            summary: buildTripSummary({
              route: {
                id: route.id,
                name: route.name,
                createdAt: route.createdAt,
                startedAt: route.startedAt,
                completedAt: route.completedAt,
                totalDistance: route.totalDistance,
                startOdometer: route.startOdometer,
                endOdometer: route.endOdometer,
              },
              orders: routeOrders.map((order) => ({
                id: order.id,
                status: order.status,
                price: order.price,
                agreedPrice: order.agreedPrice,
                distance: order.distance,
              })),
              expenses: expenses.map((expense) => ({
                id: expense.id,
                type: expense.type,
                amount: expense.amount,
                liters: expense.liters,
              })),
            }),
          }
        : null,
      // Статусы, при которых заказ считается «в работе» — для единообразия
      // мобильного списка (канон lib/orders/stages.ts).
      activeStatuses: [...OCCUPYING_ORDER_STATUSES],
      proposedLoads: proposedLoads.map((order) => ({
        id: order.id,
        routeFrom: order.routeFrom,
        routeTo: order.routeTo,
        status: normalizeOrderStatus(order.status) ?? order.status,
        statusLabel: orderStatusLabel(order.status),
        cargoType: order.cargoType,
        weight: order.weight,
        price: order.price,
        distanceKm: order.distance,
        clientName: order.clientName,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить рейс"
    console.error("[Mobile Route] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
