"use client"

// components/reports/reports-view.tsx
//
// Отчёты (задача 8): настоящие числа из базы.
//
// Раньше вкладка показывала выдуманные данные — «2.45М ₽ выручки», водителей
// «Александр Петров» и рекомендации «ИИ» из зашитой строки. Теперь всё берётся
// из GET /api/reports: заказы и рейсы, расходы рейса (чеки водителей), парк,
// клиенты и оплаты. Каждая цифра — сумма по своим записям, а рядом видно,
// сколько именно записей в неё попало (report.data), чтобы пустой период было
// видно сразу, а не догадываться по нулям.
//
// Разбор строится правилами (lib/reports/insights.ts): у каждого вывода есть
// уровень, источник (вкладка, где это видно) и действие. Ничего не выдумывается,
// поэтому разбор и не может «пофантазировать».

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  Download,
  FileText,
  Fuel,
  Info,
  Loader2,
  Minus,
  Package,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Recharts принимает цвета строками: переменные темы здесь в формате oklch,
// hsl(var(--primary)) дал бы невалидный цвет и пустой график
const CHART = {
  revenue: "oklch(0.65 0.2 30)",
  profit: "oklch(0.65 0.18 145)",
  expenses: "oklch(0.62 0.19 25)",
  neutral: "oklch(0.6 0.13 250)",
  grid: "oklch(0.28 0.01 260)",
  text: "oklch(0.65 0 0)",
} as const

const EXPENSE_COLORS = [
  "oklch(0.65 0.2 30)",
  "oklch(0.6 0.15 200)",
  "oklch(0.7 0.15 140)",
  "oklch(0.75 0.15 60)",
  "oklch(0.55 0.15 320)",
  "oklch(0.65 0.1 250)",
] as const

type Preset = "7d" | "30d" | "90d" | "month" | "year"

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "90d", label: "90 дней" },
  { value: "month", label: "Месяц" },
  { value: "year", label: "Год" },
]

type Kpi = {
  revenueRub: number
  expensesRub: number
  profitRub: number
  marginPercent: number | null
  ordersCount: number
  deliveredCount: number
  cancelledCount: number
  avgOrderRub: number
  distanceKm: number
  revenuePerKmRub: number | null
  costPerKmRub: number | null
  fuelRub: number
  fuelLiters: number
  fuelPer100Km: number | null
}

type SeriesPoint = {
  key: string
  label: string
  revenueRub: number
  expensesRub: number
  profitRub: number
  ordersCount: number
}

type Insight = {
  id: string
  level: "risk" | "warn" | "ok" | "info"
  title: string
  detail: string
  action: string | null
  source: string
}

type ReportResponse = {
  success: boolean
  companyName: string | null
  report: {
    period: { preset: string; from: string; to: string; group: "day" | "week" | "month"; label: string }
    previous: { from: string; to: string }
    finance: Kpi
    previousFinance: Kpi
    series: SeriesPoint[]
    expensesByType: Array<{
      type: string
      label: string
      amountRub: number
      liters: number
      count: number
      sharePercent: number | null
    }>
    orders: {
      byStatus: Array<{ status: string; label: string; count: number; revenueRub: number }>
      avgPriceRub: number
      avgDistanceKm: number
      onTimeCount: number
      lateCount: number
      onTimePercent: number | null
      topDirections: Array<{ direction: string; count: number; revenueRub: number; distanceKm: number }>
    }
    clients: {
      totalRub: number
      concentrationPercent: number | null
      top: Array<{
        key: string
        clientId: string | null
        name: string
        orders: number
        revenueRub: number
        debtRub: number
        overdueRub: number
      }>
    }
    drivers: Array<{
      driverId: string
      name: string
      routes: number
      orders: number
      revenueRub: number
      distanceKm: number
      expensesRub: number
      profitRub: number
      avgOrderRub: number
      onTimePercent: number | null
    }>
    vehicles: Array<{
      vehicleId: string
      plate: string
      routes: number
      orders: number
      distanceKm: number
      revenueRub: number
      expensesRub: number
      profitRub: number
      costPerKmRub: number | null
    }>
    fleet: {
      vehiclesTotal: number
      vehiclesUsed: number
      utilizationPercent: number | null
      idleVehicles: Array<{ vehicleId: string; plate: string }>
      unprofitableRoutes: Array<{
        routeId: string
        name: string
        revenueRub: number
        expensesRub: number
        profitRub: number
      }>
    }
    payments: {
      paidRub: number
      pendingRub: number
      overdueRub: number
      overdueCount: number
      deferredRub: number
      avgDaysToPayment: number | null
      overdueClients: Array<{ name: string; debtRub: number; overdueRub: number; orders: number }>
    }
    data: {
      ordersInPeriod: number
      routesInPeriod: number
      expensesInPeriod: number
      hasData: boolean
    }
  }
  insights: Insight[]
}

