// app/lm/reports/page.tsx — отчёты одним экраном.
//
// Полные отчёты с графиками — для компьютера. Логисту на телефоне нужны
// выводы: что не так и что с этим делать. Поэтому в основе — подсказки
// системы (insights) и несколько ключевых цифр.

"use client"

import { BarChart3, RefreshCw } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, EmptyState, ErrorState, KpiCard, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { INSIGHT_LEVEL_META, type MobileInsight } from "@/lib/logist-mobile/types"
import { formatMoney, shortCity } from "@/lib/logist-mobile/format"

interface ReportsResponse {
  success: boolean
  companyName: string
  report: {
    period: { label: string }
    finance: {
      revenueRub: number
      expensesRub: number
      profitRub: number
      marginPercent: number | null
      ordersCount: number
      deliveredCount: number
      distanceKm: number
    }
    orders: { onTimePercent: number | null; lateCount: number; topDirections?: Array<{ from: string; to: string; count: number }> }
    fleet: { utilizationPercent: number | null; vehiclesUsed: number; vehiclesTotal: number }
    payments: { overdueRub: number; overdueCount: number; avgDaysToPayment: number | null }
  }
  insights: MobileInsight[]
}

export default function LogistReportsPage() {
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<ReportsResponse>(user ? "/api/reports" : null)

  const report = data?.report
  const insights = data?.insights ?? []

  return (
    <>
      <LogistHeader
        title="Отчёты"
        subtitle={report?.period?.label ?? data?.companyName}
        userName={user?.name}
      />

      <div className="px-4 pt-4">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <ListSkeleton rows={5} />
        ) : !report ? (
          <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Отчёт не собрался" description="Попробуйте обновить" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <KpiCard label="Выручка" value={formatMoney(report.finance.revenueRub)} tone="good" />
              <KpiCard
                label="Расходы"
                value={formatMoney(report.finance.expensesRub)}
                tone="warn"
              />
              <KpiCard
                label="Прибыль"
                value={formatMoney(report.finance.profitRub)}
                hint={report.finance.marginPercent != null ? `маржа ${Math.round(report.finance.marginPercent)}%` : undefined}
              />
              <KpiCard
                label="Заказов"
                value={report.finance.ordersCount}
                hint={`доставлено ${report.finance.deliveredCount}`}
              />
            </div>

            <SectionTitle
              title="Что требует решения"
              action={
                <button type="button" onClick={reload} className="inline-flex items-center gap-1 text-orange-400">
                  <RefreshCw className="h-3.5 w-3.5" /> Обновить
                </button>
              }
            />

            <div className="space-y-2.5">
              {insights.length === 0 ? (
                <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Подсказок нет" />
              ) : (
                insights.map((insight) => {
                  const meta = INSIGHT_LEVEL_META[insight.level] ?? INSIGHT_LEVEL_META.info
                  return (
                    <div key={insight.id} className={`rounded-2xl border p-4 ${meta.style}`}>
                      <p className="text-[14.5px] font-medium text-white">
                        <span className="mr-1.5">{meta.emoji}</span>
                        {insight.title}
                      </p>
                      {insight.detail ? (
                        <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{insight.detail}</p>
                      ) : null}
                      {insight.source ? (
                        <p className="mt-1.5 text-[11.5px] text-zinc-500">Источник: {insight.source}</p>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>

            <SectionTitle title="Операционные цифры" />
            <Card className="space-y-2.5">
              <Row label="В срок" value={report.orders.onTimePercent != null ? `${Math.round(report.orders.onTimePercent)}%` : "—"} hint={report.orders.lateCount ? `опозданий: ${report.orders.lateCount}` : undefined} />
              <Row
                label="Использование машин"
                value={report.fleet.utilizationPercent != null ? `${Math.round(report.fleet.utilizationPercent)}%` : "—"}
                hint={`${report.fleet.vehiclesUsed} из ${report.fleet.vehiclesTotal}`}
              />
              <Row
                label="Оплата в среднем"
                value={report.payments.avgDaysToPayment != null ? `${report.payments.avgDaysToPayment} дн.` : "—"}
                hint={report.payments.overdueCount ? `просрочено ${report.payments.overdueCount}` : "просрочек нет"}
              />
              <Row label="Пробег" value={`${Math.round(report.finance.distanceKm).toLocaleString("ru-RU")} км`} />
            </Card>

            {(report.orders.topDirections ?? []).length > 0 ? (
              <>
                <SectionTitle title="Частые направления" />
                <Card className="space-y-2">
                  {(report.orders.topDirections ?? []).slice(0, 5).map((direction, index) => (
                    <div key={`${direction.from}-${direction.to}-${index}`} className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-[13.5px] text-zinc-300">
                        {shortCity(direction.from)} → {shortCity(direction.to)}
                      </p>
                      <p className="shrink-0 text-[13px] text-zinc-500">{direction.count}</p>
                    </div>
                  ))}
                </Card>
              </>
            ) : null}

            <p className="mt-4 pb-2 text-center text-[12px] text-zinc-600">
              Полные отчёты с графиками — в полной версии на компьютере
            </p>
          </>
        )}
      </div>
    </>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13.5px] text-zinc-300">{label}</p>
        {hint ? <p className="text-[11.5px] text-zinc-500">{hint}</p> : null}
      </div>
      <p className="shrink-0 text-[14px] font-medium text-white">{value}</p>
    </div>
  )
}
