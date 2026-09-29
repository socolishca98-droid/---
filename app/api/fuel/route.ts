// app/api/fuel/route.ts
//
// Топливная ведомость организации: чеки водителей за период, итоги
// (литры, рубли, цена литра) и сводка по машинам «факт против оценки».
// Все данные — только своей организации (scopedWhere из сессии).

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { friendlyDbError, friendlyDbErrorStatus } from "@/lib/db/errors"
import { estimateFuelL } from "@/lib/fleet/fuel"
import { factFuelLiters } from "@/lib/fleet/fuel-audit"
import { entryPricePerL, ledgerTotals, vehicleRollup } from "@/lib/fuel/ledger"

const DEFAULT_DAYS = 30
const MAX_DAYS = 365
const MAX_ENTRIES = 500

// GET /api/fuel?days=30 — ведомость за последние N дней
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const { searchParams } = new URL(request.url)
    const daysRaw = parseInt(searchParams.get("days") || String(DEFAULT_DAYS), 10)
    const days = Number.isFinite(daysRaw)
      ? Math.min(MAX_DAYS, Math.max(1, daysRaw))
      : DEFAULT_DAYS
    const since = new Date(Date.now() - days * 86_400_000)

    const expenses = await prisma.routeExpense.findMany({
      where: scopedWhere(org.organizationId, {
        type: "fuel",
        spentAt: { gte: since },
      }),
      orderBy: { spentAt: "desc" },
      take: MAX_ENTRIES,
      include: {
        route: {
          select: {
            id: true,
            name: true,
            totalDistance: true,
            cargoWeight: true,
            vehicleId: true,
            driver: { select: { id: true, name: true } },
            vehicle: {
              select: {
                id: true,
                plate: true,
                capacity: true,
                fuelConsumptionPer100: true,
              },
            },
          },
        },
      },
    })

    // ── Книга чеков: строка ведомости на каждый чек ──
    const entries = expenses.map((expense: any) => ({
      id: expense.id,
      spentAt: expense.spentAt,
      liters: expense.liters,
      amountRub: expense.amount,
      pricePerL: entryPricePerL({ amount: expense.amount, liters: expense.liters }),
      vendor: expense.vendor,
      source: expense.source,
      odometer: expense.odometer,
      routeId: expense.route?.id ?? null,
      routeName: expense.route?.name ?? null,
      driverName: expense.route?.driver?.name ?? null,
      vehicleId: expense.route?.vehicleId ?? null,
      vehiclePlate: expense.route?.vehicle?.plate ?? null,
    }))

    // ── Аудит по рейсам: факт из чеков против оценки по паспорту машины ──
    const byRoute = new Map<string, typeof expenses>()
    for (const expense of expenses) {
      if (!expense.routeId) continue
      const list = byRoute.get(expense.routeId) ?? []
      list.push(expense)
      byRoute.set(expense.routeId, list)
    }

    const routeAudits: Array<{
      vehicleId: string | null
      factL: number | null
      estimatedL: number | null
      amountRub: number
    }> = []
    for (const routeExpenses of byRoute.values()) {
      const route: any = routeExpenses[0]?.route
      if (!route) continue
      const factL = factFuelLiters(routeExpenses as any)
      const estimatedL = route.vehicle
        ? estimateFuelL(
            {
              capacity: route.vehicle.capacity,
              fuelConsumptionPer100: route.vehicle.fuelConsumptionPer100,
            },
            route.totalDistance,
            route.cargoWeight ?? 0,
          )
        : null
      const amountRub = routeExpenses.reduce(
        (sum: number, expense: any) => sum + (Number(expense.amount) || 0),
        0,
      )
      routeAudits.push({ vehicleId: route.vehicleId ?? null, factL, estimatedL, amountRub })
    }

    const vehicles = vehicleRollup(routeAudits)
    const plateById = new Map<string, string>()
    for (const expense of expenses as any[]) {
      if (expense.route?.vehicle?.id && expense.route.vehicle.plate) {
        plateById.set(expense.route.vehicle.id, expense.route.vehicle.plate)
      }
    }
    const vehiclesWithPlates = vehicles.map((vehicle) => ({
      ...vehicle,
      plate: plateById.get(vehicle.vehicleId) ?? "—",
    }))

    return NextResponse.json({
      success: true,
      period: { days, since: since.toISOString() },
      totals: {
        // итоги — из сырых чеков (amount/liters), а не из строк книги
        ...ledgerTotals(expenses as any),
        flaggedVehicles: vehiclesWithPlates.filter((vehicle) => vehicle.flag).length,
      },
      vehicles: vehiclesWithPlates,
      entries,
    })
  } catch (error) {
    const status = friendlyDbErrorStatus(error)
    return NextResponse.json(
      { success: false, error: friendlyDbError(error) ?? "Не удалось загрузить ведомость" },
      { status },
    )
  }
}
