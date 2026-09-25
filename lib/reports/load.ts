// lib/reports/load.ts
//
// Загрузка данных для отчёта (задача 8): одни и те же запросы обслуживают и
// страницу отчётов, и выгрузку, и печатную версию — иначе «отчёт на экране» и
// «отчёт в файле» однажды разошлись бы в числах.
//
// Все выборки ограничены организацией из сессии и потолками (limits ниже):
// отчёт строится по базе любой величины, но не роняет сервер.

import { prisma } from "@/lib/prisma"
import { scopedWhere } from "@/lib/org"
import {
  buildPeriod,
  buildReport,
  type ReportDriver,
  type ReportExpense,
  type ReportOrder,
  type ReportPreset,
  type ReportResult,
  type ReportRoute,
  type ReportVehicle,
} from "./aggregate"
import { buildInsights, type Insight } from "./insights"

/** Потолки выборок: см. комментарий выше. */
export const REPORT_LIMITS = {
  orders: 5000,
  routes: 2000,
  expenses: 5000,
  paymentOrders: 3000,
} as const

const MS_DAY = 24 * 60 * 60 * 1000

export type LoadedReport = {
  report: ReportResult
  insights: Insight[]
  companyName: string | null
}

/** Период отчёта по параметрам запроса (пресеты + произвольные даты). */
export function periodFromParams(params: {
  preset?: string | null
  from?: string | null
  to?: string | null
  now?: Date
}) {
  const presets: ReportPreset[] = ["7d", "30d", "90d", "month", "year"]
  const preset =
    params.preset && presets.includes(params.preset as ReportPreset)
      ? (params.preset as ReportPreset)
      : "30d"

  return buildPeriod(preset, { from: params.from, to: params.to, now: params.now })
}

/**
 * Полный отчёт организации за период.
 *
 * Заказы и рейсы берутся за период и за предыдущий такой же — для сравнения;
 * расходы — по дате чека (и по дате, и по рейсу их связывает агрегатор);
 * оплаты — по всей базе: долг живёт дольше выбранного периода.
 */
export async function loadReport(
  organizationId: string,
  period: ReturnType<typeof buildPeriod>,
): Promise<LoadedReport> {
  const spanDays = Math.max(
    1,
    Math.floor((period.to.getTime() - period.from.getTime()) / MS_DAY) + 1,
  )
  const previousFrom = new Date(period.from.getTime() - (spanDays + 1) * MS_DAY)

  const [orders, routes, expenses, vehicles, drivers, paymentOrders, organization] =
    await Promise.all([
      prisma.order.findMany({
        where: scopedWhere(organizationId, {
          OR: [
            { deliveredAt: { gte: previousFrom, lte: period.to } },
            { deliveredAt: null, createdAt: { gte: previousFrom, lte: period.to } },
          ],
        }),
        orderBy: [{ createdAt: "desc" }],
        take: REPORT_LIMITS.orders,
        select: {
          id: true,
          status: true,
          createdAt: true,
          deliveredAt: true,
          deadline: true,
          dueDate: true,
          deferredDays: true,
          paidAt: true,
          isPaid: true,
          price: true,
          agreedPrice: true,
          distance: true,
          weight: true,
          cargoType: true,
          routeFrom: true,
          routeTo: true,
          clientId: true,
          clientName: true,
          assignedDriverId: true,
          assignedVehicleId: true,
          routeId: true,
        },
      }),

      prisma.route.findMany({
        where: scopedWhere(organizationId, {
          OR: [
            { startedAt: { gte: previousFrom, lte: period.to } },
            { startedAt: null, createdAt: { gte: previousFrom, lte: period.to } },
          ],
        }),
        orderBy: [{ createdAt: "desc" }],
        take: REPORT_LIMITS.routes,
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          totalDistance: true,
          startOdometer: true,
          endOdometer: true,
          driverId: true,
          vehicleId: true,
        },
      }),

      prisma.routeExpense.findMany({
        where: scopedWhere(organizationId, {
          spentAt: { gte: previousFrom, lte: period.to },
        }),
        orderBy: [{ spentAt: "desc" }],
        take: REPORT_LIMITS.expenses,
        select: {
          id: true,
          routeId: true,
          type: true,
          amount: true,
          liters: true,
          spentAt: true,
        },
      }),

      prisma.vehicle.findMany({
        where: scopedWhere(organizationId, {}),
        select: { id: true, plate: true, brand: true, model: true, status: true },
      }),

      prisma.driver.findMany({
        where: scopedWhere(organizationId, {}),
        select: { id: true, name: true, status: true },
      }),

      prisma.order.findMany({
        where: scopedWhere(organizationId, {
          OR: [{ price: { gt: 0 } }, { agreedPrice: { gt: 0 } }],
        }),
        orderBy: [{ createdAt: "desc" }],
        take: REPORT_LIMITS.paymentOrders,
        select: {
          id: true,
          status: true,
          createdAt: true,
          deliveredAt: true,
          deadline: true,
          dueDate: true,
          deferredDays: true,
          paidAt: true,
          isPaid: true,
          price: true,
          agreedPrice: true,
          distance: true,
          clientId: true,
          clientName: true,
          assignedDriverId: true,
          assignedVehicleId: true,
          routeId: true,
        },
      }),

      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
    ])

  const report = buildReport(
    {
      orders: orders as ReportOrder[],
      routes: routes as ReportRoute[],
      expenses: expenses as ReportExpense[],
      vehicles: vehicles as ReportVehicle[],
      drivers: drivers as ReportDriver[],
      paymentOrders: paymentOrders as ReportOrder[],
    },
    period,
  )

  return {
    report,
    insights: buildInsights({
      report,
      periodLabel: period.label,
      companyName: organization?.name ?? null,
    }),
    companyName: organization?.name ?? null,
  }
}
