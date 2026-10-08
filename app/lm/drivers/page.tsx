// app/lm/drivers/page.tsx — водители: статус, связь, машина, где находится.
//
// Экран для звонков и контроля: логисту нужно за один тап дозвониться до
// водителя и понять, свободен он или в рейсе. Поэтому кнопки связи — крупные
// и прямо в карточке.

"use client"

import { useMemo, useState } from "react"
import { MapPin, MessageCircle, Phone, Search, Truck, Users, X } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { DRIVER_STATUS_META, type MobileDriver } from "@/lib/logist-mobile/types"
import { formatDateShort, formatRelative, telHref, whatsappHref, formatCount } from "@/lib/logist-mobile/format"

const FILTERS = [
  { id: "all", label: "Все" },
  { id: "available", label: "Свободные" },
  { id: "busy", label: "В рейсе" },
  { id: "offline", label: "Не на связи" },
]

export default function LogistDriversPage() {
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<{ drivers: MobileDriver[] }>(
    user ? "/api/drivers" : null,
  )
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")

  const drivers = useMemo(() => {
    const list = data?.drivers ?? []
    const needle = query.trim().toLowerCase()
    return list
      .filter((driver) => (filter === "all" ? true : driver.status === filter))
      .filter((driver) => {
        if (!needle) return true
        return [driver.name, driver.phone, driver.vehiclePlate, driver.currentLocation]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      })
      .sort((a, b) => {
        // Сначала свободные — их можно назначить прямо сейчас
        const rank = (status: string) => (status === "available" ? 0 : status === "busy" ? 1 : 2)
        return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name)
      })
  }, [data, filter, query])

  return (
    <>
      <LogistHeader title="Водители" subtitle={`${data?.drivers?.length ?? 0} в организации`} userName={user?.name} />

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 border-b border-white/8 bg-[#0b0b0e]/95 px-4 pb-2.5 pt-3 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputMode="search"
            placeholder="Имя, телефон, машина"
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

        <div className="mt-2.5 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                filter === item.id
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
        ) : drivers.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="Никого не найдено" />
        ) : (
          drivers.map((driver) => {
            const meta = DRIVER_STATUS_META[driver.status] ?? DRIVER_STATUS_META.offline
            const tel = telHref(driver.phone)
            const wa = whatsappHref(driver.phone)
            const expirySoon =
              driver.medicalExpiry &&
              new Date(driver.medicalExpiry).getTime() - Date.now() < 30 * 86400000

            return (
              <div key={driver.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-white">{driver.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[13px]">
                      <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                      <span className={meta.text}>{meta.label}</span>
                      {driver.lastGpsUpdate ? (
                        <span className="text-zinc-600">· {formatRelative(driver.lastGpsUpdate)}</span>
                      ) : null}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-[12px] text-zinc-500">
                    {driver.ordersCompleted != null
                      ? formatCount(driver.ordersCompleted, ["рейс", "рейса", "рейсов"])
                      : ""}
                  </span>
                </div>

                <div className="mt-2.5 space-y-1.5 text-[13px] text-zinc-400">
                  {driver.vehiclePlate ? (
                    <p className="flex items-center gap-2">
                      <Truck className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      {driver.vehiclePlate}
                      {driver.vehicleType ? ` · ${driver.vehicleType}` : ""}
                    </p>
                  ) : null}
                  {driver.currentLocation ? (
                    <p className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <span className="truncate">{driver.currentLocation}</span>
                    </p>
                  ) : null}
                  {expirySoon ? (
                    <p className="text-amber-300">
                      Медосмотр истекает {formatDateShort(driver.medicalExpiry)}
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  {tel ? (
                    <a
                      href={tel}
                      className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-500/15 text-[13.5px] font-medium text-emerald-200 active:bg-emerald-500/25"
                    >
                      <Phone className="h-4 w-4" /> Позвонить
                    </a>
                  ) : (
                    <span className="flex min-h-[44px] items-center justify-center rounded-xl bg-white/5 text-[13px] text-zinc-600">
                      нет телефона
                    </span>
                  )}
                  {wa ? (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white/8 text-[13.5px] font-medium text-white active:bg-white/12"
                    >
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
