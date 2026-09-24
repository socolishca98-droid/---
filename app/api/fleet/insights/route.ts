// app/api/fleet/insights/route.ts
//
// GET /api/fleet/insights — практика вместо «процента загрузки автопарка»
// (задача 4): какие машины простаивают и сколько дней, что пора обслужить
// (ТО, страховка, техосмотр, открытые работы) и кто из водителей на какой
// машине ездил.
//
// Все выборки — в границах организации из сессии; счёт логики — в
// lib/fleet/insights.ts (чистый модуль, покрыт тестами).

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { OCCUPYING_ORDER_STATUSES } from "@/lib/orders/stages"
import { buildFleetInsights, SERVICE_WARNING_DAYS } from "@/lib/fleet/insights"

export const dynamic = "force-dynamic"

/** Сколько последних рейсов организации читаем для истории назначений. */
const ROUTES_LIMIT = 300

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const warningDaysParam = Number(request.nextUrl.searchParams.get("warningDays"))
    const warningDays =
      Number.isFinite(warningDaysParam) && warningDaysParam > 0 && warningDaysParam <= 365
        ? Math.round(warningDaysParam)
        : SERVICE_WARNING_DAYS

    const [vehicles, drivers, activeOrders, routes, maintenance] = await Promise.all([
      prisma.vehicle.findMany({
        where: scopedWhere(org.organizationId, {}),
        orderBy: [{ plate: "asc" }],
        select: {
          id: true,
          plate: true,
          type: true,
          brand: true,
          model: true,
          status: true,
          mileage: true,
          lastMaintenanceDate: true,
          nextMaintenanceDate: true,
          insuranceExpiry: true,
          inspectionExpiry: true,
          createdAt: true,
        },
      }),
      prisma.driver.findMany({
        where: scopedWhere(org.organizationId, {}),
        select: { id: true, name: true, vehicleId: true, status: true },
      }),
      prisma.order.findMany({
        where: scopedWhere(org.organizationId, {
          status: { in: OCCUPYING_ORDER_STATUSES as unknown as string[] },
        }),
        select: {
          id: true,
          assignedVehicleId: true,
          assignedDriverId: true,
          routeFrom: true,
          routeTo: true,
          status: true,
          deadline: true,
        },
      }),
      prisma.route.findMany({
        where: scopedWhere(org.organizationId, {}),
        orderBy: [{ createdAt: "desc" }],
        take: ROUTES_LIMIT,
        select: {
          id: true,
          name: true,
          vehicleId: true,
          driverId: true,
          status: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
        },
      }),
      prisma.maintenanceLog.findMany({
        where: scopedWhere(org.organizationId, {}),
        orderBy: [{ startedAt: "desc" }],
        take: 100,
        select: {
          id: true,
          vehicleId: true,
          type: true,
          description: true,
          status: true,
          startedAt: true,
          completedAt: true,
        },
      }),
    ])

    const insights = buildFleetInsights({
      vehicles,
      drivers,
      activeOrders,
      routes,
      maintenance,
      warningDays,
    })

    return NextResponse.json({
      success: true,
      warningDays,
      ...insights,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось собрать сводку по автопарку"
    console.error("[Fleet Insights] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
