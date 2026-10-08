// app/lm/chat/page.tsx — переписка с водителями.
//
// Отдельного «списка чатов» в API нет: сообщения хранятся по водителю.
// Поэтому экран — это список экипажа, откуда открывается переписка.

"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ChevronRight, MessageSquare, Search, X } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { DRIVER_STATUS_META, type MobileDriver } from "@/lib/logist-mobile/types"
import { formatRelative } from "@/lib/logist-mobile/format"

export default function LogistChatPage() {
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)
  const [query, setQuery] = useState("")

  const drivers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = data?.drivers ?? []
    if (!needle) return list
    return list.filter((driver) => [driver.name, driver.phone, driver.vehiclePlate].filter(Boolean).join(" ").toLowerCase().includes(needle))
  }, [data, query])

  return (
    <>
      <LogistHeader title="Чат" subtitle="Переписка с водителями" userName={user?.name} />

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 border-b border-white/8 bg-[#0b0b0e]/95 px-4 py-3 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputMode="search"
            placeholder="Имя или машина"
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
      </div>

      <div className="space-y-2.5 px-4 pt-3.5">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading ? (
          <ListSkeleton rows={4} />
        ) : drivers.length === 0 ? (
          <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="Водителей не найдено" />
        ) : (
          drivers.map((driver) => {
            const meta = DRIVER_STATUS_META[driver.status] ?? DRIVER_STATUS_META.offline
            return (
              <Link
                key={driver.id}
                href={`/lm/chat/${driver.id}`}
                className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4 active:bg-white/[0.06]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/8 text-[15px] font-semibold text-white">
                  {driver.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-white">{driver.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px]">
                    <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                    <span className={meta.text}>{meta.label}</span>
                    {driver.lastGpsUpdate ? <span className="text-zinc-600">· {formatRelative(driver.lastGpsUpdate)}</span> : null}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
              </Link>
            )
          })
        )}
      </div>
    </>
  )
}
