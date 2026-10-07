// app/lm/routes/page.tsx — рейсы: кто везёт, что везёт, где он.
//
// Активные рейсы — сверху: логисту на телефоне почти всегда нужен именно
// текущий рейс, а не архив. Телефон водителя вынесен в кнопку звонка прямо
// из списка — это самое частое действие по рейсу.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Package, Phone, Route as RouteIcon, Truck, User } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { ROUTE_STATUS_META, type MobileRoute } from "@/lib/logist-mobile/types"
import { shortCity, telHref } from "@/lib/logist-mobile/format"

const TABS = [
  { id: "active", label: "Активные" },
  { id: "all", label: "Все" },
  { id: "done", label: "Завершённые" },
]

function routeSummary(route: MobileRoute): string {
  const first = route.orders?.[0]
  const last = route.orders?.[route.orders.length - 1]
  if (!first || !last) return route.name || "Рейс"
  if (first.routeFrom === last.routeFrom && first.routeTo === last.routeTo) {
    return `${shortCity(first.routeFrom)} → ${shortCity(first.routeTo)}`
  }
  return `${shortCity(first.routeFrom)} → ${shortCity(last.routeTo)}`
}

export default function LogistRoutesPage() {
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<{ routes: MobileRoute[] }>(
    user ? "/api/routes?limit=50" : null,
  )
  const [tab, setTab] = useState("active")

  const routes = useMemo(() => {
    const list = data?.routes ?? []
    const filtered = list.filter((route) => {
      const done = ["completed", "cancelled"].includes(route.status)
      if (tab === "active") return !done
      if (tab === "done") return done
      return true
    })
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [data, tab])

  return (
    <>
      <LogistHeader title="Рейсы" subtitle={`${data?.routes?.length ?? 0} всего`} userName={user?.name} />

      <div className="sticky top-[57px] z-20 border-b border-white/8 bg-[#0b0b0e]/95 px-4 pb-2.5 pt-3 backdrop-blur">
        <div className="flex gap-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex-1 rounded-xl border px-3 py-2 text-[13px] font-medium ${
                tab === item.id
                  ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                  : "border-white/8 bg-white/[0.03] text-zinc-400"
              }`}
            >
              {item.label}
            </button>
          ))}
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
            title={tab === "active" ? "Активных рейсов нет" : "Рейсов нет"}
            description="Рейс собирается из согласованных заказов в полной версии"
          />
        ) : (
          routes.map((route) => {
            const meta = ROUTE_STATUS_META[route.status] ?? ROUTE_STATUS_META.planned
            const tel = telHref(route.driver?.phone)
            const ordersCount = route.orders?.length ?? 0
            const distance = route.stats?.totalDistance

            return (
              <div key={route.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <Link href={`/lm/routes/${route.id}`} className="block active:opacity-80">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-[15px] font-semibold text-white">{routeSummary(route)}</p>
                    <span
                      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.style}`}
                    >
                      {meta.label}
                    </span>
                  </div>

                  <div className="mt-2 space-y-1.5 text-[13px] text-zinc-400">
                    <p className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <span className="truncate">{route.driver?.name || "водитель не назначен"}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Truck className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <span className="truncate">
                        {route.vehicle?.plate || "машина не назначена"}
                        {route.vehicle?.type ? ` · ${route.vehicle.type}` : ""}
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Package className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      {ordersCount} {ordersCount === 1 ? "заказ" : "заказов"}
                      {distance ? <span className="text-zinc-500">· {distance} км</span> : null}
                      <ArrowRight className="ml-auto h-4 w-4 text-zinc-600" />
                    </p>
                  </div>
                </Link>

                {tel ? (
                  <a
                    href={tel}
                    className="mt-3 flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-emerald-500/12 text-[13.5px] font-medium text-emerald-200 active:bg-emerald-500/20"
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
