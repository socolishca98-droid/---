"use client"

import Link from "next/link"
import { useState } from "react"
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Download,
  FileText,
  Info,
  RefreshCw,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { useJsonApi } from "@/hooks/use-json-api"
import { useAuth } from "@/lib/auth-context"
import {
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  SectionTitle,
} from "@/components/logist-mobile/ui"
import { formatMoney, shortCity } from "@/lib/logist-mobile/format"

type Preset = "7d" | "30d" | "90d" | "month" | "year"
type ReportTab = "finance" | "vehicles" | "drivers" | "ops"

interface ReportInsight {
  id: string
  severity: "info" | "warn" | "bad" | "good"
  title: string
  detail?: string
  source?: string
}

interface ReportsResponse {
  success: boolean
  companyName?: string
  report: {
    finance: {
      revenueRub: number
      expensesRub: number
      profitRub: number
      marginPercent: number | null
      ordersCount: number
      deliveredCount: number
      distanceKm: number
    }
    orders: {
      onTimePercent: number | null
      lateCount: number
      topDirections?: Array<{ from: string; to: string; count: number }>
    }
    fleet: {
      utilizationPercent: number | null
      vehiclesUsed: number
      vehiclesTotal: number
    }
    payments: {
      avgDaysToPayment: number | null
      overdueCount: number
    }
  }
  insights: ReportInsight[]
  byVehicle?: Array<{ id: string; label: string; orders: number; revenueRub: number; distanceKm: number }>
  byDriver?: Array<{ id: string; name: string; orders: number; revenueRub: number; distanceKm: number }>
}

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: "7d", label: "7 дн" },
  { id: "month", label: "Месяц" },
  { id: "90d", label: "90 дн" },
  { id: "year", label: "Год" },
]

function presetBounds(preset: Preset): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  const fromDate = new Date(now)
  if (preset === "7d") fromDate.setDate(now.getDate() - 7)
  else if (preset === "30d") fromDate.setDate(now.getDate() - 30)
  else if (preset === "90d") fromDate.setDate(now.getDate() - 90)
  else if (preset === "month") fromDate.setDate(1)
  else fromDate.setMonth(0, 1)
  return { from: fromDate.toISOString().slice(0, 10), to }
}

function insightAction(ins: ReportInsight): { href: string; label: string } {
  const s = (ins.source ?? "").toLowerCase()
  const t = (ins.title ?? "").toLowerCase()
  if (t.includes("простаива")) return { href: "/lm/routes/assistant", label: "Собрать маршрут →" }
  if (s.includes("оплат")) return { href: "/lm/payments", label: "Разобрать оплаты →" }
  if (s.includes("топлив") || t.includes("расход")) return { href: "/lm/fuel", label: "Внести расходы →" }
  if (s.includes("автопарк") || s.includes("машин")) return { href: "/lm/fleet", label: "Открыть автопарк →" }
  if (s.includes("заказ")) return { href: "/lm/orders", label: "Открыть заказы →" }
  return { href: "/lm/routes", label: "Открыть рейсы →" }
}

