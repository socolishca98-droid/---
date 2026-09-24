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

    return NextResponse.json({
      success: true,
      companyName,
      report,
      insights,
      limits: REPORT_LIMITS,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось построить отчёт"
    console.error("[Reports] GET error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
