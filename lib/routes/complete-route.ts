// lib/routes/complete-route.ts
//
// ЕДИНОЕ завершение рейса для диспетчера и для водителя.
//
// До этого файла завершение жило в двух местах и делало разное:
//   • POST /api/routes/[id]/complete  (диспетчер) — закрывал заказы, переводил
//     статус, пересчитывал итоги, списывал топливо, освобождал водителя и
//     машину, закрывал смену, слал уведомление;
//   • POST /api/m/route/stage → finish_trip (водитель) — только ставил
//     status=completed и completedAt.
//
// Разница имела последствия: водитель закрывал рейс с телефона, а заказы
// оставались in_route, итоги не пересчитывались, водитель не освобождался,
// смена не закрывалась, рейтинг водителя (он считается по доставленным
// заказам) не рос. Диспетчер после этого получал рейс «Завершён» с точками,
// которые не доставлены, и повторное complete отвечало 400 «Не все точки
// маршрута завершены».
//
// Теперь оба входа идут через одну функцию. Отличия — только в намерениях
// вызывающего: диспетчер может завершить принудительно (force), водительский
// finish_trip допускается только когда этапы уже закрыты (это проверяет
// checkTripCommand), поэтому для него закрытие заказов — не «принуждение», а
// фиксация факта.

import { prisma } from "@/lib/prisma"
import type { NotificationInput } from "@/lib/notifications/create"
import { createNotification } from "@/lib/notifications/create"
import { estimateFuelL, fuelAfterRoute } from "@/lib/fleet/fuel"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { OCCUPYING_ORDER_STATUSES, type RouteOrderLike } from "@/lib/routes/model"
import {
  changeRouteStatus,
  ensureRouteRow,
  recalcRoute,
  routeOrdersOrderBy,
  serializeRoute,
} from "@/lib/routes/service"

export interface CompleteRouteInput {
  routeId: string
  organizationId: string | null
  /**
   * Завершить, даже если по рейсу остались незавершённые точки: их заказы
   * будут переведены в «доставлен». Диспетчер передаёт force явно, водительский
   * finish_trip — нет: до него этапы уже закрыты по правилам этапа.
   */
  force?: boolean
  /** Кто завершил рейс — уходит в событие таймлайна */
  actorName: string
}

export interface CompleteRouteResult {
  ok: boolean
  /** HTTP-статус, который следует вернуть вызывающему роуту */
  status: 200 | 400 | 404 | 409 | 500
  error?: string
  /** Какие точки помешали завершению (только при status === 400) */
  pendingOrders?: Array<{
    id: string
    from: string | null | undefined
    to: string | null | undefined
    status: string
  }>
  route?: ReturnType<typeof serializeRoute> | null
  stats?: {
    ordersCount: number
    totalDistance: number
    totalWeight: number
    totalRevenue: number
    additionalLoads: number
  }
  /** Уведомление водителю: создать после коммита транзакции (пуш блокирует SQLite) */
  completionPush?: NotificationInput
  /** Сколько заказов было доведено до «доставлен» этим вызовом */
  closedOrders?: number
  /** Сколько из них закрыто принудительно (force) */
  forcedOrders?: number
}

/**
 * Завершает рейс: закрывает точки, статус, итоги, топливо, водителя, машину,
 * смену и уведомление — всё в одной транзакции.
 *
 * Никогда не бросает исключение: любая ошибка возвращается результатом.
 */
