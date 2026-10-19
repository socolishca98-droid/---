// app/api/routes/history/route.ts
//
// История рейсов: чем и когда возили и кто из клиентов ещё не заплатил.
//
// Зачем отдельный эндпоинт, а не ?dateFrom/dateTo у /api/routes: вопрос
// «что машина везла месяц назад и по какому заказу не поступила оплата»
// требует в одном ответе и рейсы целиком (маршрут, машина, водитель), и
// заказы с составом оплаты и контактами клиента. /api/routes отдаёт список
// заказов без платежных условий — для истории их пришлось бы догружать
// вторым запросом на каждый рейс.
//
// GET /api/routes/history
//   ?days=7|30|90|0      — период: 0 = всё время (по умолчанию 30)
//   ?vehicleId=...       — только рейсы этой машины
//   ?driverId=...        — только рейсы этого водителя
//   ?onlyOverdue=1       — только рейсы, где есть заказы с просрочкой оплаты
//   ?limit=100           — сколько рейсов отдавать (свежие сверху)
//
// Ответ: routes[] (заказы в порядке точек + состояние оплаты по каждому),
// summary (итоги периода), vehicles/drivers (списки для фильтров экрана).

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { routeOrdersOrderBy } from "@/lib/routes/service"
import { orderStatusLabel } from "@/lib/orders/stages"
import { routeStatusLabel } from "@/lib/routes/model"
import {
  historyOrdersInOrder,
  historySummary,
  orderPaymentState,
  routeHistoryDate,
  routeStateLabel,
  type HistoryOrder,
  type HistoryRoute,
} from "@/lib/logist-mobile/route-history"

