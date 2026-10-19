// app/lm/history/page.tsx — история рейсов: чем и когда возили, кто не заплатил.
//
// Экран отвечает на вопросы, которые логист задаёт постоянно:
//   «Чем машина ехала неделю назад и по какому маршруту?» — период + машина;
//   «В том рейсе был заказ такой-то организации» — состав рейса по точкам;
//   «Оплата не поступила — как связаться?» — клиент, ИНН, телефон, срок.
//
// Устроен так, чтобы работал без обучения: сверху период крупными кнопками,
// ниже сводка («за период» — рейсы, километры, оплачено и сколько ждём),
// далее список рейсов свежими вверх. Каждый рейс раскрывается тапом —
// и виден весь состав с оплатой по каждому заказу.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  History as HistoryIcon,
  MapPin,
  Phone,
  Truck,
  User,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, EmptyState, ErrorState, KpiCard, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import {
  formatCount,
  formatDateShort,
  formatKm,
  formatMoney,
  formatWeightKg,
  plural,
  shortCity,
  telHref,
} from "@/lib/logist-mobile/format"
import { HISTORY_PERIODS } from "@/lib/logist-mobile/route-history"

/** Заказ рейса в истории — ровно то, что отдаёт /api/routes/history. */
interface HistoryOrder {
  id: string
  routeSequence: number | null
  routeFrom: string
  routeTo: string
  distance: number | null
  cargoType: string | null
  weight: number | null
  status: string
  statusLabel: string
  clientName: string | null
  clientContact: string | null
  client: {
    id: string
    name: string
    inn: string | null
    phone: string | null
    email: string | null
    address: string | null
    paymentType: string | null
    deferredDays: number | null
  } | null
  price: number | null
  agreedPrice: number | null
  payment: {
    label: string
    tone: "paid" | "wait" | "overdue" | "unknown"
    amount: number
    dueDate: string | null
    overdueDays: number
  }
}

interface HistoryRoute {
  id: string
  name: string | null
  status: string
  statusLabel: string
  date: string | null
  startedAt: string | null
  completedAt: string | null
  driver: { id: string; name: string; phone: string | null } | null
  vehicle: { id: string; plate: string; type: string } | null
  totalDistance: number | null
  cargoWeight: number | null
  orders: HistoryOrder[]
  amount: number
  overdueAmount: number
  overdueCount: number
}

interface HistoryResponse {
  success: boolean
  filters: { days: number; vehicleId: string | null; driverId: string | null; onlyOverdue: boolean }
  routes: HistoryRoute[]
  summary: {
    routes: number
    orders: number
    distanceKm: number
    cargoWeightKg: number
    amount: number
    paidAmount: number
    waitingAmount: number
    overdueAmount: number
    overdueCount: number
    unknownCount: number
    debtorClients: number
  }
  vehicles: Array<{ id: string; plate: string; type: string }>
  drivers: Array<{ id: string; name: string }>
}

/** Тон состояния оплаты: цвет и значок читаются раньше текста. */
const PAYMENT_TONE: Record<HistoryOrder["payment"]["tone"], { cls: string; icon: typeof CheckCircle2 }> = {
  paid: { cls: "bg-success/12 text-success", icon: CheckCircle2 },
  wait: { cls: "bg-primary/10 text-primary", icon: Clock },
  overdue: { cls: "bg-destructive/12 text-destructive", icon: AlertTriangle },
  unknown: { cls: "bg-secondary text-muted-foreground", icon: Clock },
}

/** Тон рейса: «долг» важнее «завершён» — такой рейс поднимается глазами. */
function routeCardTone(route: HistoryRoute): string {
  if (route.overdueCount > 0) return "border-destructive/30"
  if (route.status === "cancelled") return "border-border/60 opacity-80"
  return "border-border"
}

/** «Москва — Тула — Воронеж» одной строкой, длинные рейсы сжимаются. */
function routeLine(orders: HistoryOrder[]): string {
  const points: string[] = []
  for (const order of orders) {
    for (const value of [order.routeFrom, order.routeTo]) {
      const city = shortCity(value)
      if (city && city !== "—" && !points.includes(city)) points.push(city)
    }
  }
  if (points.length === 0) return "Точки не указаны"
  if (points.length <= 4) return points.join(" — ")
  return `${points[0]} — ещё ${formatCount(points.length - 2, ["точка", "точки", "точек"])} — ${points[points.length - 1]}`
}

