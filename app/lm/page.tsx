// app/lm/page.tsx — главный экран мобильной панели (логист и админ).
//
// Задача 2 чек-листа: экран отвечает на один вопрос — «что сделать сейчас».
// Порядок блоков именно такой:
//   1. Дела (только то, что требует решения, и только если оно есть);
//   2. четыре цифры — общая картина;
//   3. одно главное действие и два быстрых перехода;
//   4. два коротких списка: что подгорает и что едет.
//
// Убрано лишнее: блок «Администрирование» (он в «Ещё»), «Свежие заказы»
// (дублируют вкладку «Заказы») и подсказка про полную версию (тоже в «Ещё»).
// Экраны админа и логиста совпадают: и данные, и права проверяет API.

"use client"

import Link from "next/link"
import type { ComponentType } from "react"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Map as MapIcon,
  Package,
  Plus,
  Route as RouteIcon,
  Truck,
  UserPlus,
  Users,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { OrderCard } from "@/components/logist-mobile/order-card"
import { PullToRefresh } from "@/components/logist-mobile/pull-to-refresh"
import { EmptyState, ErrorState, KpiCard, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import {
  ATTENTION_STATUSES,
  ROUTE_STATUS_META,
  type MobileDriver,
  type MobileOrder,
  type MobileRoute,
} from "@/lib/logist-mobile/types"
import { formatDeadline, plural, routeTitle } from "@/lib/logist-mobile/format"

/** Строка «что сделать» — показываем только когда есть что делать */
interface HomeAction {
  key: string
  href: string
  icon: ComponentType<{ className?: string }>
  /** Готовая фраза: «2 заявки на доступ» */
  title: string
  hint: string
  tone: "danger" | "warn" | "default"
}

export default function LogistHomePage() {
  const { user, isLoading: sessionLoading } = useStaffSession()

  const orders = useJsonApi<{ orders: MobileOrder[] }>(user ? "/api/orders?limit=200" : null)
  const routes = useJsonApi<{ routes: MobileRoute[] }>(user ? "/api/routes?limit=50" : null)
  const drivers = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)
  // Заявки на доступ видят и логист, и админ — решение принимает API (пункт 2.4)
  const staff = useJsonApi<{ pendingCount: number }>(
    user ? "/api/auth/users?status=pending&pageSize=1" : null,
  )

  const orderList = orders.data?.orders ?? []
  const routeList = routes.data?.routes ?? []
  const driverList = drivers.data?.drivers ?? []
  const pendingCount = staff.data?.pendingCount ?? 0

  const activeOrders = orderList.filter(
    (order) => !["delivered", "cancelled", "rejected", "expired"].includes(order.status),
  )
  const overdueOrders = activeOrders.filter((order) => formatDeadline(order.deadline).overdue)
  const attentionOrders = activeOrders
    .filter(
      (order) => ATTENTION_STATUSES.includes(order.status) || formatDeadline(order.deadline).overdue,
    )
    .sort((a, b) => {
      const aTime = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER
      const bTime = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER
      return aTime - bTime
    })
  const unassignedOrders = activeOrders.filter((order) => !order.assignedDriverId)

  const activeRoutes = routeList.filter((route) => !["completed", "cancelled"].includes(route.status))
  const routesWithoutDriver = activeRoutes.filter((route) => !route.driver)
  const freeDrivers = driverList.filter((driver) => driver.status === "available")

  const loading = sessionLoading || orders.loading || routes.loading || drivers.loading
  const routesLoading = sessionLoading || routes.loading
  const driversLoading = sessionLoading || drivers.loading
  const ordersLoading = sessionLoading || orders.loading
  const anyError = orders.error || routes.error || drivers.error
  const staffLoading = sessionLoading || staff.loading

  // «Сделать сейчас»: сначала то, что остановит работу (просрочка, заявки),
  // потом то, что нужно распределить. Больше четырёх строк не показываем.
  const actions: HomeAction[] = ([ 
    {
      key: "pending",
      href: "/lm/users",
      icon: UserPlus,
      title: `${pendingCount} ${plural(pendingCount, ["заявка", "заявки", "заявок"])} на доступ`,
      hint: "ждут одобрения",
      tone: "warn",
    },
    {
      key: "overdue",
      href: "/lm/orders",
      icon: AlertTriangle,
      title: `${overdueOrders.length} ${plural(overdueOrders.length, ["заказ", "заказа", "заказов"])} просрочено`,
      hint: "срок уже прошёл",
      tone: "danger",
    },
    {
      key: "unassigned",
      href: "/lm/orders",
      icon: Truck,
      title: `${unassignedOrders.length} ${plural(unassignedOrders.length, ["заказ", "заказа", "заказов"])} без водителя`,
      hint: "нужно назначить",
      tone: "warn",
    },
    {
      key: "routes",
      href: "/lm/routes",
      icon: RouteIcon,
      title: `${routesWithoutDriver.length} ${plural(routesWithoutDriver.length, ["рейс", "рейса", "рейсов"])} без водителя`,
      hint: "рейс не поедет",
      tone: "warn",
    },
  ] as HomeAction[])
    .filter((action) => {
      if (action.key === "pending") return !staffLoading && pendingCount > 0
      if (ordersLoading || routesLoading) return false
      // Убираем строки с нулём: «0 просрочено» — это шум, а не дело
      return !action.title.startsWith("0 ")
    })
    .slice(0, 4)

  const today = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  })

  const refresh = () => {
    orders.reload()
    routes.reload()
    drivers.reload()
    staff.reload()
  }

  return (
    <>
      <LogistHeader title="Логистика" subtitle={today} userName={user?.name} />

      <PullToRefresh onRefresh={refresh} className="px-4 pt-4">
        <SectionTitle title="Сделать сейчас" />
        {loading ? (
          <ListSkeleton rows={2} />
        ) : actions.length === 0 ? (
          <div className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
            <span className="text-[13.5px] text-emerald-100">
              Срочного нет: заказы распределены, сроки в порядке
            </span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {actions.map((action) => {
              const Icon = action.icon
              const tone =
                action.tone === "danger"
                  ? "border-red-500/35 bg-red-500/[0.09] text-red-100"
                  : "border-amber-500/30 bg-amber-500/[0.09] text-amber-100"
              const iconTone = action.tone === "danger" ? "text-red-300" : "text-amber-300"

              return (
                <Link
                  key={action.key}
                  href={action.href}
                  className={`flex min-h-[64px] items-center gap-3 rounded-2xl border px-4 active:opacity-90 ${tone}`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${iconTone}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold">{action.title}</span>
                    <span className="mt-0.5 block text-[12px] text-zinc-400/90">{action.hint}</span>
                  </span>
                  <ArrowRight className={`h-4 w-4 shrink-0 ${iconTone}`} />
                </Link>
              )
            })}
          </div>
        )}

        {/* Четыре цифры — короткая сводка, не больше */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <KpiCard
            label="Заказов в работе"
            value={activeOrders.length}
            loading={ordersLoading}
            href="/lm/orders"
          />
          <KpiCard
            label="Требуют внимания"
            value={attentionOrders.length}
            loading={ordersLoading}
            tone={attentionOrders.length > 0 ? "warn" : "good"}
            href="/lm/orders"
          />
          <KpiCard
            label="Активных рейсов"
            value={activeRoutes.length}
            loading={routesLoading}
            tone="accent"
            href="/lm/routes"
          />
          <KpiCard
            label="Машин свободно"
            value={`${freeDrivers.length} из ${driverList.length}`}
            loading={driversLoading}
            href="/lm/drivers"
          />
        </div>

        {/* Главное действие и два быстрых перехода */}
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <Link
            href="/lm/orders/new"
            className="flex min-h-[76px] flex-col items-start justify-between rounded-2xl bg-orange-500 p-3.5 text-white active:bg-orange-600"
          >
            <Plus className="h-5.5 w-5.5" />
            <span className="text-[13.5px] font-semibold leading-tight">Новый заказ</span>
          </Link>
          <Link
            href="/lm/map"
            className="flex min-h-[76px] flex-col items-start justify-between rounded-2xl border border-white/8 bg-white/[0.03] p-3.5 text-zinc-100 active:bg-white/[0.06]"
          >
            <MapIcon className="h-5.5 w-5.5 text-orange-300" />
            <span className="text-[13.5px] font-medium leading-tight">Карта</span>
          </Link>
          <Link
            href="/lm/drivers"
            className="flex min-h-[76px] flex-col items-start justify-between rounded-2xl border border-white/8 bg-white/[0.03] p-3.5 text-zinc-100 active:bg-white/[0.06]"
          >
            <Truck className="h-5.5 w-5.5 text-orange-300" />
            <span className="text-[13.5px] font-medium leading-tight">Водители</span>
          </Link>
        </div>

        {anyError ? (
          <div className="mt-6">
            <ErrorState message={anyError} onRetry={refresh} />
          </div>
        ) : null}

        <SectionTitle
          title="Требуют внимания"
          action={{ label: "Все заказы", href: "/lm/orders" }}
        />
        {ordersLoading ? (
          <ListSkeleton rows={2} />
        ) : attentionOrders.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Срочных задач нет"
            description="Заказы распределены, сроки не подгорают"
          />
        ) : (
          <div className="space-y-2.5">
            {attentionOrders.slice(0, 3).map((order) => {
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
        {routesLoading ? (
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
                    <span
                      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.style}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 truncate text-[13px] text-zinc-400">
                    <Users className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    {route.driver?.name || "водитель не назначен"}
                    {route.vehicle?.plate ? (
                      <span className="text-zinc-500">· {route.vehicle.plate}</span>
                    ) : null}
                  </p>
                  {route.orders?.length ? (
                    <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-zinc-500">
                      <Package className="h-3.5 w-3.5" />
                      {route.orders.length} {plural(route.orders.length, ["заказ", "заказа", "заказов"])}
                      <ArrowRight className="ml-auto h-3.5 w-3.5" />
                    </p>
                  ) : null}
                </Link>
              )
            })}
          </div>
        )}
      </PullToRefresh>
    </>
  )
}
