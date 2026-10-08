// app/lm/fleet/page.tsx — автопарк и сроки обслуживания.
//
// Логисту важно не «какая машина какая», а что свободно, что в рейсе и у чего
// подходит срок ТО или страховки — иначе машину нельзя выпустить.

"use client"

import { useMemo, useState } from "react"
import { Fuel as FuelIcon, Phone, Settings2, Truck, Wrench } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, KpiCard, LinkRow, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import {
  DEADLINE_STATUS_META,
  VEHICLE_STATUS_META,
  type MobileDriver,
  type MobileFleetVehicle,
} from "@/lib/logist-mobile/types"
import { formatDateShort, formatMileage, telHref, formatCount } from "@/lib/logist-mobile/format"

interface Deadline {
  status: string
  daysLeft: number
  date: string
}

const TABS = [
  { id: "vehicles", label: "Машины" },
  { id: "service", label: "ТО и страховка" },
]

export default function LogistFleetPage() {
  const { user } = useStaffSession()
  const vehicles = useJsonApi<{ vehicles: MobileFleetVehicle[] }>(user ? "/api/vehicles" : null)
  const maintenance = useJsonApi<{
    totals: { vehicles: number; inMaintenance: number; expiredCount: number; soonCount: number }
    vehicles: MobileFleetVehicle[]
  }>(user ? "/api/maintenance" : null)
  const drivers = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)
  const [tab, setTab] = useState("vehicles")

  // Сроки ТО и страховки приходят из раздела обслуживания — сводим их к машинам
  const deadlinesByVehicle = useMemo(() => {
    const map = new Map<string, MobileFleetVehicle["deadlines"]>()
    for (const vehicle of maintenance.data?.vehicles ?? []) {
      map.set(vehicle.id, vehicle.deadlines ?? null)
    }
    return map
  }, [maintenance.data])

  const driverByPlate = useMemo(() => {
    const map = new Map<string, MobileDriver>()
    for (const driver of drivers.data?.drivers ?? []) {
      if (driver.vehiclePlate) map.set(driver.vehiclePlate, driver)
    }
    return map
  }, [drivers.data])

  const list = vehicles.data?.vehicles ?? []
  const loading = vehicles.loading || maintenance.loading
  const error = vehicles.error || maintenance.error

  const serviceRows = useMemo(() => {
    const rows: Array<{ vehicle: MobileFleetVehicle; kind: string; label: string; deadline: Deadline }> = []
    for (const vehicle of maintenance.data?.vehicles ?? []) {
      const deadlines = vehicle.deadlines ?? {}
      if (deadlines.maintenance) {
        rows.push({ vehicle, kind: "ТО", label: "Техобслуживание", deadline: deadlines.maintenance as Deadline })
      }
      if (deadlines.insurance) {
        rows.push({ vehicle, kind: "Страховка", label: "Страховка", deadline: deadlines.insurance as Deadline })
      }
    }
    return rows.sort((a, b) => a.deadline.daysLeft - b.deadline.daysLeft)
  }, [maintenance.data])

  return (
    <>
      <LogistHeader
        title="Автопарк"
        subtitle={list.length ? formatCount(list.length, ["машина", "машины", "машин"]) : undefined}
        userName={user?.name}
      />

      <div className="px-4 pt-4">
        {error ? (
          <ErrorState message={error} onRetry={() => { vehicles.reload(); maintenance.reload() }} />
        ) : loading && list.length === 0 ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <KpiCard
                label="Свободны"
                value={list.filter((vehicle) => vehicle.status === "available").length}
                tone="good"
              />
              <KpiCard label="В рейсе" value={list.filter((vehicle) => vehicle.status === "in_use").length} />
              <KpiCard
                label="На обслуживании"
                value={maintenance.data?.totals.inMaintenance ?? list.filter((v) => v.status === "maintenance").length}
                tone="warn"
              />
              <KpiCard
                label="Сроки подходят"
                value={maintenance.data?.totals.soonCount ?? 0}
                hint={maintenance.data?.totals.expiredCount ? `просрочено: ${maintenance.data.totals.expiredCount}` : undefined}
                tone={maintenance.data?.totals.soonCount ? "warn" : "default"}
              />
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03]">
              <LinkRow icon={<FuelIcon className="h-4.5 w-4.5" />} label="Топливо" href="/lm/fuel" />
              <LinkRow icon={<Settings2 className="h-4.5 w-4.5" />} label="Настройки" href="/lm/settings" />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-medium ${
                    tab === item.id
                      ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                      : "border-white/8 bg-white/[0.03] text-zinc-400"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="mt-3 space-y-2.5">
              {tab === "vehicles"
                ? list.map((vehicle) => {
                    const meta = VEHICLE_STATUS_META[vehicle.status] ?? VEHICLE_STATUS_META.offline
                    const driver = driverByPlate.get(vehicle.plate)
                    const tel = telHref(driver?.phone ?? null)
                    const maintenanceDeadline = deadlinesByVehicle.get(vehicle.id)?.maintenance

                    return (
                      <div key={vehicle.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-white">{vehicle.plate}</p>
                            <p className="mt-0.5 truncate text-[13px] text-zinc-400">
                              {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || vehicle.type || "—"}
                              {vehicle.year ? ` · ${vehicle.year}` : ""}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11.5px] ${meta.style}`}>
                            {meta.label}
                          </span>
                        </div>

                        <p className="mt-2 text-[12.5px] text-zinc-500">
                          {[
                            vehicle.type,
                            vehicle.capacity ? `до ${(vehicle.capacity / 1000).toFixed(1).replace(".0", "")} т` : null,
                            vehicle.volume ? `${vehicle.volume} м³` : null,
                            vehicle.mileage ? `пробег ${formatMileage(vehicle.mileage)}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>

                        {maintenanceDeadline ? (
                          <p className={`mt-1.5 text-[12.5px] ${DEADLINE_STATUS_META[maintenanceDeadline.status]?.style ?? "text-zinc-400"}`}>
                            ТО {formatDateShort(maintenanceDeadline.date)}
                            {maintenanceDeadline.daysLeft >= 0
                              ? ` · через ${maintenanceDeadline.daysLeft} дн.`
                              : ` · просрочено на ${Math.abs(maintenanceDeadline.daysLeft)} дн.`}
                          </p>
                        ) : null}

                        {driver ? (
                          <div className="mt-3 flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-400">
                              <Truck className="mr-1.5 inline h-3.5 w-3.5 text-zinc-500" />
                              {driver.name}
                            </span>
                            {tel ? (
                              <a
                                href={tel}
                                className="flex min-h-[40px] items-center gap-2 rounded-xl bg-emerald-500/15 px-3.5 text-[13px] font-medium text-emerald-200 active:bg-emerald-500/25"
                              >
                                <Phone className="h-4 w-4" /> Позвонить
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-2.5 text-[12.5px] text-zinc-600">Водитель не закреплён</p>
                        )}
                      </div>
                    )
                  })
                : serviceRows.length === 0
                  ? (
                      <EmptyState
                        icon={<Wrench className="h-6 w-6" />}
                        title="Сроков на ближайшее время нет"
                        description="Здесь появятся машины, у которых подходит ТО или страховка"
                      />
                    )
                  : serviceRows.map((row) => {
                      const meta = DEADLINE_STATUS_META[row.deadline.status] ?? DEADLINE_STATUS_META.ok
                      const late = row.deadline.daysLeft < 0
                      const soon = !late && row.deadline.daysLeft <= 14
                      return (
                        <div
                          key={`${row.vehicle.id}-${row.kind}`}
                          className={`rounded-2xl border p-4 ${
                            late ? "border-red-500/25 bg-red-500/[0.06]" : soon ? "border-amber-500/25 bg-amber-500/[0.06]" : "border-white/8 bg-white/[0.03]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[15px] font-semibold text-white">{row.vehicle.plate}</p>
                              <p className="mt-0.5 text-[13px] text-zinc-400">
                                {row.label} · {formatDateShort(row.deadline.date)}
                              </p>
                            </div>
                            <span className={`shrink-0 text-[13px] font-medium ${meta.style}`}>
                              {late
                                ? `просрочено на ${Math.abs(row.deadline.daysLeft)} дн.`
                                : `через ${row.deadline.daysLeft} дн.`}
                            </span>
                          </div>
                        </div>
                      )
                    })}
            </div>
          </>
        )}
      </div>
    </>
  )
}
