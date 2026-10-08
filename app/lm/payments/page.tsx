// app/lm/payments/page.tsx — оплаты.
//
// Разговор логиста с клиентом почти всегда про деньги, поэтому экран построен
// вокруг сумм: получено, ждём, просрочено — и списка, кого трясти.

"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { CheckCircle2, Clock, Phone, Wallet } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, KpiCard, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import type { MobileDebtor, MobilePaymentOrder, MobilePaymentsStats } from "@/lib/logist-mobile/types"
import {
  formatCount,
  formatDateShort,
  formatMoney,
  formatRelative,
  paymentState,
  routeTitle,
  shortRef,
  telHref,
} from "@/lib/logist-mobile/format"

const TABS = [
  { id: "wait", label: "Ждут оплаты" },
  { id: "late", label: "Просрочены" },
  { id: "paid", label: "Оплачены" },
]

export default function LogistPaymentsPage() {
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<{
    orders: MobilePaymentOrder[]
    stats: MobilePaymentsStats
    debtors: MobileDebtor[]
  }>(user ? "/api/payments" : null)
  const [tab, setTab] = useState("wait")

  const stats = data?.stats
  const orders = useMemo(() => {
    const list = data?.orders ?? []
    if (tab === "paid") return list.filter((order) => order.isPaid)
    if (tab === "late") return list.filter((order) => !order.isPaid && order.isOverdue)
    return list.filter((order) => !order.isPaid)
  }, [data, tab])

  const lateCount = (data?.orders ?? []).filter((order) => !order.isPaid && order.isOverdue).length
  const waitCount = (data?.orders ?? []).filter((order) => !order.isPaid).length

  return (
    <>
      <LogistHeader
        title="Оплаты"
        subtitle={stats ? `Всего по заказам ${formatMoney(stats.totalRevenue)}` : undefined}
        userName={user?.name}
      />

      <div className="px-4 pt-4">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <KpiCard label="Получено" value={formatMoney(stats?.totalPaid ?? 0)} tone="good" />
              <KpiCard
                label="Ждём оплаты"
                value={formatMoney(stats?.totalPending ?? 0)}
                hint={formatCount(stats?.pendingCount ?? 0, ["заказ", "заказа", "заказов"])}
                tone="warn"
              />
              <KpiCard
                label="Просрочено"
                value={formatMoney(stats?.totalOverdue ?? 0)}
                hint={formatCount(stats?.overdueCount ?? 0, ["заказ", "заказа", "заказов"])}
                tone={stats?.totalOverdue ? "warn" : "default"}
              />
              <KpiCard
                label="С отсрочкой"
                value={formatMoney(stats?.totalDeferred ?? 0)}
                hint={formatCount(stats?.deferredCount ?? 0, ["заказ", "заказа", "заказов"])}
              />
            </div>

            {(data?.debtors ?? []).length > 0 ? (
              <>
                <SectionTitle title="Кому должны" />
                <div className="space-y-2.5">
                  {(data?.debtors ?? []).slice(0, 5).map((debtor) => (
                    <div
                      key={debtor.clientId ?? debtor.clientName}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card shadow-sm p-3.5"
                    >
                      <div className="min-w-0">
                        {debtor.clientId ? (
                          <Link href={`/lm/clients/${debtor.clientId}`} className="truncate text-[14.5px] font-medium text-foreground">
                            {debtor.clientName}
                          </Link>
                        ) : (
                          <p className="truncate text-[14.5px] font-medium text-foreground">{debtor.clientName}</p>
                        )}
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                          {formatCount(debtor.ordersCount, ["заказ", "заказа", "заказов"])}
                          {debtor.oldestDueDate ? ` · старейший срок ${formatDateShort(debtor.oldestDueDate)}` : ""}
                        </p>
                      </div>
                      <p className={`shrink-0 text-[14.5px] font-semibold ${debtor.overdue > 0 ? "text-destructive" : "text-warning"}`}>
                        {formatMoney(debtor.debt)}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {TABS.map((item) => {
                const count = item.id === "paid" ? (stats?.paidCount ?? 0) : item.id === "late" ? lateCount : waitCount
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`shrink-0 rounded-md border px-3.5 py-2 text-[13px] font-medium ${
                      tab === item.id
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border bg-card shadow-sm text-muted-foreground"
                    }`}
                  >
                    {item.label} {count ? `· ${count}` : ""}
                  </button>
                )
              })}
            </div>

            <div className="mt-3 space-y-2.5">
              {orders.length === 0 ? (
                <EmptyState
                  icon={tab === "paid" ? <CheckCircle2 className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
                  title={tab === "late" ? "Просрочек нет" : tab === "paid" ? "Оплат пока не было" : "Всё оплачено"}
                />
              ) : (
                orders.map((order) => {
                  const state = paymentState(order)
                  const tel = telHref(order.clientContact?.match(/\+?[\d\s()-]{10,}/)?.[0] ?? null)
                  return (
                    <div key={order.id} className="rounded-xl border border-border bg-card shadow-sm p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-foreground">{order.clientName || "Без клиента"}</p>
                          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                            {routeTitle(order.routeFrom, order.routeTo)} · № {shortRef(order.id)}
                          </p>
                        </div>
                        <p className="shrink-0 text-[15px] font-semibold text-foreground">{formatMoney(order.amount)}</p>
                      </div>

                      <p
                        className={`mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12.5px] ${
                          state.tone === "ok"
                            ? "border-success/30 bg-success/10 text-success"
                            : state.tone === "late"
                              ? "border-destructive/40 bg-destructive/10 text-destructive"
                              : "border-warning/40 bg-warning/10 text-warning"
                        }`}
                      >
                        {state.tone === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                        {state.label}
                        {order.isPaid && order.paidAt ? ` · ${formatRelative(order.paidAt)}` : ""}
                      </p>

                      <div className="mt-3 grid grid-cols-2 gap-2.5">
                        <Link
                          href={`/lm/orders/${order.id}`}
                          className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-secondary text-[13.5px] font-medium text-foreground active:opacity-70"
                        >
                          <Wallet className="h-4 w-4" /> Заказ
                        </Link>
                        {tel ? (
                          <a
                            href={tel}
                            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-success/15 text-[13.5px] font-medium text-success active:opacity-70"
                          >
                            <Phone className="h-4 w-4" /> Клиенту
                          </a>
                        ) : (
                          <span className="flex min-h-[44px] items-center justify-center rounded-xl bg-secondary text-[13px] text-muted-foreground/80">
                            нет телефона
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
