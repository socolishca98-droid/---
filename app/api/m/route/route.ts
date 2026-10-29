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

import { Prisma } from "@prisma/client"

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
import { getRouteTripEta } from "@/lib/eta/trip-repository"
import { availableTripActions } from "@/lib/eta/trip-actions"

export const dynamic = "force-dynamic"

/** Статусы рейса, которые ещё считаются активными. */
const CLOSED_ROUTE_STATUSES = ["completed", "cancelled"]

/**
 * Рейс водителя: сначала активный, иначе последний назначенный.
 *
 * Точки и расходы забираем вложенными выборками — одним обращением к базе
 * вместо трёх. У удалённой базы каждый отдельный запрос стоит около секунды,
 * и на экране водителя это была половина времени ответа.
 */
async function driverRoute(organizationId: string, driverId: string) {
  const select: Prisma.RouteSelect = {
    id: true,
    name: true,
    status: true,
    vehicleId: true,
    createdAt: true,
    startedAt: true,
    completedAt: true,
    totalDistance: true,
    startOdometer: true,
    endOdometer: true,
    vehicle: { select: { id: true, plate: true, type: true, capacity: true } },
    orders: {
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
        agreedPrice: true,
        routeSequence: true,
        isAdditionalLoad: true,
      },
    },
    expenses: {
      orderBy: [{ spentAt: "desc" }],
      take: 100,
      select: {
        id: true,
        type: true,
        amount: true,
        liters: true,
        odometer: true,
        vendor: true,
        spentAt: true,
        source: true,
        photoId: true,
      },
    },
  }

  const active = await prisma.route.findFirst({
    where: scopedWhere(organizationId, {
      driverId,
      status: { notIn: CLOSED_ROUTE_STATUSES },
    }),
    orderBy: { createdAt: "desc" },
    select,
  })
  if (active) return active

  return prisma.route.findFirst({
    where: scopedWhere(organizationId, { driverId }),
    orderBy: { createdAt: "desc" },
    select,
  })
}

