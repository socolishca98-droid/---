// app/api/reports/shift-time/route.ts
//
// GET /api/reports/shift-time — время водителей за период.
//
// Отвечает на вопрос владельца и логиста: «Сколько водители простояли на
// погрузке? Сколько ждали у ворот? Сколько ехали и сколько отдыхали?»
//
// Числа берутся из журнала кнопок водителя (ShiftEvent), поэтому это
// измеренное время, а не нормативное. Смены без событий отдельно указаны:
// если водитель не отмечал статусы, время не измерено — и врать тут нельзя.
//
// Все запросы ограничены организацией из сессии.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { prisma } from "@/lib/prisma"
import { buildShiftTimeReport, type ShiftTimeReport } from "@/lib/analytics/shift-time"
import { periodFromParams } from "@/lib/reports/load"

export const dynamic = "force-dynamic"

/** Ограничения выборки: период не должен превращаться в вечную выгрузку. */
const LIMITS = {
  shifts: 500,
  eventsPerShift: 400,
}

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
    const driverId = searchParams.get("driverId")

    const shifts = await prisma.driverShift.findMany({
      where: {
        organizationId: org.organizationId,
        startedAt: { lte: period.to },
        OR: [{ endedAt: { gte: period.from } }, { endedAt: null }],
        ...(driverId ? { driverId } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: LIMITS.shifts,
      select: {
        id: true,
        driverId: true,
        startedAt: true,
        endedAt: true,
        driver: { select: { name: true } },
        events: {
          where: { type: "status" },
          orderBy: { createdAt: "asc" },
          take: LIMITS.eventsPerShift,
          select: { createdAt: true, metadata: true },
        },
      },
    })

    const report: ShiftTimeReport = buildShiftTimeReport(
      shifts.map((shift) => ({
        id: shift.id,
        driverId: shift.driverId,
        driverName: shift.driver?.name ?? "Водитель",
        startedAt: new Date(shift.startedAt),
        endedAt: shift.endedAt ? new Date(shift.endedAt) : null,
        events: shift.events.map((event) => {
          let status = ""
          let orderId: string | null = null
          if (event.metadata) {
            try {
              const meta = JSON.parse(event.metadata) as { to?: string; orderId?: string | null }
              if (typeof meta.to === "string") status = meta.to
              if (typeof meta.orderId === "string") orderId = meta.orderId
            } catch {
              // Битое событие не должно ронять отчёт
            }
          }
          return { at: new Date(event.createdAt), status, orderId }
        }),
      })),
    )

    return NextResponse.json({
      success: true,
      period: { from: period.from, to: period.to },
      report,
      limits: LIMITS,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось построить отчёт"
    console.error("[reports/shift-time] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
