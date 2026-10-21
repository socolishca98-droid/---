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
  FileText,
  Map as MapIcon,
  Package,
  Plus,
  Route as RouteIcon,
  Truck,
  UserPlus,
  Users,
  Wallet,
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
import { missingForDocuments } from "@/lib/documents/missing"

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
  // includeClosed=1: завершённые рейсы нужны для пункта «рейс закрыт, а для
  // документов не хватает данных» — без флага API отрезает их из списка.
  const routes = useJsonApi<{ routes: MobileRoute[] }>(user ? "/api/routes?limit=50&includeClosed=1" : null)
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

  // ── B3: рейсы завершены, а для документов не хватает данных ──
  // Берём те же данные, что печать (lib/documents/missing.ts): реквизиты
  // здесь не проверяем (их видно в диалоге печати), смотрим по рейсу —
  // экипаж, цены, клиентов, сроки.
  const routesAwaitingDocuments = routeList
    .filter((route) => route.status === "completed")
    .map((route) => ({
      route,
      missing: missingForDocuments({
        route: {
          driverName: route.driver?.name ?? null,
          vehiclePlate: route.vehicle?.plate ?? null,
          orders: (route.orders ?? []).map((order) => ({
            clientName: order.clientName ?? null,
            weightKg: order.weight ?? null,
            priceRub: order.price ?? null,
            agreedPriceRub: order.agreedPrice ?? null,
            deadline: order.deadline ?? null,
            paymentType: order.paymentType ?? null,
            vatType: order.vatType ?? null,
          })),
        },
      }),
    }))
    .filter((item) => item.missing.length > 0)

  // ── B3: просроченные оплаты — срок прошёл, денег нет ──
  const now = new Date()
  const overduePayments = orderList.filter((order) => {
    if (order.isPaid || !order.dueDate) return false
    return new Date(order.dueDate).getTime() < now.getTime()
  })
  const overduePaymentsSum = overduePayments.reduce(
    (sum, order) => sum + (order.agreedPrice ?? order.price ?? 0),
    0,
  )

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
    {
      key: "docs-missing",
      href: "/lm/routes",
      icon: FileText,
      title: `${routesAwaitingDocuments.length} ${plural(routesAwaitingDocuments.length, ["рейс", "рейса", "рейсов"])} ждут данные для документов`,
      hint: "рейс закрыт, а счёт и акт не выйдут",
      tone: "warn",
    },
    {
      key: "payments-overdue",
      href: "/lm/payments",
      icon: Wallet,
      title: `${overduePayments.length} ${plural(overduePayments.length, ["оплата", "оплаты", "оплат"])} просрочено`,
      hint: `на ${overduePaymentsSum.toLocaleString("ru-RU").replace(/\u00a0/g, " ")} ₽ — срок прошёл`,
      tone: "danger",
    },
  ] as HomeAction[])
    .filter((action) => {
      if (action.key === "pending") return !staffLoading && pendingCount > 0
      if (action.key === "docs-missing") return !routesLoading && routesAwaitingDocuments.length > 0
      if (action.key === "payments-overdue") return !ordersLoading && overduePayments.length > 0
      if (ordersLoading || routesLoading) return false
      // Убираем строки с нулём: «0 просрочено» — это шум, а не дело
      return !action.title.startsWith("0 ")
    })
    .slice(0, 6)

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
      <LogistHeader title="Главная" subtitle={today} userName={user?.name} />

      <PullToRefresh onRefresh={refresh} className="px-4 pt-4">
        <SectionTitle title="Сделать сейчас" />
        {loading ? (
          <ListSkeleton rows={2} />
        ) : actions.length === 0 ? (
          <div className="flex min-h-[56px] items-center gap-3 rounded-xl border border-success/25 bg-success/[0.07] px-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
            <span className="text-[13.5px] text-success">
              Срочного нет: заказы распределены, сроки в порядке
            </span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {actions.map((action) => {
              const Icon = action.icon
              const tone =
                action.tone === "danger"
                  ? "border-destructive/35 bg-destructive/10 text-destructive"
                  : "border-warning/30 bg-warning/10 text-warning"
              const iconTone = action.tone === "danger" ? "text-destructive" : "text-warning"

              return (
                <Link
                  key={action.key}
                  href={action.href}
                  className={`flex min-h-[64px] items-center gap-3 rounded-xl border px-4 active:opacity-90 ${tone}`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${iconTone}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold">{action.title}</span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground/90">{action.hint}</span>
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
            className="flex min-h-[76px] flex-col items-start justify-between rounded-xl bg-primary p-3.5 text-primary-foreground active:opacity-70"
          >
            <Plus className="h-5.5 w-5.5" />
            <span className="text-[13.5px] font-semibold leading-tight">Новый заказ</span>
          </Link>
          <Link
            href="/lm/map"
            className="flex min-h-[76px] flex-col items-start justify-between rounded-xl border border-border bg-card shadow-sm p-3.5 text-foreground active:opacity-70"
          >
            <MapIcon className="h-5.5 w-5.5 text-primary" />
            <span className="text-[13.5px] font-medium leading-tight">Карта</span>
          </Link>
          <Link
            href="/lm/drivers"
            className="flex min-h-[76px] flex-col items-start justify-between rounded-xl border border-border bg-card shadow-sm p-3.5 text-foreground active:opacity-70"
          >
            <Truck className="h-5.5 w-5.5 text-primary" />
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
                    <div className="mb-1 inline-flex items-center gap-1 text-[11.5px] text-destructive">
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

        {/* B3: рейсы закрыты, а для документов не хватает данных — счёт и акт не выйдут */}
        {routesAwaitingDocuments.length > 0 ? (
          <>
            <SectionTitle
              title="Ждут данные для документов"
              action={{ label: "Все рейсы", href: "/lm/routes" }}
            />
            <div className="space-y-2.5">
              {routesAwaitingDocuments.slice(0, 3).map(({ route, missing }) => {
                const meta = ROUTE_STATUS_META[route.status] ?? ROUTE_STATUS_META.planned
                const first = route.orders?.[0]
                const last = route.orders?.[route.orders.length - 1]
                return (
                  <Link
                    key={route.id}
                    href={`/lm/routes/${route.id}`}
                    className="block rounded-xl border border-warning/30 bg-warning/[0.07] p-4 active:opacity-70"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
                        {route.name || (first ? routeTitle(first.routeFrom, last?.routeTo) : "Рейс")}
                      </p>
                      <span
                        className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.style}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-warning">
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      Не хватает: {missing.map((item) => item.label.toLowerCase()).join(", ")}
                    </p>
                  </Link>
                )
              })}
            </div>
          </>
        ) : null}

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
                  className="block rounded-xl border border-border bg-card shadow-sm p-4 active:opacity-70"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
                      {route.name || (first ? routeTitle(first.routeFrom, last?.routeTo) : "Рейс")}
                    </p>
                    <span
                      className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.style}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
                    <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {route.driver?.name || "водитель не назначен"}
                    {route.vehicle?.plate ? (
                      <span className="text-muted-foreground">· {route.vehicle.plate}</span>
                    ) : null}
                  </p>
                  {route.orders?.length ? (
                    <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
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
