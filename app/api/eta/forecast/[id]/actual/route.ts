// app/api/eta/forecast/[id]/actual/route.ts
// Факт по прогнозу: POST /api/eta/forecast/:id/actual
//
// Зачем отдельный эндпоинт: без записи факта прогноз невозможно проверить,
// а непроверяемый прогноз невозможно улучшить. Сюда приходит фактическое
// прибытие, фактическое время движения и остановок, причины задержек.
//
// Безопасность: прогноз ищется СРАЗУ с организацией из сессии. Чужой id даёт
// 404, а не «нашлось и обновилось»: изоляция организаций проверяется в
// условии запроса, а не в интерфейсе.
//
// Записать факт может и водитель — он как раз и знает, когда прибыл. Поэтому
// доступ staff-сессии или driver-сессии своего рейса.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { requireDriver } from "@/lib/auth/session"
import { requireOrganization } from "@/lib/org"
import { recordActual } from "@/lib/eta/repository"
import { prisma } from "@/lib/prisma"

interface ActualBody {
  actualArrivalAt?: string
  actualDrivingSec?: number
  actualStopsSec?: number
  delayReasons?: string[]
  /** Выброс: рейс оформлен с ошибкой, в метрики не идёт */
  outlier?: boolean
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  // Доступ: сотрудник своей организации или водитель своего рейса
  const staff = await requireStaffAuth(request)
  if (staff.error) {
    const driver = await requireDriver(request)
    if (!driver.ok) return staff.error
    const driverOrg = requireOrganization(driver.value)
    if (!driverOrg.ok) return driverOrg.response

    // Водитель: прогноз должен относиться к его рейсу
    const forecast = await prisma.etaForecast.findFirst({
      where: { id, routeId: { not: null } },
      select: { id: true, route: { select: { driverId: true, organizationId: true } } },
    })
    if (!forecast?.route) return notFound()
    if (forecast.route.driverId !== driver.value.driver.id) return notFound()
    if (forecast.route.organizationId !== driverOrg.organizationId) return notFound()

    return handle(id, driverOrg.organizationId, request)
  }

  const org = requireStaffOrganization(staff.user)
  if (!org.ok) return org.response

  return handle(id, org.organizationId, request)
}

function notFound() {
  return NextResponse.json({ error: "Прогноз не найден" }, { status: 404 })
}

async function handle(forecastId: string, organizationId: string, request: NextRequest) {
  let body: ActualBody | null = null
  try {
    body = (await request.json()) as ActualBody
  } catch {
    return NextResponse.json({ error: "Ожидается JSON" }, { status: 400 })
  }

  if (!body?.actualArrivalAt) {
    return NextResponse.json({ error: "Требуется actualArrivalAt" }, { status: 400 })
  }

  const actualArrivalAt = new Date(body.actualArrivalAt)
  if (Number.isNaN(actualArrivalAt.getTime())) {
    return NextResponse.json({ error: "Некорректное время прибытия" }, { status: 400 })
  }

  const result = await recordActual(forecastId, organizationId, {
    actualArrivalAt,
    actualDrivingSec: body.actualDrivingSec,
    actualStopsSec: body.actualStopsSec,
    delayReasons: body.delayReasons,
    outlier: body.outlier,
  })

  if (!result.ok) return notFound()

  return NextResponse.json({
    success: true,
    errorMinutes: Math.round(result.errorMinutes * 10) / 10,
    // Знак расшифровывается здесь, чтобы не расшифровывать его в интерфейсе
    direction:
      result.errorMinutes > 0
        ? "прибыли позже прогноза"
        : result.errorMinutes < 0
          ? "прибыли раньше прогноза"
          : "точно в прогноз",
  })
}
