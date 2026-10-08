// app/lm/orders/page.tsx — список заказов: этапы, фильтры, поиск.
//
// Экран отвечает на три вопроса логиста в дороге:
//   1. что горит (просрочено и срок сегодня) — быстрые представления со счётчиками;
//   2. где всё остальное (по этапам) — полоса этапов со счётчиками;
//   3. где конкретный заказ — поиск по номеру, клиенту, адресу и грузу.
//
// Фильтры и поиск считаются на клиенте по уже загруженному списку: логисту нужен
// мгновенный отклик на каждую букву, а не круг запросов. Заказов в организации
// сотни, а не сотни тысяч — этого достаточно, и поведение одинаково на любом
// телефоне. Если заказов больше лимита, список обрезается с честной подсказкой.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Package, Plus, Search, SlidersHorizontal, X } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { OrderCard } from "@/components/logist-mobile/order-card"
import { PullToRefresh } from "@/components/logist-mobile/pull-to-refresh"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import type { MobileOrder } from "@/lib/logist-mobile/types"
import {
  ORDER_VIEWS,
  filterOrders,
  sortOrders,
  stageCounters,
  viewCounts,
  type OrderView,
} from "@/lib/logist-mobile/order-flow"
import type { OrderStage } from "@/lib/orders/stages"

const PAGE_LIMIT = 200

export default function LogistOrdersPage() {
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<{ orders: MobileOrder[]; total: number }>(
    user ? `/api/orders?limit=${PAGE_LIMIT}` : null,
  )

  const [query, setQuery] = useState("")
  const [view, setView] = useState<OrderView>("active")
  const [stage, setStage] = useState<OrderStage | "all">("all")

  const orders = useMemo(() => data?.orders ?? [], [data])
  const total = data?.total ?? orders.length

  // Счётчики этапов считаем по текущему представлению: цифра на чипе честно
  // показывает, сколько заказов откроется, если по нему нажать.
  const byView = useMemo(() => filterOrders(orders, { view }), [orders, view])
  const counters = useMemo(() => stageCounters(byView), [byView])
  const counts = useMemo(() => viewCounts(orders), [orders])

  const filtered = useMemo(
    () => sortOrders(filterOrders(orders, { view, stage, query })),
    [orders, view, stage, query],
  )

  const filtersActive = view !== "active" || stage !== "all" || query.trim().length > 0

  function resetFilters() {
    setView("active")
    setStage("all")
    setQuery("")
  }

  return (
    <>
      <LogistHeader
        title="Заказы"
        subtitle={
          counts.overdue > 0
            ? `${counts.active} в работе · ${counts.overdue} просрочено`
            : `${counts.active} в работе · ${counts.today} со сроком сегодня`
        }
        userName={user?.name}
      />

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 border-b border-white/8 bg-[#0b0b0e]/95 px-4 pb-2.5 pt-3 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputMode="search"
            placeholder="Номер, клиент, город, груз…"
            className="h-11 w-full rounded-xl border border-white/8 bg-white/[0.04] pl-9 pr-9 text-[15px] text-white placeholder:text-zinc-500 focus:border-orange-500/50 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить поиск"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 active:bg-white/8"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          {ORDER_VIEWS.map((item) => {
            const active = view === item.id
            const count = counts[item.id]
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-pressed={active}
                className={`flex min-h-[46px] flex-col items-center justify-center rounded-xl border px-1 py-1.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                    : "border-white/8 bg-white/[0.03] text-zinc-400"
                }`}
              >
                <span className="text-[15px] font-semibold leading-none">{count}</span>
                <span className="mt-1 leading-none">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <PullToRefresh onRefresh={reload} className="px-4 pt-3.5">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading ? (
          <ListSkeleton rows={5} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Заказов нет"
            description="Создайте первый — или загрузите заказы из ATI в разделе «Поиск грузов»"
            action={
              <Link
                href="/lm/orders/new"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-500 px-4 text-[14px] font-semibold text-white active:bg-orange-600"
              >
                <Plus className="h-4 w-4" /> Новый заказ
              </Link>
            }
          />
        ) : (
          <>
            <StageStrip
              counters={counters}
              selected={stage}
              onSelect={(next) => setStage(next === stage ? "all" : next)}
            />

            {filtered.length === 0 ? (
              <EmptyState
                icon={<SlidersHorizontal className="h-6 w-6" />}
                title="Ничего не найдено"
                description={
                  query
                    ? `По запросу «${query.trim()}» заказов нет`
                    : "В этом фильтре пусто — попробуйте другое представление"
                }
                action={
                  filtersActive ? (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/8 px-4 text-[14px] font-medium text-white active:bg-white/12"
                    >
                      Сбросить фильтры
                    </button>
                  ) : null
                }
              />
            ) : (
              <div className="space-y-2.5">
                <p className="px-1 text-[12px] text-zinc-500">
                  {filtered.length === 1 ? "1 заказ" : `${filtered.length} заказов`}
                  {stage !== "all" ? " в этом этапе" : ""}
                </p>
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
          </>
        )}
      </PullToRefresh>

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

/**
 * Полоса этапов: сколько заказов на каждом шаге процесса. Она же фильтр —
 * нажал «Документы» и видишь только заказы, у которых горят документы.
 */
function StageStrip({
  counters,
  selected,
  onSelect,
}: {
  counters: { stage: OrderStage; title: string; count: number }[]
  selected: OrderStage | "all"
  onSelect: (stage: OrderStage) => void
}) {
  const visible = counters.filter((item) => item.count > 0 || item.stage === selected)
  if (visible.length === 0) return null

  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {visible.map((item) => {
        const active = selected === item.stage
        return (
          <button
            key={item.stage}
            type="button"
            onClick={() => onSelect(item.stage)}
            aria-pressed={active}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors ${
              active
                ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                : "border-white/8 bg-white/[0.03] text-zinc-400"
            }`}
          >
            {item.title}
            <span className={active ? "text-orange-200/80" : "text-zinc-500"}>{item.count}</span>
          </button>
        )
      })}
    </div>
  )
}
