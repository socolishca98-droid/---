// app/api/reports/route.ts
//
// Отчёты (задача 8): настоящие агрегаты по своей организации.
//
// GET /api/reports?preset=7d|30d|90d|month|year&from=&to=
//
// Ответ: report (деньги, заказы, клиенты, водители, машины, парк, оплаты,
// данные о выборке) и insights — разбор правилами по этим числам.
//
// Ничего не выдумывается: заказы и рейсы — из «Заказов» и «Маршрутов»,
// расходы — из журнала расходов рейса (чеки водителей), оплаты — из «Оплат».
// Все запросы ограничены организацией из сессии (audit:orgs проверяет это).

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { REPORT_LIMITS, loadReport, periodFromParams } from "@/lib/reports/load"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { searchParams } = new URL(request.url)
    const period = periodFromParams({
      preset: searchParams.get("preset"),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    })

    const { report, insights, companyName } = await loadReport(org.organizationId, period)

    const ordersForBreakdown = await prisma.order.findMany({
      where: {
        organizationId: org.organizationId,
        archivedAt: null,
        createdAt: { gte: period.from, lte: period.to },
      },
      select: {
        price: true,
        distance: true,
        vehicle: { select: { id: true, plate: true, model: true } },
        driver: { select: { id: true, name: true } },
      },
    })

    const vehicleMap = new Map<string, { id: string; label: string; orders: number; revenueRub: number; distanceKm: number }>()
    const driverMap = new Map<string, { id: string; name: string; orders: number; revenueRub: number; distanceKm: number }>()

    for (const o of ordersForBreakdown) {
      const rev = o.price ?? 0
      const km = o.distance ?? 0
      if (o.vehicle) {
        const cur = vehicleMap.get(o.vehicle.id) ?? {
          id: o.vehicle.id,
          label: `${o.vehicle.plate}${o.vehicle.model ? ` · ${o.vehicle.model}` : ""}`,
          orders: 0,
          revenueRub: 0,
          distanceKm: 0,
        }
        cur.orders += 1
        cur.revenueRub += rev
        cur.distanceKm += km
        vehicleMap.set(o.vehicle.id, cur)
      }
      if (o.driver) {
        const cur = driverMap.get(o.driver.id) ?? {
          id: o.driver.id,
          name: o.driver.name,
          orders: 0,
          revenueRub: 0,
          distanceKm: 0,
        }
        cur.orders += 1
        cur.revenueRub += rev
        cur.distanceKm += km
        driverMap.set(o.driver.id, cur)
      }
    }

    const byVehicle = Array.from(vehicleMap.values()).sort((a, b) => b.revenueRub - a.revenueRub)
    const byDriver = Array.from(driverMap.values()).sort((a, b) => b.revenueRub - a.revenueRub)

    return NextResponse.json({
      success: true,
      companyName,
      report,
      insights,
      byVehicle,
      byDriver,
      limits: REPORT_LIMITS,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось построить отчёт"
    console.error("[Reports] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
