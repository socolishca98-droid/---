// app/lm/orders/page.tsx — список заказов с поиском и фильтрами.
//
// Поиск и фильтрация идут на клиенте по уже загруженному списку: логисту нужен
// мгновенный отклик при вводе, а не круг запросов на каждую букву.
// Если заказов станет больше лимита — список обрежется с честной подсказкой.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Package, Plus, Search, X } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { OrderCard } from "@/components/logist-mobile/order-card"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { ORDER_FILTERS, type MobileOrder } from "@/lib/logist-mobile/types"
import { orderTitle } from "@/lib/logist-mobile/format"

const PAGE_LIMIT = 200

export default function LogistOrdersPage() {
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<{ orders: MobileOrder[]; total: number }>(
    user ? `/api/orders?limit=${PAGE_LIMIT}` : null,
  )

  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<string>("active")

  const orders = data?.orders ?? []
  const total = data?.total ?? orders.length

  const filtered = useMemo(() => {
    const group = ORDER_FILTERS.find((item) => item.id === filter)
    const needle = query.trim().toLowerCase()

    return orders
      .filter((order) => (group ? group.statuses.includes(order.status) : true))
      .filter((order) => {
        if (!needle) return true
        const haystack = [
          orderTitle(order),
          order.clientName,
          order.clientContact,
          order.routeFrom,
          order.routeTo,
          order.cargoType,
          order.id,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return haystack.includes(needle)
      })
      .sort((a, b) => {
        // Сначала те, у кого срок ближе, затем новые
        const aTime = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER
        const bTime = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER
        if (aTime !== bTime) return aTime - bTime
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
  }, [orders, filter, query])

  return (
    <>
      <LogistHeader title="Заказы" subtitle={`${total} всего`} userName={user?.name} />

      <div className="sticky top-[57px] z-20 border-b border-white/8 bg-[#0b0b0e]/95 px-4 pb-2.5 pt-3 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputMode="search"
            placeholder="Клиент, город, груз…"
            className="h-11 w-full rounded-xl border border-white/8 bg-white/[0.04] pl-9 pr-9 text-[15px] text-white placeholder:text-zinc-500 focus:border-orange-500/50 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 active:bg-white/8"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="-mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ORDER_FILTERS.map((item) => {
            const active = filter === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                    : "border-white/8 bg-white/[0.03] text-zinc-400"
                }`}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="px-4 pt-3.5">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading ? (
          <ListSkeleton rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title={query ? "Ничего не найдено" : "Заказов нет"}
            description={query ? "Попробуйте изменить запрос или фильтр" : "Создайте первый заказ"}
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
            {total > orders.length ? (
              <p className="pt-1 text-center text-[12px] text-zinc-600">
                Показаны последние {orders.length} из {total} — остальные в полной версии
              </p>
            ) : null}
          </div>
        )}
      </div>

      <Link
        href="/lm/orders/new"
        aria-label="Новый заказ"
        className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-[max(1rem,calc(50%-13rem))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-white shadow-lg shadow-orange-500/20 active:bg-orange-600"
      >
        <Plus className="h-6 w-6" />
      </Link>
    </>
  )
}
