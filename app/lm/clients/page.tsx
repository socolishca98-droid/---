// app/lm/clients/page.tsx — клиенты.
//
// Логисту клиенты нужны ради двух вещей: позвонить и понять, кто должен денег.
// Поэтому в карточке сразу телефон с кнопкой и сумма долга, а не реквизиты.

"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ChevronRight, Phone, Search, Users, X } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import type { MobileClient } from "@/lib/logist-mobile/types"
import { formatCount, formatMoney, formatRelative, shortCity, telHref } from "@/lib/logist-mobile/format"

export default function LogistClientsPage() {
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<{ clients: MobileClient[]; total: number }>(
    user ? "/api/clients" : null,
  )
  const [query, setQuery] = useState("")

  const clients = useMemo(() => {
    const list = data?.clients ?? []
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? list.filter((client) =>
          [client.name, client.inn, client.contactName, client.phone, client.address]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : list

    // Сначала те, кому должны, — за ними и звонят
    return [...filtered].sort((a, b) => (b.stats?.unpaidRub ?? 0) - (a.stats?.unpaidRub ?? 0))
  }, [data, query])

  return (
    <>
      <LogistHeader
        title="Клиенты"
        subtitle={data?.total != null ? formatCount(data.total, ["клиент", "клиента", "клиентов"]) : undefined}
        userName={user?.name}
      />

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 border-b border-border surface-glass px-4 py-3 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputMode="search"
            placeholder="Название, ИНН, контакт"
            className="h-11 w-full rounded-xl border border-border bg-secondary pl-9 pr-9 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2.5 px-4 pt-3.5">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading ? (
          <ListSkeleton rows={4} />
        ) : clients.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="Клиентов не найдено" />
        ) : (
          clients.map((client) => {
            const tel = telHref(client.phone)
            const unpaid = client.stats?.unpaidRub ?? 0
            const overdue = client.stats?.overdueRub ?? 0

            return (
              <div key={client.id} className="rounded-xl border border-border bg-card shadow-sm p-4">
                <Link href={`/lm/clients/${client.id}`} className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-foreground">{client.name}</p>
                    <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                      {client.contactName || "контакт не указан"}
                      {client.address ? ` · ${shortCity(client.address)}` : ""}
                    </p>
                    {client.stats ? (
                      <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                        {formatCount(client.stats.total, ["заказ", "заказа", "заказов"])}
                        {client.stats.lastOrderAt ? ` · последний ${formatRelative(client.stats.lastOrderAt)}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/80" />
                </Link>

                {unpaid > 0 ? (
                  <p
                    className={`mt-2.5 inline-flex rounded-md border px-2.5 py-1 text-[12.5px] ${
                      overdue > 0
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-warning/40 bg-warning/10 text-warning"
                    }`}
                  >
                    {overdue > 0 ? `Просрочено ${formatMoney(overdue)}` : `Не оплачено ${formatMoney(unpaid)}`}
                  </p>
                ) : (
                  <p className="mt-2.5 text-[12.5px] text-success/80">Долгов нет</p>
                )}

                {tel ? (
                  <a
                    href={tel}
                    className="mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-success/15 text-[13.5px] font-medium text-success active:opacity-70"
                  >
                    <Phone className="h-4 w-4" />
                    {client.phone}
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