/** Периоды, которые понимает экран. 0 — всё время. */
const ALLOWED_DAYS = [7, 30, 90, 0] as const

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 60

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const { searchParams } = new URL(request.url)

  const daysRaw = Number.parseInt(searchParams.get("days") || "", 10)
  const days = Number.isNaN(daysRaw) ? 30 : daysRaw
  if (!ALLOWED_DAYS.includes(days as (typeof ALLOWED_DAYS)[number])) {
    return NextResponse.json(
      {
        success: false,
        error: `Неизвестный период: ${searchParams.get("days")}. Доступно: ${ALLOWED_DAYS.join(", ")} (0 — всё время)`,
      },
      { status: 400 },
    )
  }

  const vehicleId = (searchParams.get("vehicleId") || "").trim() || null
  const driverId = (searchParams.get("driverId") || "").trim() || null
  const onlyOverdue = searchParams.get("onlyOverdue") === "1"
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(searchParams.get("limit") || "", 10) || DEFAULT_LIMIT),
  )

  try {
    // Период: рейс попадает в историю, если его везли в эти дни. Дата поездки —
    // startedAt, иначе completedAt, иначе createdAt (рейс могли создать заранее).
    const where: Record<string, unknown> = {}
    if (days > 0) {
      const from = new Date()
      from.setHours(0, 0, 0, 0)
      from.setDate(from.getDate() - days)
      where.OR = [
        { startedAt: { gte: from } },
        { startedAt: null, completedAt: { gte: from } },
        { startedAt: null, completedAt: null, createdAt: { gte: from } },
      ]
    }
    if (vehicleId) where.vehicleId = vehicleId
    if (driverId) where.driverId = driverId

    const [rows, vehicles, drivers] = await Promise.all([
      prisma.route.findMany({
        where: scopedWhere(org.organizationId, where),
        include: {
          driver: { select: { id: true, name: true, phone: true } },
          vehicle: { select: { id: true, plate: true, type: true } },
          orders: {
            where: scopedWhere(org.organizationId, {}),
            orderBy: routeOrdersOrderBy,
            include: {
              client: {
                select: {
                  id: true,
                  name: true,
                  inn: true,
                  phone: true,
                  email: true,
                  address: true,
                  paymentType: true,
                  deferredDays: true,
                },
              },
            },
          },
        },
        orderBy: [{ startedAt: "desc" }, { completedAt: "desc" }, { createdAt: "desc" }],
        take: limit,
      }),
      prisma.vehicle.findMany({
        where: scopedWhere(org.organizationId, {}),
        select: { id: true, plate: true, type: true },
        orderBy: { plate: "asc" },
      }),
      prisma.driver.findMany({
        where: scopedWhere(org.organizationId, {}),
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ])

    const now = new Date()

    /** Рейсы в виде модуля истории — из них же считаем и сводку периода. */
    const historyRoutes: HistoryRoute[] = []

    const routes = rows
      // Пустой рейс в истории не показывает ничего: ни маршрута, ни груза,
      // ни денег. Это остаток снятых заказов (например после пересборки),
      // и в списке «что возили» он только путает.
      .filter((route) => route.orders.length > 0)
      .map((route) => {
      const orders = historyOrdersInOrder(route as unknown as HistoryRoute).map((order) => {
        const payment = orderPaymentState(order, now)
        return {
          id: order.id,
          routeSequence: (order as { routeSequence?: number | null }).routeSequence ?? null,
          routeFrom: order.routeFrom,
          routeTo: order.routeTo,
          distance: order.distance ?? null,
          cargoType: (order as { cargoType?: string | null }).cargoType ?? null,
          weight: (order as { weight?: number | null }).weight ?? null,
          status: order.status,
          statusLabel: orderStatusLabel(order.status),
          clientName: order.clientName,
          clientContact: order.clientContact,
          client: (order as { client?: unknown }).client ?? null,
          price: (order as { price?: number | null }).price ?? null,
          agreedPrice: (order as { agreedPrice?: number | null }).agreedPrice ?? null,
          payment,
        }
      })

      const historyRoute: HistoryRoute = {
        id: route.id,
        name: route.name,
        status: route.status,
        startedAt: route.startedAt,
        completedAt: route.completedAt,
        createdAt: route.createdAt,
        driverId: route.driverId,
        driverName: route.driver?.name ?? null,
        vehicleId: route.vehicleId,
        vehiclePlate: route.vehicle?.plate ?? null,
        totalDistance: route.totalDistance,
        cargoWeight: route.cargoWeight,
        orders: route.orders.map((order) => order as unknown as HistoryOrder),
      }
      historyRoutes.push(historyRoute)

      const date = routeHistoryDate(historyRoute)

      return {
        id: route.id,
        name: route.name,
        status: route.status,
        statusLabel: routeStateLabel(route.status) || routeStatusLabel(route.status),
        date: date ? date.toISOString() : null,
        startedAt: route.startedAt ? route.startedAt.toISOString() : null,
        completedAt: route.completedAt ? route.completedAt.toISOString() : null,
        driver: route.driver ? { id: route.driver.id, name: route.driver.name, phone: route.driver.phone } : null,
        vehicle: route.vehicle ? { id: route.vehicle.id, plate: route.vehicle.plate, type: route.vehicle.type } : null,
        totalDistance: route.totalDistance ?? null,
        cargoWeight: route.cargoWeight ?? null,
        orders,
        // Суммы рейса — чтобы в списке было видно, есть ли по нему долг.
        amount: orders.reduce((sum, order) => sum + order.payment.amount, 0),
        overdueAmount: orders
          .filter((order) => order.payment.tone === "overdue")
          .reduce((sum, order) => sum + order.payment.amount, 0),
        overdueCount: orders.filter((order) => order.payment.tone === "overdue").length,
      }
    })

    // «Только с просрочкой» — фильтруем уже посчитанные состояния оплаты:
    // в БД такого условия нет, оплата — это поля заказа.
    const visible = onlyOverdue ? routes.filter((route) => route.overdueCount > 0) : routes

    // Сводка считаем тем же модулем, что и экран, — цифры в истории и в
    // разделе «Платежи» не расходятся.
    const summary = historySummary(
      onlyOverdue
        ? historyRoutes.filter((route) =>
            route.orders.some((order) => orderPaymentState(order, now).tone === "overdue"),
          )
        : historyRoutes,
      now,
    )

    return NextResponse.json({
      success: true,
      filters: { days, vehicleId, driverId, onlyOverdue },
      routes: visible,
      summary,
      vehicles,
      drivers,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
