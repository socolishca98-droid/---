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

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 border-b border-border surface-glass px-4 pb-2.5 pt-3 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputMode="search"
            placeholder="Имя, телефон, машина"
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

        <div className="mt-2.5 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-md border px-3 py-1.5 text-[13px] font-medium ${
                filter === item.id
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card shadow-sm text-muted-foreground"
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
              <div key={driver.id} className="rounded-xl border border-border bg-card shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-foreground">{driver.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[13px]">
                      <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                      <span className={meta.text}>{meta.label}</span>
                      {driver.lastGpsUpdate ? (
                        <span className="text-muted-foreground/80">· {formatRelative(driver.lastGpsUpdate)}</span>
                      ) : null}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-[12px] text-muted-foreground">
                    {driver.ordersCompleted != null
                      ? formatCount(driver.ordersCompleted, ["рейс", "рейса", "рейсов"])
                      : ""}
                  </span>
                </div>

                <div className="mt-2.5 space-y-1.5 text-[13px] text-muted-foreground">
                  {driver.vehiclePlate ? (
                    <p className="flex items-center gap-2">
                      <Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {driver.vehiclePlate}
                      {driver.vehicleType ? ` · ${driver.vehicleType}` : ""}
                    </p>
                  ) : null}
                  {driver.currentLocation ? (
                    <p className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{driver.currentLocation}</span>
                    </p>
                  ) : null}
                  {expirySoon ? (
                    <p className="text-warning">
                      Медосмотр истекает {formatDateShort(driver.medicalExpiry)}
                    </p>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  {tel ? (
                    <a
                      href={tel}
                      className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-success/15 text-[13.5px] font-medium text-success active:opacity-70"
                    >
                      <Phone className="h-4 w-4" /> Позвонить
                    </a>
                  ) : (
                    <span className="flex min-h-[44px] items-center justify-center rounded-xl bg-secondary text-[13px] text-muted-foreground/80">
                      нет телефона
                    </span>
                  )}
                  {wa ? (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-secondary text-[13.5px] font-medium text-foreground active:opacity-70"
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