/** Догрузы, предложенные водителю (их принимает /api/m/route/accept-load). */
function loadsProposedToDriver(organizationId: string, driverId: string) {
  return prisma.order.findMany({
    where: scopedWhere(organizationId, {
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
      agreedPrice: true,
      distance: true,
      clientName: true,
    },
  })
}

export async function GET(request: NextRequest) {
  // Диагностика скорости: ?timing=1 добавляет в ответ разбивку по шагам.
  // Без флага ничего не меняется. Нужна, чтобы спорить о медленном экране
  // числами, а не ощущениями.
  const timings: Record<string, number> | null = request.nextUrl.searchParams.has("timing")
    ? {}
    : null
  let mark = Date.now()
  const lap = (name: string) => {
    if (!timings) return
    const now = Date.now()
    timings[name] = now - mark
    mark = now
  }
  if (timings) mark = Date.now()

  const auth = await requireDriver(request)
  lap("auth")
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const driverId = auth.value.driver.id

  try {
    // 1. Рейс водителя и предложенные догрузы — независимые запросы, идём
    //    параллельно: последовательно каждый добавлял к ответу своё сетевое
    //    ожидание (замер по ?timing=1 — 2.5 с из 9 с).
    const [route, proposedLoads] = await Promise.all([
      driverRoute(org.organizationId, driverId),
      loadsProposedToDriver(org.organizationId, driverId),
    ])
    lap("route+loads")

    // 2. Точки рейса — по порядку объезда.
    // Точки и расходы пришли вместе с рейсом
    const routeOrders = route?.orders ?? []
    lap("orders")

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
        // Водителю показываем согласованную цену: она и есть итоговая
        price: order.agreedPrice ?? order.price,
        distanceKm: order.distance,
        clientName: order.clientName,
        clientContact: order.clientContact,
        isAdditionalLoad: order.isAdditionalLoad,
        isDone: status === "delivered",
        isClosed: isOrderClosed(order.status),
      }
    })

    // Расходы рейса (задача 7): водитель видит, что уже записано, и итог рейса.
    // Приходят вместе с рейсом — отдельного запроса больше нет.
    const expenses = route?.expenses ?? []
    lap("expenses")

    const completedCount = points.filter((point) => point.isDone).length
    const totalDistance = points.reduce((sum, point) => sum + (point.distanceKm || 0), 0)
    const totalWeight = points.reduce((sum, point) => sum + (point.weight || 0), 0)
    const totalPrice = points.reduce((sum, point) => sum + (point.price || 0), 0)

    // Прогноз рейса и доступные действия — из ЕДИНОГО механизма
    // (lib/eta/trip.ts), тем же, что пользуется карта логиста. Раньше
    // кабинет водителя считал ETA своей формулой (остаточное расстояние
    // ÷ 60), и числа расходились с логистским экраном.
    let trip: Awaited<ReturnType<typeof getRouteTripEta>> = null
    if (route) {
      try {
        // Этапы рейса должны существовать как строками, иначе некуда писать
        // фактические отметки водителя. Создаём их внутри getRouteTripEta:
        // отдельный вызов означал две загрузки рейса подряд, и ответ занимал
        // 13–17 секунд вместо секунд.
        trip = await getRouteTripEta({
          routeId: route.id,
          organizationId: org.organizationId,
          ensureStages: true,
          timings: timings ?? undefined,
        })
      } catch (tripError) {
        // Прогноз — не критичная часть ответа: без него экран водителя
        // обязан работать (смена, точки, догрузы)
        console.error("[Mobile Route] trip eta failed:", tripError)
      }
    }

    lap("tripEta")

    const tripActions = trip ? availableTripActions(trip, Boolean(route?.startedAt)) : null

    lap("actions")

    return NextResponse.json({
      success: true,
      ...(timings ? { timings } : {}),
      trip: trip && tripActions
        ? {
            startedAt: route?.startedAt?.toISOString() ?? null,
            currentStageIndex: tripActions.currentStageIndex,
            finished: tripActions.finished,
            actions: tripActions.available,
            blocked: tripActions.blocked,
            nextPoint: trip.nextPoint
              ? {
                  address: trip.nextPoint.address,
                  operation: trip.nextPoint.operation,
                  orderId: trip.nextPoint.orderId,
                  distanceM: trip.nextPoint.distanceM,
                  drivingSec: Math.round(trip.nextPoint.drivingSec),
                  arrivalAt: trip.nextPoint.arrivalAt.toISOString(),
                }
              : null,
            remaining: {
              drivingSec: Math.round(trip.remaining.drivingSec),
              stopsSec: Math.round(trip.remaining.stopsSec),
              restSec: Math.round(trip.remaining.restSec),
              totalSec: Math.round(trip.remaining.totalSec),
              arrivalAt: trip.remaining.arrivalAt.toISOString(),
            },
            returnToBase: trip.returnToBase
              ? {
                  address: trip.returnToBase.address,
                  distanceM: trip.returnToBase.distanceM,
                  drivingSec: Math.round(trip.returnToBase.drivingSec),
                  arrivalAt: trip.returnToBase.arrivalAt.toISOString(),
                }
              : null,
            completionAt: trip.completionAt.toISOString(),
            // Обязательные перерывы: сумма была и раньше, но без привязки ко
            // времени водитель не понимал, когда именно ему нужно остановиться.
            restPlan: {
              breaks: trip.restPlan.breaks.map((rest) => ({
                afterStageIndex: rest.afterStageIndex,
                minutes: rest.minutes,
                kind: rest.kind,
                reason: rest.reason,
                startAt: rest.startAt.toISOString(),
                endAt: rest.endAt.toISOString(),
              })),
              totalMinutes: trip.restPlan.totalMinutes,
              priorDrivingUnknown: trip.restPlan.priorDrivingUnknown,
              warning: trip.restPlan.warning ?? null,
            },
            stages: trip.stages.map((stage) => ({
              index: stage.index,
              kind: stage.kind,
              label: stage.label,
              status: stage.status,
              address: stage.address,
              actualStartAt: stage.actualStartAt?.toISOString() ?? null,
              actualEndAt: stage.actualEndAt?.toISOString() ?? null,
            })),
            // Предупреждения — массив строк: панель водителя показывает их
            // дословно («расстояние оценено по прямой», «погода отключена»)
            dataQuality: trip.dataQuality.warnings,
            // Надёжность + причина: без них водитель видел «приеду в 00:45»
            // без оговорки, даже когда часть заказов не геокодировалась и
            // маршрут построен короче реального. Предупреждения в dataQuality
            // панель печатает мелким шрифтом; reliable/reliabilityNote дают
            // ей возможность сказать об ограничении прямо.
            reliable: trip.reliable,
            reliabilityNote: trip.reliabilityNote ?? null,
          }
        : null,
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