export default function LogistHistoryPage() {
  const { user } = useStaffSession()
  const [days, setDays] = useState(30)
  const [vehicleId, setVehicleId] = useState("")
  const [driverId, setDriverId] = useState("")
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [openRouteId, setOpenRouteId] = useState<string | null>(null)

  // Фильтры уходят на сервер: за «всё время» рейсов могут быть сотни,
  // а телефону нужен только выбранный период.
  const query = useMemo(() => {
    const params = new URLSearchParams()
    params.set("days", String(days))
    if (vehicleId) params.set("vehicleId", vehicleId)
    if (driverId) params.set("driverId", driverId)
    if (onlyOverdue) params.set("onlyOverdue", "1")
    return `/api/routes/history?${params.toString()}`
  }, [days, vehicleId, driverId, onlyOverdue])

  const { data, error, loading, firstLoad, reload } = useJsonApi<HistoryResponse>(
    user ? query : null,
  )

  const routes = data?.routes ?? []
  const summary = data?.summary ?? null
  const periodLabel = HISTORY_PERIODS.find((period) => period.days === days)?.label ?? "Период"

  return (
    <div className="px-4 pb-24 pt-3">
      <LogistHeader
        back
        title="История рейсов"
        subtitle="Что возили, по какому маршруту и кто ещё не заплатил"
      />

      {/* ── Период: первый вопрос логиста — «за сколько назад» ── */}
      <div className="mt-3 flex gap-2" role="group" aria-label="Период истории">
        {HISTORY_PERIODS.map((period) => {
          const active = period.days === days
          return (
            <button
              key={String(period.days)}
              type="button"
              onClick={() => setDays(period.days as number)}
              aria-pressed={active}
              className={`min-h-[44px] flex-1 rounded-xl text-[14px] font-medium transition-colors active:opacity-70 ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-muted-foreground"
              }`}
            >
              {period.label}
            </button>
          )
        })}
      </div>

      {/* ── Фильтры: машина и водитель — «чем ехал именно он» ── */}
      <div className="mt-2.5 flex gap-2">
        <label className="flex min-h-[44px] flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3">
          <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Машина</span>
          <select
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            className="w-full bg-transparent text-[14px] text-foreground outline-none"
          >
            <option value="">Любая машина</option>
            {(data?.vehicles ?? []).map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plate}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-[44px] flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3">
          <User className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="sr-only">Водитель</span>
          <select
            value={driverId}
            onChange={(event) => setDriverId(event.target.value)}
            className="w-full bg-transparent text-[14px] text-foreground outline-none"
          >
            <option value="">Любой водитель</option>
            {(data?.drivers ?? []).map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ── Переключатель «только неоплата»: быстрый разбор долгов ── */}
      <button
        type="button"
        onClick={() => setOnlyOverdue((value) => !value)}
        aria-pressed={onlyOverdue}
        className={`mt-2.5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl text-[14px] font-medium transition-colors active:opacity-70 ${
          onlyOverdue
            ? "bg-destructive/12 text-destructive"
            : "border border-border bg-card text-muted-foreground"
        }`}
      >
        <AlertTriangle className="h-4 w-4" />
        {onlyOverdue ? "Показаны рейсы с просрочкой" : "Только с непоступившей оплатой"}
      </button>

      {/* ── Сводка периода ── */}
      {summary ? (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <KpiCard
            label={`${plural(summary.routes, ["рейс", "рейса", "рейсов"])} за период`}
            value={summary.routes}
            loading={firstLoad && loading}
          />
          <KpiCard
            label="Заказов в рейсах"
            value={summary.orders}
            loading={firstLoad && loading}
          />
          <KpiCard
            label="Километров"
            value={formatKm(summary.distanceKm)}
            loading={firstLoad && loading}
          />
          <KpiCard
            label="Перевезено"
            value={formatWeightKg(summary.cargoWeightKg)}
            loading={firstLoad && loading}
          />
        </div>
      ) : null}

      {summary && summary.routes > 0 ? (
        <Card className="mt-2.5">
          <div className="text-[13px] font-medium text-muted-foreground">Деньги по заказам</div>
          <div className="mt-2 space-y-1.5 text-[14px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Оплачено</span>
              <span className="font-semibold text-success">{formatMoney(summary.paidAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Ждём оплату</span>
              <span className="font-semibold text-primary">{formatMoney(summary.waitingAmount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Просрочено</span>
              <span
                className={`font-semibold ${summary.overdueAmount > 0 ? "text-destructive" : "text-foreground"}`}
              >
                {formatMoney(summary.overdueAmount)}
              </span>
            </div>
            {summary.overdueCount > 0 ? (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">Должников среди клиентов</span>
                <span className="font-medium text-destructive">
                  {summary.debtorClients} · заказов {summary.overdueCount}
                </span>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* ── Список рейсов ── */}
      <div className="mt-5">
        {error ? <ErrorState message={error} onRetry={reload} /> : null}
        {!error && firstLoad && loading ? <ListSkeleton rows={4} /> : null}

        {!error && !loading && routes.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="h-8 w-8" />}
            title={onlyOverdue ? "Просрочек оплаты нет" : `За ${periodLabel.toLowerCase()} рейсов нет`}
            description={
              onlyOverdue
                ? "По рейсам этого периода все заказы оплачены или ещё ждут срока."
                : "Выберите «3 месяца» или «Всё время» — возможно, рейсы были раньше."
            }
            action={
              <button
                type="button"
                onClick={() => {
                  setOnlyOverdue(false)
                  setDays(0)
                }}
                className="rounded-lg bg-secondary px-4 py-2 text-[14px] font-medium text-foreground active:opacity-70"
              >
                Показать всё время
              </button>
            }
          />
        ) : null}

        <div className="space-y-2.5">
          {routes.map((route) => {
            const open = openRouteId === route.id
            return (
              <Card key={route.id} className={`${routeCardTone(route)} overflow-hidden p-0`}>
                {/* Шапка рейса: дата, маршрут, машина — тап раскрывает состав */}
                <button
                  type="button"
                  onClick={() => setOpenRouteId(open ? null : route.id)}
                  aria-expanded={open}
                  className="w-full p-4 text-left active:opacity-70"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                        <span>{route.date ? formatDateShort(route.date) : "дата неизвестна"}</span>
                        <span className="text-muted-foreground/60">·</span>
                        <span>{route.statusLabel}</span>
                      </div>
                      <div className="mt-1 flex items-start gap-1.5 text-[15px] font-semibold leading-snug text-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">{routeLine(route.orders)}</span>
                      </div>
                      <div className="mt-1 text-[13px] text-muted-foreground">
                        {route.vehicle ? route.vehicle.plate : "машина не назначена"}
                        {route.driver ? ` · ${route.driver.name}` : ""}
                        {" · "}
                        {formatCount(route.orders.length, ["заказ", "заказа", "заказов"])}
                        {route.totalDistance ? ` · ${formatKm(route.totalDistance)}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="text-[15px] font-semibold text-foreground">
                        {formatMoney(route.amount)}
                      </div>
                      {route.overdueCount > 0 ? (
                        <div className="rounded-md bg-destructive/12 px-1.5 py-0.5 text-[12px] font-medium text-destructive">
                          долг {formatMoney(route.overdueAmount)}
                        </div>
                      ) : null}
                      {open ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </button>

                {/* Состав рейса: заказы в порядке точек с оплатой по каждому */}
                {open ? (
                  <div className="border-t border-border px-4 pb-3 pt-3">
                    <div className="text-[13px] font-medium text-muted-foreground">
                      Что везли ({formatCount(route.orders.length, ["заказ", "заказа", "заказов"])})
                    </div>
                    <div className="mt-2 space-y-3">
                      {route.orders.map((order, index) => {
                        const tone = PAYMENT_TONE[order.payment.tone]
                        const ToneIcon = tone.icon
                        const phone = order.client?.phone || order.clientContact
                        return (
                          <div key={order.id} className="rounded-xl border border-border p-3">
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold text-foreground">
                                {order.routeSequence ?? index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-[14px] font-medium text-foreground">
                                  {shortCity(order.routeFrom)} → {shortCity(order.routeTo)}
                                </div>
                                <div className="mt-0.5 text-[13px] text-muted-foreground">
                                  {[order.cargoType, order.weight ? formatWeightKg(order.weight) : null, order.distance ? formatKm(order.distance) : null]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[14px] font-semibold text-foreground">
                                  {formatMoney(order.payment.amount)}
                                </div>
                                <div
                                  className={`mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium ${tone.cls}`}
                                >
                                  <ToneIcon className="h-3 w-3" />
                                  {order.payment.label}
                                </div>
                              </div>
                            </div>

                            {/* Клиент: к кому идти за оплатой */}
                            <div className="mt-2 rounded-lg bg-secondary/60 px-2.5 py-2">
                              <div className="text-[13px] font-medium text-foreground">
                                {order.client?.name || order.clientName || "Клиент не указан"}
                              </div>
                              <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                                {[
                                  order.client?.inn ? `ИНН ${order.client.inn}` : null,
                                  order.client?.address || null,
                                  order.payment.dueDate
                                    ? `срок оплаты ${formatDateShort(order.payment.dueDate)}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                              <div className="mt-1.5 flex items-center gap-3">
                                {phone ? (
                                  <a
                                    href={telHref(phone) ?? undefined}
                                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 text-[13px] font-medium text-primary active:opacity-70"
                                  >
                                    <Phone className="h-3.5 w-3.5" />
                                    {phone}
                                  </a>
                                ) : (
                                  <span className="text-[12px] text-muted-foreground">
                                    Телефон клиента не указан
                                  </span>
                                )}
                                <Link
                                  href={`/lm/orders/${order.id}`}
                                  className="inline-flex min-h-[36px] items-center rounded-lg px-1 text-[13px] font-medium text-primary active:opacity-70"
                                >
                                  Карточка заказа
                                </Link>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <Link
                      href={`/lm/routes/${route.id}`}
                      className="mt-3 inline-flex min-h-[40px] items-center rounded-lg bg-secondary px-3 text-[14px] font-medium text-foreground active:opacity-70"
                    >
                      Открыть рейс
                    </Link>
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