export async function completeRoute(
  input: CompleteRouteInput,
): Promise<CompleteRouteResult> {
  const { routeId, organizationId, force = false, actorName } = input

  try {
    let route = await prisma.route.findFirst({
      where: scopedWhere(organizationId, { id: routeId }),
      include: {
        orders: {
          where: scopedWhere(organizationId, {}),
          orderBy: routeOrdersOrderBy,
        },
      },
    })

    if (!route) {
      const legacyOrders = await prisma.order.count({
        where: scopedWhere(organizationId, { routeId }),
      })
      if (legacyOrders === 0) {
        return { ok: false, status: 404, error: "Маршрут не найден" }
      }
      // исторический routeId без строки Route — добираем запись
      await ensureRouteRow(prisma, { organizationId, routeId })
      route = await prisma.route.findFirst({
        where: scopedWhere(organizationId, { id: routeId }),
        include: {
          orders: {
            where: scopedWhere(organizationId, {}),
            orderBy: routeOrdersOrderBy,
          },
        },
      })
    }

    if (!route) {
      return { ok: false, status: 404, error: "Маршрут не найден" }
    }

    const orders = route.orders
    const assignedDriverId = route.driverId
    const assignedVehicleId = route.vehicleId

    const pendingOrders = (orders as (RouteOrderLike & { id: string })[]).filter(
      (o) => !["delivered", "cancelled", "rejected"].includes(o.status),
    )

    if (pendingOrders.length > 0 && !force) {
      return {
        ok: false,
        status: 400,
        error: "Не все точки маршрута завершены",
        pendingOrders: pendingOrders.map((o) => ({
          id: o.id,
          from: o.routeFrom,
          to: o.routeTo,
          status: o.status,
        })),
      }
    }

    const now = new Date()

    // Интерактивная транзакция делает десяток записей (точки, статус, топливо,
    // водитель, машина, уведомление): на медленной базе пяти секунд по
    // умолчанию не хватает, и завершение рейса падало с «Transaction not found».
    let completionPush: NotificationInput | undefined
    await prisma.$transaction(
      async (tx) => {
        if (pendingOrders.length > 0) {
          await tx.order.updateMany({
            where: scopedWhere(organizationId, {
              id: { in: pendingOrders.map((o) => o.id) },
            }),
            data: { status: "delivered", deliveredAt: now, updatedAt: now },
          })
        }

        // статус + время финиша + событие в таймлайн
        const transition = await changeRouteStatus(
          tx,
          routeId,
          {
            status: "completed",
            completedAt: now,
            reason:
              force && pendingOrders.length > 0
                ? "Завершён принудительно"
                : "Рейс завершён",
            actorName,
          },
          organizationId,
        )
        if (!transition.ok) throw new Error(transition.error)

        // пересчёт итогов рейса по заказам
        const summary = await recalcRoute(tx, routeId, organizationId)

        // Топливо: завершённый рейс списывает оценочный расход из бака машины.
        // Расстояние — сумма плеч заказов, загрузка — их суммарный вес: гружёная
        // машина ест больше (lib/fleet/fuel.ts).
        if (assignedVehicleId) {
          const vehicle = await tx.vehicle.findFirst({
            where: scopedWhere(organizationId, { id: assignedVehicleId }),
            select: {
              id: true,
              capacity: true,
              fuelTankL: true,
              fuelConsumptionPer100: true,
              fuelLevelL: true,
            },
          })
          if (
            vehicle &&
            vehicle.fuelLevelL !== null &&
            vehicle.fuelConsumptionPer100 !== null
          ) {
            const distanceKm = orders.reduce((sum, order) => sum + (order.distance || 0), 0)
            const loadKg = orders.reduce((sum, order) => sum + (order.weight || 0), 0)
            const used = estimateFuelL(vehicle, distanceKm, loadKg)
            const level = fuelAfterRoute(vehicle, used)
            if (level !== null && level !== vehicle.fuelLevelL) {
              await tx.vehicle.update({
                // защита в глубину: машина уже найдена по scopedWhere, но
                // обновление тоже не выходит за пределы организации
                where: { id: vehicle.id, organizationId },
                data: { fuelLevelL: level },
              })
            }
          }
        }

        if (assignedDriverId) {
          const otherActiveOrders = await tx.order.count({
            where: scopedWhere(organizationId, {
              assignedDriverId,
              routeId: { not: routeId },
              status: { in: [...OCCUPYING_ORDER_STATUSES] },
            }),
          })

          if (otherActiveOrders === 0) {
            await tx.driver.updateMany({
              where: scopedWhere(organizationId, { id: assignedDriverId }),
              data: { status: "available" },
            })
          }

          await tx.driverShift.updateMany({
            where: scopedWhere(organizationId, {
              driverId: assignedDriverId,
              endedAt: null,
            }),
            data: { endedAt: now, status: "completed" },
          })

          completionPush = {
            organizationId,
            userId: assignedDriverId,
            userRole: "driver",
            type: "route_completed",
            title: "Рейс завершён",
            message: `Маршрут из ${orders.length} точек успешно завершён`,
            routeId,
            priority: "normal",
          } as NotificationInput
          await createNotification(tx, completionPush, { push: false }) // пуш — после коммита

          await tx.driver.updateMany({
            where: scopedWhere(organizationId, { id: assignedDriverId }),
            data: { ordersCompleted: { increment: summary.deliveredOrders } },
          })
        }

        if (assignedVehicleId) {
          const otherActiveOrders = await tx.order.count({
            where: scopedWhere(organizationId, {
              assignedVehicleId,
              routeId: { not: routeId },
              status: { in: [...OCCUPYING_ORDER_STATUSES] },
            }),
          })

          if (otherActiveOrders === 0) {
            await tx.vehicle.updateMany({
              where: scopedWhere(organizationId, { id: assignedVehicleId }),
              data: { status: "available" },
            })
          }
        }
      },
      { maxWait: 10_000, timeout: 30_000 },
    )

    const updated = await prisma.route.findFirst({
      where: scopedWhere(organizationId, { id: routeId }),
    })
    const finalOrders = (await prisma.order.findMany({
      where: scopedWhere(organizationId, { routeId }),
      orderBy: routeOrdersOrderBy,
    })) as (RouteOrderLike & { id: string })[]

    return {
      ok: true,
      status: 200,
      route: updated ? serializeRoute(updated) : null,
      stats: {
        ordersCount: finalOrders.length,
        totalDistance: finalOrders.reduce((sum, o) => sum + (o.distance || 0), 0),
        totalWeight: finalOrders.reduce((sum, o) => sum + (o.weight || 0), 0),
        totalRevenue: finalOrders
          .filter((o) => o.status !== "cancelled" && o.status !== "rejected")
          .reduce((sum, o) => sum + (o.price || 0), 0),
        additionalLoads: finalOrders.filter((o) => o.isAdditionalLoad).length,
      },
      completionPush,
      closedOrders: pendingOrders.length,
      forcedOrders: force && pendingOrders.length > 0 ? pendingOrders.length : 0,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[completeRoute] Error:", message)

    // доменная ошибка (недопустимый переход статуса) — это 409, а не 500
    if (/статус|Рейс в статусе|Нельзя перевести/i.test(message)) {
      return { ok: false, status: 409, error: message }
    }
    return { ok: false, status: 500, error: message }
  }
}
