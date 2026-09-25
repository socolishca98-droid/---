// app/api/reports/export/route.ts
//
// Выгрузка отчёта (задача 8).
//
// GET /api/reports/export?preset=&from=&to=&format=txt|csv
//   txt — полный отчёт текстом: деньги, заказы, расходы, водители, парк,
//         оплаты, клиенты и разбор с рекомендациями (для письма, совещания,
//         для бухгалтерии одним файлом);
//   csv — таблица по интервалам периода (период; выручка; расходы; прибыль;
//         заказов) с BOM и «;» — Excel открывает как есть, без импорта.
//
// Числа берутся из того же расчёта, что и на экране (lib/reports/load.ts):
// файл и страница не могут разойтись.

import { NextRequest, NextResponse } from "next/server"

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { loadReport, periodFromParams } from "@/lib/reports/load"
import { buildReportText } from "@/lib/reports/insights"

export const dynamic = "force-dynamic"

function fileStamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function csvNumber(value: number): string {
  // Десятичный разделитель — запятая: файл открывают в русском Excel
  return String(value).replace(".", ",")
}

function buildSeriesCsv(report: Awaited<ReturnType<typeof loadReport>>["report"]): string {
  const header = ["Период", "Выручка, ₽", "Расходы, ₽", "Прибыль, ₽", "Заказов"]

  const rows = report.series.map((point) => [
    point.label,
    csvNumber(point.revenueRub),
    csvNumber(point.expensesRub),
    csvNumber(point.profitRub),
    String(point.ordersCount),
  ])

  const total = [
    "Итого",
    csvNumber(report.finance.revenueRub),
    csvNumber(report.finance.expensesRub),
    csvNumber(report.finance.profitRub),
    String(report.finance.ordersCount),
  ]

  return [header, ...rows, total].map((row) => row.join(";")).join("\r\n")
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get("format") === "csv" ? "csv" : "txt"

    const period = periodFromParams({
      preset: searchParams.get("preset"),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    })

    const { report, insights, companyName } = await loadReport(org.organizationId, period)

    const stamp = `${fileStamp(period.from)}_${fileStamp(period.to)}`

    if (format === "csv") {
      const csv = "\uFEFF" + buildSeriesCsv(report)

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="otchet-${stamp}.csv"`,
          "X-Report-From": period.from.toISOString(),
          "X-Report-To": period.to.toISOString(),
          "X-Report-Points": String(report.series.length),
        },
      })
    }

    const text = [
      companyName ? `${companyName}` : "Отчёт по грузоперевозкам",
      buildReportText({ report, periodLabel: period.label, companyName }),
    ].join("\n\n")

    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="otchet-${stamp}.txt"`,
        "X-Report-From": period.from.toISOString(),
        "X-Report-To": period.to.toISOString(),
        "X-Report-Insights": String(insights.length),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выгрузить отчёт"
    console.error("[Reports] export error:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
