// app/lm/routes/page.tsx — рейсы: кто везёт, что везёт и что с этим делать сейчас.
//
// Экран решён как «туннель»: сверху помощник сборки (рейсы, которые можно
// собрать), ниже — три вкладки (Активные / Все / Завершённые). В списке первыми
// идут рейсы, которые требуют логиста: без водителя, ждут выезда, или уже
// доехали и просят закрытия. Каждая карточка отвечает на три вопроса:
// куда едет (маршрут по точкам), с кем (водитель и машина), на каком этапе
// (подсказка следующего шага) — и даёт позвонить водителю одним тапом.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  Package,
  Phone,
  Route as RouteIcon,
  Sparkles,
  Truck,
  User,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { ROUTE_STATUS_META, type MobileOrder, type MobileRoute } from "@/lib/logist-mobile/types"
import {
  buildRouteProposals,
  proposalSummary,
  type AssistantVehicle,
} from "@/lib/logist-mobile/route-assistant"
import {
  routeListHint,
  routeStageLabel,
  routeSummaryLine,
  routeWaypoints,
  type RouteStep,
} from "@/lib/logist-mobile/route-flow"
import { formatCount, formatMoney, formatWeightKg, plural, shortCity, telHref } from "@/lib/logist-mobile/format"

const TABS = [
  { id: "active", label: "Активные" },
  { id: "all", label: "Все" },
  { id: "done", label: "Завершённые" },
] as const

type TabId = (typeof TABS)[number]["id"]

/** Цвет и значок подсказки: туннель показывает, куда смотреть, без чтения текста. */
const HINT_TONE: Record<RouteStep["tone"], string> = {
  warn: "bg-warning/12 text-warning",
  accent: "bg-primary/10 text-primary",
  ok: "bg-success/12 text-success",
  muted: "bg-secondary text-muted-foreground",
}

function HintIcon({ tone }: { tone: RouteStep["tone"] }) {
  const className = "h-3.5 w-3.5 shrink-0"
  if (tone === "warn") return <AlertTriangle className={className} />
  if (tone === "ok") return <CheckCircle2 className={className} />
  if (tone === "muted") return <Ban className={className} />
  return <ArrowRight className={className} />
}

/**
 * Маршрут одной строкой: «Москва → Тула → Воронеж». Длинные рейсы сворачиваем,
 * чтобы конечная точка не уезжала за экран телефона.
 */
function waypointLine(points: string[]): string {
  if (points.length === 0) return "Точки не заданы"
  if (points.length <= 3) return points.join(" → ")
  const middle = points.length - 2
  return `${points[0]} → ещё ${formatCount(middle, ["точка", "точки", "точек"])} → ${points[points.length - 1]}`
}

/** Приоритет «требует логиста» → «просто идёт»: так сверху всегда то, что горит. */
const TONE_PRIORITY: Record<RouteStep["tone"], number> = { warn: 0, accent: 1, muted: 2, ok: 3 }