export default function MobileReportsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const [preset, setPreset] = useState<Preset>("30d")
  const [tab, setTab] = useState<ReportTab>("finance")

  const { data, error, loading, reload } = useJsonApi<ReportsResponse>(
    user ? `/api/reports?preset=${preset}` : null,
  )

  const bounds = presetBounds(preset)
  const paymentsQuery = `from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`
  const report = data?.report
  const insights = data?.insights ?? []
  const byVehicle = data?.byVehicle ?? []
  const byDriver = data?.byDriver ?? []

  return (
    <>
      <LogistHeader
        title="Отчёты"
        subtitle={PRESETS.find((p) => p.id === preset)?.label ?? "30 дн"}
        userName={user?.name}
      />

      <main className="mx-auto max-w-md space-y-4 px-4 pb-28 pt-3">
        {/* Компактная строка периода */}
        <div className="flex items-center justify-between gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPreset(item.id)}
              className={`flex-1 rounded-lg py-1.5 text-[12px] font-medium transition-all ${
                preset === item.id
                  ? "bg-amber-500/20 text-amber-300"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {authLoading || loading ? (
          <ListSkeleton rows={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !report ? (
          <EmptyState
            icon={<BarChart3 className="h-6 w-6" />}
            title="Данных пока нет"
            description="За выбранный период ещё не было заказов."
          />
        ) : (
          <>
            {/* 4 вкладки */}
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
                  className={`rounded-lg py-2 text-[12px] font-medium transition-all ${
                    tab === item.id
                      ? "bg-amber-500/20 text-amber-300"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === "finance" ? (
              <div className="space-y-3">
                {/* Итог периода */}
                <Card className="flex items-center justify-between gap-3 border-amber-500/25 bg-amber-500/[0.06]">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Итог периода</p>
                    <p className="mt-0.5 text-[14px] font-semibold text-foreground">
                      {report.finance.profitRub >= 0 ? "Компания в плюсе" : "Убыточный период"}
                    </p>
                  </div>
                  <span
                    className={`text-[16px] font-bold tabular-nums ${
                      report.finance.profitRub >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {report.finance.profitRub >= 0 ? "+" : ""}
                    {formatMoney(report.finance.profitRub)}
                  </span>
                </Card>

                {/* Стильная столбчатая диаграмма Выручка / Расходы / Прибыль */}
                {report.finance.revenueRub > 0 || report.finance.expensesRub > 0 ? (
                  <Card className="space-y-3 p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium text-muted-foreground">Баланс периода</span>
                      <span className="text-[11.5px] font-semibold text-amber-400 tabular-nums">
                        маржа {Math.max(0, Math.min(100, Math.round((report.finance.profitRub / Math.max(1, report.finance.revenueRub)) * 100)))}%
                      </span>
                    </div>
                    {(() => {
                      const maxVal = Math.max(
                        report.finance.revenueRub,
                        report.finance.expensesRub,
                        Math.abs(report.finance.profitRub),
                        1,
                      )
                      const bars = [
                        { label: "Выручка", val: report.finance.revenueRub, grad: "from-emerald-400 to-emerald-600/80", text: "text-emerald-300" },
                        { label: "Расходы", val: report.finance.expensesRub, grad: "from-amber-400 to-amber-600/80", text: "text-amber-300" },
                        {
                          label: "Прибыль",
                          val: Math.max(0, report.finance.profitRub),
                          grad: report.finance.profitRub >= 0 ? "from-sky-400 to-indigo-500/80" : "from-rose-400 to-rose-600/80",
                          text: report.finance.profitRub >= 0 ? "text-sky-300" : "text-rose-300",
                        },
                      ]
                      return (
                        <div className="grid grid-cols-3 items-end gap-3 pt-2">
                          {bars.map((b) => {
                            const h = Math.max(10, Math.round((b.val / maxVal) * 84))
                            return (
                              <div key={b.label} className="flex flex-col items-center gap-1.5">
                                <span className={`text-[11px] font-semibold tabular-nums ${b.text}`}>
                                  {formatMoney(b.val)}
                                </span>
                                <div className="flex h-[88px] w-full items-end justify-center rounded-xl bg-white/[0.03] px-3 pb-1">
                                  <div
                                    className={`w-full rounded-t-lg bg-gradient-to-t ${b.grad} shadow-[0_0_16px_rgba(245,158,11,0.12)] transition-all duration-500`}
                                    style={{ height: `${h}px` }}
                                  />
                                </div>
                                <span className="text-[11px] text-muted-foreground">{b.label}</span>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </Card>
                ) : null}

                {/* Компактные цифры */}
                <div className="grid grid-cols-2 gap-2.5">
                  <Card className="p-3">
                    <p className="text-[11.5px] text-muted-foreground">Выручка</p>
                    <p className="mt-1 text-[16px] font-semibold text-emerald-400 tabular-nums">
                      {formatMoney(report.finance.revenueRub)}
                    </p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-[11.5px] text-muted-foreground">Расходы</p>
                    <p className="mt-1 text-[16px] font-semibold text-amber-300 tabular-nums">
                      {formatMoney(report.finance.expensesRub)}
                    </p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-[11.5px] text-muted-foreground">Заказов</p>
                    <p className="mt-1 text-[16px] font-semibold text-foreground tabular-nums">
                      {report.finance.ordersCount}
                      <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">
                        (дост. {report.finance.deliveredCount})
                      </span>
                    </p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-[11.5px] text-muted-foreground">Пробег</p>
                    <p className="mt-1 text-[16px] font-semibold text-foreground tabular-nums">
                      {Math.round(report.finance.distanceKm).toLocaleString("ru-RU")} км
                    </p>
                  </Card>
                </div>

                {/* Кликабельные выводы */}
                <SectionTitle
                  title="Что требует решения"
                  action={
                    <button
                      type="button"
                      onClick={reload}
                      className="inline-flex items-center gap-1 text-[12px] text-amber-400"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Обновить
                    </button>
                  }
                />

                {insights.length === 0 ? (
                  <Card className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    Всё ровно, критичных отклонений нет.
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {insights.map((ins) => {
                      const action = insightAction(ins)
                      return (
                        <Link
                          key={ins.id}
                          href={action.href}
                          className="block rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 transition-colors hover:bg-white/[0.06] active:opacity-75"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
                              {ins.severity === "warn" || ins.severity === "bad" ? (
                                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                              ) : (
                                <Info className="h-4 w-4 shrink-0 text-sky-400" />
                              )}
                              {ins.title}
                            </p>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </div>
                          {ins.detail ? (
                            <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{ins.detail}</p>
                          ) : null}
                          <p className="mt-1.5 text-[11.5px] font-semibold text-amber-400">
                            {action.label}
                          </p>
                        </Link>
                      )
                    })}
                  </div>
                )}

                {/* Выгрузка в спойлере */}
                <details className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
                  <summary className="cursor-pointer select-none text-[12px] font-medium text-muted-foreground">
                    Выгрузить отчёт (CSV, текстом, платежи)
                  </summary>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <a
                      href={`/api/reports/export?preset=${preset}&format=csv`}
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12px] text-foreground"
                    >
                      <Download className="h-3.5 w-3.5" /> CSV
                    </a>
                    <a
                      href={`/api/reports/export?preset=${preset}&format=txt`}
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12px] text-foreground"
                    >
                      <FileText className="h-3.5 w-3.5" /> Текстом
                    </a>
                    <a
                      href={`/api/payments/export?${paymentsQuery}`}
                      className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[12px] text-foreground"
                    >
                      <Download className="h-3.5 w-3.5" /> Платежи
                    </a>
                  </div>
                </details>
              </div>
            ) : null}

            {tab === "vehicles" ? (
              byVehicle.length > 0 ? (
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
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.04]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-medium text-foreground">{v.label}</p>
                          <p className="text-[11.5px] text-muted-foreground">
                            {Math.round(v.distanceKm).toLocaleString("ru-RU")} км
                            {v.distanceKm > 0 ? ` · ${Math.round(v.revenueRub / v.distanceKm)} ₽/км` : ""}
                          </p>
                        </div>
                        <span className="text-[13px] text-muted-foreground tabular-nums">{v.orders}</span>
                        <span className="shrink-0 text-[13px] font-semibold text-amber-300 tabular-nums">
                          {formatMoney(v.revenueRub)}
                        </span>
                      </Link>
                    ))}
                  </div>
                </Card>
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
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.04]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-medium text-foreground">{d.name}</p>
                          <p className="text-[11.5px] text-muted-foreground">
                            {Math.round(d.distanceKm).toLocaleString("ru-RU")} км
                            {d.distanceKm > 0 ? ` · ${Math.round(d.revenueRub / d.distanceKm)} ₽/км` : ""}
                          </p>
                        </div>
                        <span className="text-[13px] text-muted-foreground tabular-nums">{d.orders}</span>
                        <span className="shrink-0 text-[13px] font-semibold text-amber-300 tabular-nums">
                          {formatMoney(d.revenueRub)}
                        </span>
                      </Link>
                    ))}
                  </div>
                </Card>
              ) : (
                <EmptyState
                  icon={<BarChart3 className="h-6 w-6" />}
                  title="Нет данных по водителям"
                  description="За выбранный период ещё нет заказов с назначенными водителями."
                />
              )
            ) : null}

            {tab === "ops" ? (
              <div className="space-y-3">
                <Card className="divide-y divide-white/10 p-0">
                  <div className="space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-muted-foreground">Доставка в срок</span>
                      <span className="font-semibold text-foreground tabular-nums">
                        {report.orders.onTimePercent != null ? `${Math.round(report.orders.onTimePercent)}%` : "—"}
                      </span>
                    </div>
                    {report.orders.onTimePercent != null ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                          style={{ width: `${Math.max(0, Math.min(100, Math.round(report.orders.onTimePercent)))}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-muted-foreground">Загрузка машин</span>
                      <span className="font-semibold text-foreground tabular-nums">
                        {report.fleet.utilizationPercent != null ? `${Math.round(report.fleet.utilizationPercent)}%` : "—"}
                        <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">
                          ({report.fleet.vehiclesUsed} из {report.fleet.vehiclesTotal})
                        </span>
                      </span>
                    </div>
                    {report.fleet.utilizationPercent != null ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-amber-400 transition-all duration-500"
                          style={{ width: `${Math.max(0, Math.min(100, Math.round(report.fleet.utilizationPercent)))}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 text-[13px]">
                    <span className="text-muted-foreground">Средний срок оплаты</span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {report.payments.avgDaysToPayment != null ? `${report.payments.avgDaysToPayment} дн.` : "—"}
                    </span>
                  </div>
                </Card>

                {(report.orders.topDirections ?? []).filter((d) => d.from?.trim() && d.to?.trim()).length > 0 ? (
                  <>
                    <SectionTitle title="Частые направления" />
                    <Card className="overflow-hidden p-0">
                      <div className="grid grid-cols-[1fr_auto] border-b border-white/10 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <span>Направление</span>
                        <span>Рейсов</span>
                      </div>
                      <div className="divide-y divide-white/10">
                        {(report.orders.topDirections ?? [])
                          .filter((d) => d.from?.trim() && d.to?.trim())
                          .slice(0, 5)
                          .map((dir, i) => (
                          <div key={`${dir.from}-${dir.to}-${i}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5">
                            <p className="min-w-0 truncate text-[13.5px] font-medium text-foreground">
                              {shortCity(dir.from)} → {shortCity(dir.to)}
                            </p>
                            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[12px] font-semibold text-amber-300 tabular-nums">
                              {dir.count}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  </>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  )
}