function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

function shortMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}М ₽`
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}к ₽`
  return money(value)
}

function percent(value: number | null, digits = 1): string {
  if (value === null || value === undefined) return "—"
  return `${value.toLocaleString("ru-RU")}%`
}

function change(current: number, previous: number): number | null {
  if (!previous) return null
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
}

function dateInput(value: string): string {
  return new Date(value).toISOString().slice(0, 10)
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  deltaGoodWhenUp = true,
  tone = "neutral",
}: {
  icon: typeof TrendingUp
  label: string
  value: string
  hint?: string
  delta?: number | null
  deltaGoodWhenUp?: boolean
  tone?: "neutral" | "good" | "bad"
}) {
  const toneClass =
    tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-primary"

  const deltaUp = (delta ?? 0) > 0
  const deltaGood = deltaUp === deltaGoodWhenUp

  return (
    <div className="card-interactive rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-muted/60 ${toneClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        {delta === null || delta === undefined ? (
          <span className="text-xs text-muted-foreground">нет сравнения</span>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              delta === 0
                ? "bg-muted text-muted-foreground"
                : deltaGood
                  ? "bg-success/15 text-success"
                  : "bg-destructive/15 text-destructive"
            }`}
          >
            {delta === 0 ? (
              <Minus className="h-3 w-3" />
            ) : deltaUp ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta > 0 ? "+" : ""}
            {percent(delta)}
          </span>
        )}
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground/80">{hint}</div>}
    </div>
  )
}

const INSIGHT_STYLE: Record<Insight["level"], { icon: typeof Info; className: string }> = {
  risk: { icon: AlertTriangle, className: "border-destructive/40 bg-destructive/5 text-destructive" },
  warn: { icon: AlertTriangle, className: "border-warning/40 bg-warning/5 text-warning" },
  ok: { icon: CheckCircle2, className: "border-success/40 bg-success/5 text-success" },
  info: { icon: Info, className: "border-border bg-muted/30 text-muted-foreground" },
}

export function ReportsView() {
  const [preset, setPreset] = useState<Preset>("30d")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [data, setData] = useState<ReportResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("money")

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (customFrom) {
      params.set("from", customFrom)
      if (customTo) params.set("to", customTo)
    } else {
      params.set("preset", preset)
    }
    return params.toString()
  }, [preset, customFrom, customTo])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/reports?${query}`, { credentials: "include" })
      const payload = await res.json().catch(() => ({}))

      if (res.ok && payload.success) {
        setData(payload as ReportResponse)
        setError(null)
      } else {
        setData(null)
        setError(payload?.error || `Не удалось построить отчёт (код ${res.status})`)
      }
    } catch {
      setData(null)
      setError("Не удалось связаться с сервером")
    } finally {
      setIsLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  const report = data?.report
  const insights = data?.insights ?? []

  const exportUrl = (format: "txt" | "csv") => `/api/reports/export?${query}&format=${format}`

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card/70 p-10 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
        <p className="mb-4 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Повторить
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Период и выгрузка: то, с чего начинается любой отчёт */}
      <div className="rise-in flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarRange className="h-4 w-4" />
          Период
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setCustomFrom("")
                setCustomTo("")
                setPreset(option.value)
              }}
              className={`press rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                !customFrom && preset === option.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border hover:bg-muted"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={customFrom}
            onChange={(event) => setCustomFrom(event.target.value)}
            className="h-9 w-[9.5rem]"
            title="Начало произвольного периода"
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="date"
            value={customTo}
            onChange={(event) => setCustomTo(event.target.value)}
            className="h-9 w-[9.5rem]"
            title="Конец произвольного периода"
          />
          {customFrom && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCustomFrom("")
                setCustomTo("")
              }}
            >
              Сбросить
            </Button>
          )}
        </div>

        <div className="flex-1" />

        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => window.open(exportUrl("csv"), "_blank")}
        >
          <Download className="h-4 w-4" />
          CSV
        </Button>
        <Button size="sm" className="gap-2" onClick={() => window.open(exportUrl("txt"), "_blank")}>
          <FileText className="h-4 w-4" />
          Отчёт целиком
        </Button>
        <Button variant="ghost" size="icon" onClick={() => void load()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {isLoading && !report ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : report ? (
        <>
          {/* Итоги периода */}
          <div className="stagger-in grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={TrendingUp}
              label={`Выручка · ${report.period.label.toLowerCase()}`}
              value={money(report.finance.revenueRub)}
              hint={`${report.finance.ordersCount} заказ(ов), средний ${money(report.finance.avgOrderRub)}`}
              delta={change(report.finance.revenueRub, report.previousFinance.revenueRub)}
              tone="good"
            />
            <KpiCard
              icon={TrendingDown}
              label="Расходы рейсов"
              value={money(report.finance.expensesRub)}
              hint={
                report.finance.costPerKmRub === null
                  ? "пробег неизвестен — себестоимость не посчитать"
                  : `себестоимость ${report.finance.costPerKmRub} ₽/км`
              }
              delta={change(report.finance.expensesRub, report.previousFinance.expensesRub)}
              deltaGoodWhenUp={false}
              tone="bad"
            />
            <KpiCard
              icon={Banknote}
              label="Прибыль"
              value={money(report.finance.profitRub)}
              hint={
                report.finance.marginPercent === null
                  ? "маржа не считается без выручки"
                  : `маржа ${percent(report.finance.marginPercent)}`
              }
              delta={change(report.finance.profitRub, report.previousFinance.profitRub)}
              tone={report.finance.profitRub >= 0 ? "good" : "bad"}
            />
            <KpiCard
              icon={RouteIcon}
              label="Пробег"
              value={`${report.finance.distanceKm.toLocaleString("ru-RU")} км`}
              hint={
                report.finance.revenuePerKmRub === null
                  ? "рейсов в периоде нет"
                  : `${report.finance.revenuePerKmRub} ₽/км выручки · топливо ${report.finance.fuelPer100Km ?? "—"} л/100 км`
              }
            />
          </div>

          {/* Разбор: что не так и что с этим делать */}
          <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="font-medium">Разбор по числам</h2>
              <span className="text-xs text-muted-foreground">
                выводы построены правилами по данным отчёта, без внешних сервисов
              </span>
            </div>

            {insights.length === 0 ? (
              <p className="text-sm text-muted-foreground">За период отклонений не найдено.</p>
            ) : (
              <div className="stagger-in space-y-2">
                {insights.map((insight) => {
                  const style = INSIGHT_STYLE[insight.level]
                  const Icon = style.icon
                  return (
                    <div
                      key={insight.id}
                      className={`flex items-start gap-3 rounded-lg border p-3 ${style.className}`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{insight.title}</p>
                        <p className="text-sm text-muted-foreground">{insight.detail}</p>
                        {insight.action && (
                          <button
                            type="button"
                            onClick={() => {
                              const tabBySource: Record<string, string> = {
                                Оплаты: "payments",
                                Парк: "fleet",
                                Водители: "drivers",
                                Клиенты: "clients",
                                Заказы: "orders",
                                Расходы: "money",
                                Финансы: "money",
                              }
                              setActiveTab(tabBySource[insight.source] ?? "money")
                            }}
                            className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {insight.action} →
                          </button>
                        )}
                      </div>
                      <span className="shrink-0 text-[11px] uppercase tracking-wide opacity-70">
                        {insight.source}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Данные периода: чтобы пустой отчёт было видно сразу */}
          {!report.data.hasData && (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              За выбранный период в системе нет ни рейсов, ни заказов, ни расходов. Выберите другой
              период — или проверьте, что рейсы закрываются в разделе «Маршруты».
            </div>
          )}
        </>
      ) : null}

      {report && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-secondary/60">
            <TabsTrigger value="money" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Деньги
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <Package className="h-4 w-4" />
              Заказы
            </TabsTrigger>
            <TabsTrigger value="clients" className="gap-2">
              <Users className="h-4 w-4" />
              Клиенты
            </TabsTrigger>
            <TabsTrigger value="drivers" className="gap-2">
              <Users className="h-4 w-4" />
              Водители
            </TabsTrigger>
            <TabsTrigger value="fleet" className="gap-2">
              <Truck className="h-4 w-4" />
              Парк
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-2">
              <Wallet className="h-4 w-4" />
              Оплаты
            </TabsTrigger>
          </TabsList>

          {/* ── Деньги ────────────────────────────────────────────────────── */}
          <TabsContent value="money" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
                <h3 className="mb-1 font-medium">Динамика выручки, расходов и прибыли</h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  Интервалы: {report.period.group === "day" ? "дни" : report.period.group === "week" ? "недели" : "месяцы"} ·{" "}
                  {report.series.length} точек
                </p>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={report.series}>
                      <defs>
                        <linearGradient id="reportRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART.revenue} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={CHART.revenue} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="reportProfit" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART.profit} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={CHART.profit} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                      <XAxis dataKey="label" stroke={CHART.text} fontSize={12} />
                      <YAxis
                        stroke={CHART.text}
                        fontSize={12}
                        tickFormatter={(value) => shortMoney(Number(value))}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "oklch(0.17 0.01 260)",
                          border: `1px solid ${CHART.grid}`,
                          borderRadius: "10px",
                          fontSize: "12px",
                        }}
                        formatter={(value: number, name: string) => [money(Number(value)), name]}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="revenueRub"
                        name="Выручка"
                        stroke={CHART.revenue}
                        fill="url(#reportRevenue)"
                      />
                      <Area
                        type="monotone"
                        dataKey="expensesRub"
                        name="Расходы"
                        stroke={CHART.expenses}
                        fillOpacity={0.15}
                        fill={CHART.expenses}
                      />
                      <Area
                        type="monotone"
                        dataKey="profitRub"
                        name="Прибыль"
                        stroke={CHART.profit}
                        fill="url(#reportProfit)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
                <h3 className="mb-1 font-medium">Структура расходов</h3>
                <p className="mb-4 text-xs text-muted-foreground">
                  {report.data.expensesInPeriod} чек(ов) и записей расхода за период
                </p>
                {report.expensesByType.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    Расходов за период нет: чеки водителей не загружены.
                  </p>
                ) : (
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.expensesByType} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                        <XAxis
                          type="number"
                          stroke={CHART.text}
                          fontSize={12}
                          tickFormatter={(value) => shortMoney(Number(value))}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          stroke={CHART.text}
                          fontSize={12}
                          width={110}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "oklch(0.17 0.01 260)",
                            border: `1px solid ${CHART.grid}`,
                            borderRadius: "10px",
                            fontSize: "12px",
                          }}
                          formatter={(value: number) => money(Number(value))}
                        />
                        <Bar dataKey="amountRub" name="Сумма" radius={[0, 4, 4, 0]}>
                          {report.expensesByType.map((expense, index) => (
                            <Cell
                              key={expense.type}
                              fill={EXPENSE_COLORS[index % EXPENSE_COLORS.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
              <h3 className="mb-4 flex items-center gap-2 font-medium">
                <Fuel className="h-4 w-4 text-muted-foreground" />
                Топливо
              </h3>
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">Сумма</p>
                  <p className="text-lg font-bold">{money(report.finance.fuelRub)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Литры</p>
                  <p className="text-lg font-bold">{report.finance.fuelLiters.toLocaleString("ru-RU")} л</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Цена литра</p>
                  <p className="text-lg font-bold">
                    {report.finance.fuelLiters > 0
                      ? `${Math.round(report.finance.fuelRub / report.finance.fuelLiters)} ₽`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Расход на 100 км</p>
                  <p className="text-lg font-bold">
                    {report.finance.fuelPer100Km === null ? "—" : `${report.finance.fuelPer100Km} л`}
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Заказы ────────────────────────────────────────────────────── */}
          <TabsContent value="orders" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Заказов за период</p>
                <p className="text-2xl font-bold">{report.finance.ordersCount}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  доставлено {report.finance.deliveredCount} · отменено {report.finance.cancelledCount}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Средний чек</p>
                <p className="text-2xl font-bold">{money(report.orders.avgPriceRub)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  среднее плечо {report.orders.avgDistanceKm} км
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Доставлено в срок</p>
                <p className="text-2xl font-bold">{percent(report.orders.onTimePercent, 0)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.orders.onTimeCount} в срок · {report.orders.lateCount} с опозданием
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Направлений</p>
                <p className="text-2xl font-bold">{report.orders.topDirections.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.data.routesInPeriod} рейс(ов) в периоде
                </p>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
                <h3 className="mb-4 font-medium">Статусы заказов</h3>
                {report.orders.byStatus.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">Заказов нет</p>
                ) : (
                  <div className="space-y-2">
                    {report.orders.byStatus.map((row) => (
                      <div key={row.status} className="flex items-center gap-3">
                        <span className="w-40 shrink-0 text-sm">{row.label}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{
                              width: `${Math.round((row.count / Math.max(1, report.finance.ordersCount)) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="w-10 text-right text-sm font-medium">{row.count}</span>
                        <span className="w-28 text-right text-sm text-muted-foreground">
                          {money(row.revenueRub)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
                <h3 className="mb-4 font-medium">Направления</h3>
                {report.orders.topDirections.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    Направлений нет — у заказов не заполнены города
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {report.orders.topDirections.map((direction) => (
                      <div key={direction.direction} className="flex items-center gap-3 py-2">
                        <span className="flex-1 truncate text-sm">{direction.direction}</span>
                        <span className="text-sm text-muted-foreground">{direction.count} шт.</span>
                        <span className="w-28 text-right text-sm font-medium">
                          {money(direction.revenueRub)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── Клиенты ───────────────────────────────────────────────────── */}
          <TabsContent value="clients" className="space-y-4">
            <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
              <h3 className="mb-1 font-medium">Выручка по клиентам за период</h3>
              <p className="mb-4 text-xs text-muted-foreground">
                Всего {money(report.clients.totalRub)}
                {report.clients.concentrationPercent !== null &&
                  ` · крупнейший клиент даёт ${report.clients.concentrationPercent}% выручки`}
              </p>

              {report.clients.top.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  За период заказов с клиентами нет
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="text-left">
                        <th className="p-2 font-medium">Клиент</th>
                        <th className="p-2 text-right font-medium">Заказов</th>
                        <th className="p-2 text-right font-medium">Выручка</th>
                        <th className="p-2 text-right font-medium">Долг</th>
                        <th className="p-2 text-right font-medium">Просрочено</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.clients.top.map((client) => (
                        <tr key={client.key} className="border-t border-border">
                          <td className="p-2">{client.name}</td>
                          <td className="p-2 text-right">{client.orders}</td>
                          <td className="p-2 text-right font-medium">{money(client.revenueRub)}</td>
                          <td className="p-2 text-right text-muted-foreground">
                            {client.debtRub > 0 ? money(client.debtRub) : "—"}
                          </td>
                          <td
                            className={`p-2 text-right ${
                              client.overdueRub > 0 ? "font-medium text-destructive" : "text-muted-foreground"
                            }`}
                          >
                            {client.overdueRub > 0 ? money(client.overdueRub) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Водители ──────────────────────────────────────────────────── */}
          <TabsContent value="drivers" className="space-y-4">
            <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
              <h3 className="mb-4 font-medium">Водители за период</h3>
              {report.drivers.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  За период водители не выполняли рейсов
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="text-left">
                        <th className="p-2 font-medium">Водитель</th>
                        <th className="p-2 text-right font-medium">Рейсов</th>
                        <th className="p-2 text-right font-medium">Заказов</th>
                        <th className="p-2 text-right font-medium">Пробег</th>
                        <th className="p-2 text-right font-medium">Выручка</th>
                        <th className="p-2 text-right font-medium">Расходы</th>
                        <th className="p-2 text-right font-medium">Прибыль</th>
                        <th className="p-2 text-right font-medium">В срок</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.drivers.map((driver) => (
                        <tr key={driver.driverId} className="border-t border-border">
                          <td className="p-2">{driver.name}</td>
                          <td className="p-2 text-right">{driver.routes}</td>
                          <td className="p-2 text-right">{driver.orders}</td>
                          <td className="p-2 text-right text-muted-foreground">
                            {driver.distanceKm.toLocaleString("ru-RU")} км
                          </td>
                          <td className="p-2 text-right font-medium">{money(driver.revenueRub)}</td>
                          <td className="p-2 text-right text-muted-foreground">
                            {money(driver.expensesRub)}
                          </td>
                          <td
                            className={`p-2 text-right font-medium ${
                              driver.profitRub >= 0 ? "text-success" : "text-destructive"
                            }`}
                          >
                            {money(driver.profitRub)}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {percent(driver.onTimePercent, 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Парк ──────────────────────────────────────────────────────── */}
          <TabsContent value="fleet" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Машин в парке</p>
                <p className="text-2xl font-bold">{report.fleet.vehiclesTotal}</p>
              </div>
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">В работе за период</p>
                <p className="text-2xl font-bold">{report.fleet.vehiclesUsed}</p>
              </div>
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Загрузка парка</p>
                <p className="text-2xl font-bold">{percent(report.fleet.utilizationPercent, 0)}</p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
              <h3 className="mb-4 font-medium">Машины за период</h3>
              {report.vehicles.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  За период машины не выезжали
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="text-left">
                        <th className="p-2 font-medium">Машина</th>
                        <th className="p-2 text-right font-medium">Рейсов</th>
                        <th className="p-2 text-right font-medium">Заказов</th>
                        <th className="p-2 text-right font-medium">Пробег</th>
                        <th className="p-2 text-right font-medium">Выручка</th>
                        <th className="p-2 text-right font-medium">Расходы</th>
                        <th className="p-2 text-right font-medium">Прибыль</th>
                        <th className="p-2 text-right font-medium">₽/км</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.vehicles.map((vehicle) => (
                        <tr key={vehicle.vehicleId} className="border-t border-border">
                          <td className="p-2">{vehicle.plate}</td>
                          <td className="p-2 text-right">{vehicle.routes}</td>
                          <td className="p-2 text-right">{vehicle.orders}</td>
                          <td className="p-2 text-right text-muted-foreground">
                            {vehicle.distanceKm.toLocaleString("ru-RU")} км
                          </td>
                          <td className="p-2 text-right font-medium">{money(vehicle.revenueRub)}</td>
                          <td className="p-2 text-right text-muted-foreground">
                            {money(vehicle.expensesRub)}
                          </td>
                          <td
                            className={`p-2 text-right font-medium ${
                              vehicle.profitRub >= 0 ? "text-success" : "text-destructive"
                            }`}
                          >
                            {money(vehicle.profitRub)}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {vehicle.costPerKmRub === null ? "—" : vehicle.costPerKmRub}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
                <h3 className="mb-3 font-medium">Простаивали</h3>
                {report.fleet.idleVehicles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Все машины были в работе — простой нулевой.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {report.fleet.idleVehicles.map((vehicle) => (
                      <span
                        key={vehicle.vehicleId}
                        className="rounded-lg border border-warning/40 bg-warning/5 px-2 py-1 text-xs"
                      >
                        {vehicle.plate}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
                <h3 className="mb-3 font-medium">Рейсы в минус</h3>
                {report.fleet.unprofitableRoutes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Все рейсы периода отбили свои расходы.
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {report.fleet.unprofitableRoutes.map((route) => (
                      <div key={route.routeId} className="flex items-center gap-3 py-2 text-sm">
                        <span className="flex-1 truncate">{route.name}</span>
                        <span className="text-muted-foreground">{money(route.expensesRub)}</span>
                        <span className="w-24 text-right font-medium text-destructive">
                          {money(route.profitRub)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ── Оплаты ────────────────────────────────────────────────────── */}
          <TabsContent value="payments" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Получено</p>
                <p className="text-2xl font-bold text-success">{money(report.payments.paidRub)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.payments.avgDaysToPayment === null
                    ? "срок оплаты неизвестен"
                    : `в среднем через ${report.payments.avgDaysToPayment} дн. после рейса`}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Ждём оплату</p>
                <p className="text-2xl font-bold">
                  {money(report.payments.pendingRub + report.payments.deferredRub)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  в том числе отсрочка {money(report.payments.deferredRub)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Просрочено</p>
                <p className="text-2xl font-bold text-destructive">{money(report.payments.overdueRub)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.payments.overdueCount} заказ(ов) с истёкшим сроком
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/70 p-4 backdrop-blur-sm">
                <p className="text-xs text-muted-foreground">Должников</p>
                <p className="text-2xl font-bold">{report.payments.overdueClients.length}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  по всей базе, а не только по периоду
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur-sm">
              <h3 className="mb-4 font-medium">Кто просрочил оплату</h3>
              {report.payments.overdueClients.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Просрочек нет — все счета закрыты в срок.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {report.payments.overdueClients.map((client) => (
                    <div key={client.name} className="flex items-center gap-3 py-2 text-sm">
                      <span className="flex-1 truncate">{client.name}</span>
                      <span className="text-muted-foreground">{client.orders} заказ(ов)</span>
                      <span className="w-28 text-right text-muted-foreground">
                        {money(client.debtRub)}
                      </span>
                      <span className="w-28 text-right font-medium text-destructive">
                        {money(client.overdueRub)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => window.open("/payments", "_self")}
              >
                Открыть «Оплаты» и напомнить →
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
