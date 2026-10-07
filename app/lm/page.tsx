// app/lm/page.tsx — главный экран мобильной панели логиста.
//
// Отвечает на три вопроса с одного взгляда: что происходит сейчас, что
// требует действий, и где смотреть дальше. Данные — те же /api/*, что у
// десктопа: сводка считается на клиенте из уже загруженных списков, чтобы
// не плодить серверные роуты только для мобильной версии.

"use client"

import Link from "next/link"
import { AlertTriangle, ArrowRight, Map as MapIcon, Package, Plus, Route as RouteIcon, Truck, Users } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { OrderCard } from "@/components/logist-mobile/order-card"
import { EmptyState, ErrorState, KpiCard, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { ROUTE_STATUS_META, ATTENTION_STATUSES, type MobileDriver, type MobileOrder, type MobileRoute } from "@/lib/logist-mobile/types"
import { formatDeadline, routeTitle } from "@/lib/logist-mobile/format"

export default function LogistHomePage() {
  const { user, isLoading: sessionLoading } = useStaffSession()

  const orders = useJsonApi<{ orders: MobileOrder[] }>(user ? "/api/orders?limit=200" : null)
  const routes = useJsonApi<{ routes: MobileRoute[] }>(user ? "/api/routes?limit=50" : null)
  const drivers = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)

  const orderList = orders.data?.orders ?? []
  const routeList = routes.data?.routes ?? []
  const driverList = drivers.data?.drivers ?? []

  const activeOrders = orderList.filter(
    (order) => !["delivered", "cancelled", "rejected", "expired"].includes(order.status),
  )
  const attention = activeOrders
    .filter((order) => ATTENTION_STATUSES.includes(order.status))
    .sort((a, b) => {
      const aTime = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER
      const bTime = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER
      return aTime - bTime
    })
    .slice(0, 5)

  const activeRoutes = routeList.filter((route) => !["completed", "cancelled"].includes(route.status))
  const freeDrivers = driverList.filter((driver) => driver.status === "available")

  const loading = sessionLoading || (orders.loading && routes.loading && drivers.loading)
  const anyError = orders.error || routes.error || drivers.error

  const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" })

  return (
    <>
      <LogistHeader title="Логистика" subtitle={today} userName={user?.name} />

      <div className="px-4 pt-4">
        <p className="text-[15px] text-zinc-400">
          Здравствуйте, <span className="font-medium text-white">{user?.name?.split(" ")[0] || "коллега"}</span>
        </p>

        {loading ? (
          <div className="mt-4 space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-[92px] animate-pulse rounded-2xl bg-white/[0.04]" />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <KpiCard label="Заказов в работе" value={activeOrders.length} href="/lm/orders?filter=active" />
            <KpiCard
              label="Требуют внимания"
              value={attention.length}
              tone={attention.length > 0 ? "warn" : "good"}
              href="/lm/orders"
            />
            <KpiCard label="Рейсов в пути" value={activeRoutes.length} tone="accent" href="/lm/routes" />
            <KpiCard
              label="Водителей свободно"
              value={`${freeDrivers.length} / ${driverList.length}`}
              href="/lm/drivers"
            />
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Link
            href="/lm/orders/new"
            className="flex min-h-[76px] items-center gap-3 rounded-2xl bg-orange-500 px-4 text-white active:bg-orange-600"
          >
            <Plus className="h-5.5 w-5.5 shrink-0" />
            <span className="text-[14px] font-semibold">Новый заказ</span>
          </Link>
          <Link
            href="/lm/map"
            className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-zinc-100 active:bg-white/[0.06]"
          >
            <MapIcon className="h-5.5 w-5.5 shrink-0 text-orange-300" />
            <span className="text-[14px] font-medium">Карта</span>
          </Link>
          <Link
            href="/lm/routes"
            className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-zinc-100 active:bg-white/[0.06]"
          >
            <RouteIcon className="h-5.5 w-5.5 shrink-0 text-orange-300" />
            <span className="text-[14px] font-medium">Рейсы</span>
          </Link>
          <Link
            href="/lm/drivers"
            className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-zinc-100 active:bg-white/[0.06]"
          >
            <Truck className="h-5.5 w-5.5 shrink-0 text-orange-300" />
            <span className="text-[14px] font-medium">Водители</span>
          </Link>
        </div>

        {anyError ? (
          <div className="mt-6">
            <ErrorState
              message={anyError}
              onRetry={() => {
                orders.reload()
                routes.reload()
                drivers.reload()
              }}
            />
          </div>
        ) : null}

        <SectionTitle title="Требуют внимания" action={{ label: "Все заказы", href: "/lm/orders" }} />
        {loading ? (
          <ListSkeleton rows={3} />
        ) : attention.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Срочных задач нет"
            description="Заказы распределены, сроки не подгорают"
          />
        ) : (
          <div className="space-y-2.5">
            {attention.map((order) => {
              const deadline = formatDeadline(order.deadline)
              return (
                <div key={order.id}>
                  {deadline.overdue ? (
                    <div className="mb-1 inline-flex items-center gap-1 text-[11.5px] text-red-300">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {deadline.text}
                    </div>
                  ) : null}
                  <OrderCard order={order} />
                </div>
              )
            })}
          </div>
        )}

        <SectionTitle title="Активные рейсы" action={{ label: "Все рейсы", href: "/lm/routes" }} />
        {loading ? (
          <ListSkeleton rows={2} />
        ) : activeRoutes.length === 0 ? (
          <EmptyState icon={<RouteIcon className="h-6 w-6" />} title="Активных рейсов нет" />
        ) : (
          <div className="space-y-2.5">
            {activeRoutes.slice(0, 3).map((route) => {
              const meta = ROUTE_STATUS_META[route.status] ?? ROUTE_STATUS_META.planned
              const first = route.orders?.[0]
              const last = route.orders?.[route.orders.length - 1]
              return (
                <Link
                  key={route.id}
                  href={`/lm/routes/${route.id}`}
                  className="block rounded-2xl border border-white/8 bg-white/[0.03] p-4 active:bg-white/[0.06]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">
                      {route.name || (first ? routeTitle(first.routeFrom, last?.routeTo) : "Рейс")}
                    </p>
                    <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.style}`}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 truncate text-[13px] text-zinc-400">
                    <Users className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    {route.driver?.name || "водитель не назначен"}
                    {route.vehicle?.plate ? <span className="text-zinc-500">· {route.vehicle.plate}</span> : null}
                  </p>
                  {route.orders?.length ? (
                    <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-zinc-500">
                      <Package className="h-3.5 w-3.5" />
                      {route.orders.length} {route.orders.length === 1 ? "заказ" : "заказа"}
                      <ArrowRight className="ml-auto h-3.5 w-3.5" />
                    </p>
                  ) : null}
                </Link>
              )
            })}
          </div>
        )}

        <SectionTitle title="Свежие заказы" action={{ label: "Все", href: "/lm/orders" }} />
        {loading ? (
          <ListSkeleton rows={2} />
        ) : orderList.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Заказов пока нет"
            description="Создайте первый заказ — он появится здесь и на дашборде"
            action={
              <Link
                href="/lm/orders/new"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-500 px-4 text-[14px] font-medium text-white"
              >
                <Plus className="h-4 w-4" /> Новый заказ
              </Link>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {[...orderList]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .slice(0, 3)
              .map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3">
          <div>
            <p className="text-[13px] text-zinc-400">Нужна полная версия?</p>
            <p className="text-[12px] text-zinc-600">Отчёты, карта, документы</p>
          </div>
          <Link href="/dashboard" className="text-[13px] font-medium text-orange-400">
            Открыть
          </Link>
        </div>

      </div>
    </>
  )
}