export default function LogistRoutesPage() {
  const { user } = useStaffSession()
  // includeClosed=1 — иначе сервер отрезает завершённые рейсы, и вкладки
  // «Все» и «Завершённые» всегда показывают пустоту.
  const { data, error, loading, reload } = useJsonApi<{ routes: MobileRoute[] }>(
    user ? "/api/routes?limit=50&includeClosed=1" : null,
  )
  // Помощник: сколько рейсов можно собрать прямо сейчас
  const ordersState = useJsonApi<{ orders: MobileOrder[] }>(user ? "/api/orders?limit=200" : null)
  const vehiclesState = useJsonApi<{ vehicles: AssistantVehicle[] }>(user ? "/api/vehicles" : null)
  const [tab, setTab] = useState<TabId>("active")

  const proposals = useMemo(
    () => buildRouteProposals(ordersState.data?.orders ?? [], vehiclesState.data?.vehicles ?? []),
    [ordersState.data, vehiclesState.data],
  )

  const allRoutes = useMemo(
    () =>
      [...(data?.routes ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [data],
  )

  /** Счётчики на вкладках: видно, сколько рейсов в каждой, до перехода. */
  const counts = useMemo(() => {
    const done = allRoutes.filter((route) => ["completed", "cancelled"].includes(route.status)).length
    return { all: allRoutes.length, done, active: allRoutes.length - done } as Record<TabId, number>
  }, [allRoutes])

  const routes = useMemo(() => {
    const filtered = allRoutes.filter((route) => {
      const done = ["completed", "cancelled"].includes(route.status)
      if (tab === "active") return !done
      if (tab === "done") return done
      return true
    })
    return filtered
      .map((route) => ({ route, hint: routeListHint(route) }))
      .sort((a, b) => {
        const gap = TONE_PRIORITY[a.hint.tone] - TONE_PRIORITY[b.hint.tone]
        if (gap !== 0) return gap
        return new Date(b.route.createdAt).getTime() - new Date(a.route.createdAt).getTime()
      })
  }, [allRoutes, tab])

  return (
    <>
      <LogistHeader title="Рейсы" subtitle={`${allRoutes.length} всего`} userName={user?.name} />

      <div className="px-4 pt-3.5">
        <Link
          href="/lm/routes/assistant"
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 active:opacity-70 ${
            proposals.length > 0
              ? "border-primary/30 bg-primary/[0.08]"
              : "border-border bg-card shadow-sm"
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-semibold text-foreground">Помощник сборки</span>
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
              {proposals.length > 0
                ? `Собрал ${proposalSummary(proposals, 0).routes} ${plural(proposals.length, ["рейс", "рейса", "рейсов"])} — проверьте и предложите`
                : "Согласованные заказы соберутся в рейсы сами"}
            </span>
          </span>
          {proposals.length > 0 ? (
            <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[12px] font-semibold text-primary-foreground">
              {proposals.length}
            </span>
          ) : (
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </Link>
      </div>

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 mt-3 border-b border-border surface-glass px-4 pb-2.5 pt-3 backdrop-blur">
        <div className="flex gap-2">
          {TABS.map((item) => {
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[13px] font-medium ${
                  active
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-border bg-card shadow-sm text-muted-foreground"
                }`}
              >
                {item.label}
                <span className={active ? "text-primary/70" : "text-muted-foreground/70"}>
                  {counts[item.id]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2.5 px-4 pt-3.5">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading ? (
          <ListSkeleton rows={4} />
        ) : routes.length === 0 ? (
          <EmptyState
            icon={<RouteIcon className="h-6 w-6" />}
            title={
              tab === "active"
                ? "Активных рейсов нет"
                : tab === "done"
                  ? "Завершённых рейсов нет"
                  : "Рейсов нет"
            }
            description="Помощник соберёт рейс из согласованных заказов — откройте его сверху"
          />
        ) : (
          routes.map(({ route, hint }) => {
            const meta = ROUTE_STATUS_META[route.status] ?? ROUTE_STATUS_META.planned
            const tel = telHref(route.driver?.phone)
            const points = routeWaypoints(route.orders ?? [], shortCity)
            const summary = routeSummaryLine(
              { ...route, distanceKm: route.totalDistance ?? route.stats?.totalDistance ?? null },
              formatWeightKg,
            )
            const revenue = route.stats?.revenue ?? route.economics?.revenueRub ?? 0

            return (
              <div key={route.id} className="rounded-xl border border-border bg-card shadow-sm p-4">
                <Link href={`/lm/routes/${route.id}`} className="block active:opacity-80">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-foreground">
                      {waypointLine(points)}
                    </p>
                    <span
                      className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.style}`}
                    >
                      {routeStageLabel(route.status)}
                    </span>
                  </div>

                  <div className="mt-2 space-y-1.5 text-[13px] text-muted-foreground">
                    <p className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{route.driver?.name || "водитель не назначен"}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {route.vehicle?.plate || "машина не назначена"}
                        {route.vehicle?.type ? ` · ${route.vehicle.type}` : ""}
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{summary}</span>
                      {revenue > 0 ? (
                        <span className="ml-auto shrink-0 font-medium text-foreground">
                          {formatMoney(revenue)}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <p
                    className={`mt-2.5 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium ${HINT_TONE[hint.tone]}`}
                  >
                    <HintIcon tone={hint.tone} />
                    <span className="truncate">{hint.text}</span>
                  </p>
                </Link>

                {tel ? (
                  <a
                    href={tel}
                    className="mt-3 flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-success/12 text-[13.5px] font-medium text-success active:opacity-70"
                  >
                    <Phone className="h-4 w-4" /> Позвонить водителю
                  </a>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
