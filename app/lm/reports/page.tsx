// app/lm/reports/page.tsx — отчёты одним экраном.
//
// Полные отчёты с графиками — для компьютера. Логисту на телефоне нужны
// выводы: что не так и что с этим делать. Поэтому в основе — подсказки
// системы (insights) и несколько ключевых цифр.

"use client"

import Link from "next/link"

import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, CircleAlert, Download, FileText, Info, RefreshCw } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, EmptyState, ErrorState, KpiCard, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { useState } from "react"
import { INSIGHT_LEVEL_META, type MobileInsight } from "@/lib/logist-mobile/types"
import {
  presetBounds,
  presetLabel,
  type ReportPeriodPreset,
} from "@/lib/reports/period"
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

const PERIOD_PRESETS: ReportPeriodPreset[] = ["7d", "30d", "90d", "month", "year"]

export default function LogistReportsPage() {
  const { user } = useStaffSession()
  // Период: готовые варианты или свои даты. /api/reports и /api/reports/export
  // понимают те же параметры (preset / from / to), платежный экспорт — from/to.
  const [preset, setPreset] = useState<ReportPeriodPreset>("30d")
  const [custom, setCustom] = useState(false)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const query = custom
    ? from && to
      ? `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      : ""
    : `preset=${preset}`

  const { data, error, loading, reload } = useJsonApi<ReportsResponse>(
    user ? (query ? `/api/reports?${query}` : null) : null,
  )

  // Границы периода для кнопок экспорта: платежный CSV понимает только даты.
  const bounds = custom
    ? { from, to, label: "свой период" }
    : presetBounds(preset)
  const paymentsQuery = `from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`

  const report = data?.report
  const insights = data?.insights ?? []
  const [tab, setTab] = useState<"finance" | "vehicles" | "drivers" | "ops">("finance")
  const byVehicle =
    (data as { byVehicle?: Array<{ id: string; label: string; orders: number; revenueRub: number; distanceKm: number }> } | undefined)
      ?.byVehicle ?? []
  const byDriver =
    (data as { byDriver?: Array<{ id: string; name: string; orders: number; revenueRub: number; distanceKm: number }> } | undefined)
      ?.byDriver ?? []

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
            {/* Период отчёта: готовые варианты или свои даты */}
            <div className="mb-3">
              <div className="flex flex-wrap gap-1.5">
                {PERIOD_PRESETS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setCustom(false)
                      setPreset(item)
                    }}
                    className={`min-h-[36px] rounded-full border px-3 text-[12.5px] font-medium active:opacity-70 ${
                      !custom && preset === item
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-secondary text-muted-foreground"
                    }`}
                  >
                    {presetLabel(item)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustom((value) => !value)}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium active:opacity-70 ${
                    custom
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary text-muted-foreground"
                  }`}
                >
                  <CalendarDays className="h-3.5 w-3.5" /> Свои даты
                </button>
              </div>

              {custom ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="date"
                    value={from}
                    max={to || undefined}
                    onChange={(event) => setFrom(event.target.value)}
                    className="min-h-[42px] flex-1 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-primary"
                  />
                  <span className="text-[12.5px] text-muted-foreground">—</span>
                  <input
                    type="date"
                    value={to}
                    min={from || undefined}
                    onChange={(event) => setTo(event.target.value)}
                    className="min-h-[42px] flex-1 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-primary"
                  />
                </div>
              ) : null}

              {/* Выгрузки с тем же периодом */}
              <div className="mt-2 flex gap-1.5">
                <a
                  href={`/api/reports/export?format=csv&${query}`}
                  className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12.5px] font-medium text-foreground active:opacity-70"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
                <a
                  href={`/api/reports/export?format=txt&${query}`}
                  className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12.5px] font-medium text-foreground active:opacity-70"
                >
                  <FileText className="h-3.5 w-3.5" /> Текстом
                </a>
                <a
                  href={`/api/payments/export?${paymentsQuery}`}
                  className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-border text-[12.5px] font-medium text-foreground active:opacity-70"
                >
                  <Download className="h-3.5 w-3.5" /> Платежи
                </a>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(
                [
                  { id: "finance", label: "Финансы" },
                  { id: "vehicles", label: "Машины" },
                  { id: "drivers", label: "Водители" },
                  { id: "ops", label: "Операции" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`rounded-lg py-2 text-[12.5px] font-medium transition-all ${
                    tab === item.id
                      ? "bg-amber-500/20 text-amber-300 shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === "finance" ? (
              <div className="space-y-2.5">
                <Card className="flex items-center justify-between gap-3 border-amber-500/25 bg-amber-500/[0.06]">
                  <div>
                    <p className="text-[11.5px] uppercase tracking-wider text-muted-foreground">Итог периода</p>
                    <p className="mt-0.5 text-[15px] font-semibold text-foreground">
                      {report.finance.profitRub >= 0 ? "Компания в плюсе" : "Убыточный период"}
                    </p>
                  </div>
                  <span
                    className={`text-[17px] font-bold tabular-nums ${
                      report.finance.profitRub >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {report.finance.profitRub >= 0 ? "+" : ""}
                    {formatMoney(report.finance.profitRub)}
                  </span>
                </Card>
                {report.finance.revenueRub > 0 ? (
                  <Card className="space-y-2 py-3">
                    <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                      <span>Доля прибыли в выручке</span>
                      <span className="font-semibold text-foreground tabular-nums">
                        {Math.max(0, Math.min(100, Math.round((report.finance.profitRub / report.finance.revenueRub) * 100)))}%
                      </span>
                    </div>
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="bg-emerald-400 transition-all duration-500"
                        style={{
                          width: `${Math.max(0, Math.min(100, Math.round((report.finance.profitRub / report.finance.revenueRub) * 100)))}%`,
                        }}
                      />
                      <div
                        className="bg-amber-400/80 transition-all duration-500"
                        style={{
                          width: `${Math.max(0, Math.min(100, Math.round((report.finance.expensesRub / report.finance.revenueRub) * 100)))}%`,
                        }}
                      />
                    </div>
                  </Card>
                ) : null}
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
                <button type="button" onClick={reload} className="inline-flex items-center gap-1 text-primary">
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

                  const LevelIcon =

                    meta.tone === "ok"

                      ? CheckCircle2

                      : meta.tone === "warn"

                        ? AlertTriangle

                        : meta.tone === "critical"

                          ? CircleAlert

                          : Info

                  const iconTone =

                    meta.tone === "ok"

                      ? "text-success"

                      : meta.tone === "warn"

                        ? "text-warning"

                        : meta.tone === "critical"

                          ? "text-destructive"

                          : "text-muted-foreground"

                  return (

                    <div key={insight.id} className={`rounded-xl border p-4 ${meta.style}`}>

                      <p className="flex items-start gap-2 text-[14.5px] font-medium text-foreground">

                        <LevelIcon className={`mt-0.5 h-4 w-4 shrink-0 ${iconTone}`} />

                        <span>{insight.title}</span>

                      </p>
                      {insight.detail ? (
                        <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">{insight.detail}</p>
                      ) : null}
                      {insight.source ? (
                        <p className="mt-1.5 text-[11.5px] text-muted-foreground">Источник: {insight.source}</p>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
            </div>
            ) : null}

            {tab === "vehicles" ? (
              byVehicle.length > 0 ? (
                <>
                  <SectionTitle title="По машинам" />
                  <Card className="overflow-hidden p-0">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>Машина</span>
                      <span>Рейсов</span>
                      <span>Выручка</span>
                    </div>
                <div className="divide-y divide-white/10">
                      {byVehicle.map((v) => (
                        <Link
                          key={v.id}
                          href="/lm/fleet"
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.04] active:opacity-75"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-medium text-foreground/95">{v.label}</p>
                            <p className="text-[11.5px] text-muted-foreground">{Math.round(v.distanceKm).toLocaleString("ru-RU")} км</p>
                          </div>
                          <span className="text-[13px] text-muted-foreground tabular-nums">{v.orders}</span>
                          <span className="shrink-0 text-[13px] font-semibold text-amber-300 tabular-nums">
                            {formatMoney(v.revenueRub)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </Card>
                </>
              ) : (
                <EmptyState
                  icon={<BarChart3 className="h-6 w-6" />}
                  title="Нет данных по машинам"
                  description="За выбранный период ещё нет заказов с назначенными машинами."
                />
              )
            ) : null}

            {tab === "drivers" ? (
              byDriver.length > 0 ? (
                <>
                  <SectionTitle title="По водителям" />
                  <Card className="overflow-hidden p-0">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>Водитель</span>
                      <span>Рейсов</span>
                      <span>Выручка</span>
                    </div>
                    <div className="divide-y divide-white/10">
                      {byDriver.map((d) => (
                        <Link
                          key={d.id}
                          href="/lm/drivers"
                          className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.04] active:opacity-75"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-medium text-foreground/95">{d.name}</p>
                            <p className="text-[11.5px] text-muted-foreground">{Math.round(d.distanceKm).toLocaleString("ru-RU")} км</p>
                          </div>
                          <span className="text-[13px] text-muted-foreground tabular-nums">{d.orders}</span>
                          <span className="shrink-0 text-[13px] font-semibold text-amber-300 tabular-nums">
                            {formatMoney(d.revenueRub)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </Card>
                </>
              ) : (
                <EmptyState
                  icon={<BarChart3 className="h-6 w-6" />}
                  title="Нет данных по водителям"
                  description="За выбранный период ещё нет заказов с назначенными водителями."
                />
              )
            ) : null}

            {tab === "ops" ? (
            <>
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
            </>
            ) : null}

            {tab === "ops" && (report.orders.topDirections ?? []).length > 0 ? (
              <>
                <SectionTitle title="Частые направления" />
                <Card className="space-y-2">
                  {(report.orders.topDirections ?? []).slice(0, 5).map((direction, index) => (
                    <div key={`${direction.from}-${direction.to}-${index}`} className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-[13.5px] text-foreground/90">
                        {shortCity(direction.from)} → {shortCity(direction.to)}
                      </p>
                      <p className="shrink-0 text-[13px] text-muted-foreground">{direction.count}</p>
                    </div>
                  ))}
                </Card>
              </>
            ) : null}

            <p className="mt-4 pb-2 text-center text-[12px] text-muted-foreground/80">
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
        <p className="text-[13.5px] text-foreground/90">{label}</p>
        {hint ? <p className="text-[11.5px] text-muted-foreground">{hint}</p> : null}
      </div>
      <p className="shrink-0 text-[14px] font-medium text-foreground">{value}</p>
    </div>
  )
}
