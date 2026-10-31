// app/lm/fleet/page.tsx — автопарк и сроки обслуживания.
//
// Логисту важно не «какая машина какая», а что свободно, что в рейсе и у чего
// подходит срок ТО или страховки — иначе машину нельзя выпустить.

"use client"

import { useMemo, useState } from "react"
import { Fuel as FuelIcon, Pencil, Phone, Plus, Settings2, Truck, Wrench } from "lucide-react"
import { toast } from "sonner"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { EmptyState, ErrorState, KpiCard, LinkRow, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { RepairForm, type RepairFormVehicle } from "@/components/maintenance/repair-form"
import { AddVehicleDialog, type VehicleFormData } from "@/components/fleet/add-vehicle-dialog"
import { useStaffSession } from "@/hooks/use-staff-session"
import {
  DEADLINE_STATUS_META,
  VEHICLE_STATUS_META,
  type MobileDriver,
  type MobileFleetVehicle,
} from "@/lib/logist-mobile/types"
import { formatDateShort, formatMileage, telHref, formatCount } from "@/lib/logist-mobile/format"
import { vehicleFeatureLabels } from "@/lib/fleet/vehicle-features"

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
  const [repairOpen, setRepairOpen] = useState(false)
  // Машина, которую правим: null — заводим новую
  const [vehicleDialogOpen, setVehicleDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MobileFleetVehicle | null>(null)

  /** Создание и правка машины: POST — новая, PATCH — существующая. */
  const saveVehicle = async (data: VehicleFormData) => {
    const editingId = editing?.id
    try {
      const res = await fetch(editingId ? `/api/vehicles/${editingId}` : "/api/vehicles", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok || !result?.success) {
        throw new Error(result?.error || "Не удалось сохранить машину")
      }
      setVehicleDialogOpen(false)
      setEditing(null)
      vehicles.reload()
      maintenance.reload()
      toast.success(editingId ? "Изменения сохранены" : "Машина добавлена")
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "Не удалось сохранить машину")
    }
  }

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

            <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <LinkRow icon={<FuelIcon className="h-4.5 w-4.5" />} label="Топливо" href="/lm/fuel" />
              <LinkRow icon={<Settings2 className="h-4.5 w-4.5" />} label="Настройки" href="/lm/settings" />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {TABS.map((item) => (
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
                  {item.label}
                </button>
              ))}
            </div>

            {tab === "vehicles" ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setVehicleDialogOpen(true)
                }}
                className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-medium text-primary-foreground active:opacity-70"
              >
                <Plus className="h-4 w-4" /> Добавить машину
              </button>
            ) : null}

            {tab === "service" ? (
              <button
                type="button"
                onClick={() => setRepairOpen(true)}
                className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-medium text-primary-foreground active:opacity-70"
              >
                <Wrench className="h-4 w-4" /> Записать ремонт
              </button>
            ) : null}

            <div className="mt-3 space-y-2.5">
              {tab === "vehicles"
                ? list.map((vehicle) => {
                    const meta = VEHICLE_STATUS_META[vehicle.status] ?? VEHICLE_STATUS_META.offline
                    const driver = driverByPlate.get(vehicle.plate)
                    const tel = telHref(driver?.phone ?? null)
                    const maintenanceDeadline = deadlinesByVehicle.get(vehicle.id)?.maintenance

                    return (
                      <div key={vehicle.id} className="rounded-xl border border-border bg-card shadow-sm p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-foreground">{vehicle.plate}</p>
                            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                              {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || vehicle.type || "—"}
                              {vehicle.year ? ` · ${vehicle.year}` : ""}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11.5px] ${meta.style}`}>
                            {meta.label}
                          </span>
                        </div>

                        <p className="mt-2 text-[12.5px] text-muted-foreground">
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
                          <p className={`mt-1.5 text-[12.5px] ${DEADLINE_STATUS_META[maintenanceDeadline.status]?.style ?? "text-muted-foreground"}`}>
                            ТО {formatDateShort(maintenanceDeadline.date)}
                            {maintenanceDeadline.daysLeft >= 0
                              ? ` · через ${maintenanceDeadline.daysLeft} дн.`
                              : ` · просрочено на ${Math.abs(maintenanceDeadline.daysLeft)} дн.`}
                          </p>
                        ) : null}

                        {vehicleFeatureLabels(vehicle.features).length ? (
                          <p className="mt-1 text-[12.5px] text-muted-foreground">
                            {vehicleFeatureLabels(vehicle.features).join(" · ")}
                          </p>
                        ) : null}

                        {driver ? (
                          <div className="mt-3 flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                              <Truck className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />
                              {driver.name}
                            </span>
                            {tel ? (
                              <a
                                href={tel}
                                className="flex min-h-[40px] items-center gap-2 rounded-xl bg-success/15 px-3.5 text-[13px] font-medium text-success active:opacity-70"
                              >
                                <Phone className="h-4 w-4" /> Позвонить
                              </a>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-2.5 text-[12.5px] text-muted-foreground/80">Водитель не закреплён</p>
                        )}

                        {/* Сняли доп. оборудование или поменяли тоннаж — правим
                            карточку, а не заводим машину заново: иначе пропадут
                            история рейсов, ТО и документы */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(vehicle)
                            setVehicleDialogOpen(true)
                          }}
                          className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-border text-[13px] font-medium text-foreground active:opacity-70"
                        >
                          <Pencil className="h-4 w-4" /> Изменить машину
                        </button>
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
                          className={`rounded-xl border p-4 ${
                            late ? "border-destructive/25 bg-destructive/[0.06]" : soon ? "border-warning/40 bg-warning/10" : "border-border bg-card shadow-sm"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[15px] font-semibold text-foreground">{row.vehicle.plate}</p>
                              <p className="mt-0.5 text-[13px] text-muted-foreground">
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

        <AddVehicleDialog
          open={vehicleDialogOpen}
          onOpenChange={(open) => {
            setVehicleDialogOpen(open)
            if (!open) setEditing(null)
          }}
          vehicle={editing}
          onSubmit={saveVehicle}
        />

        <RepairForm
          open={repairOpen}
          onOpenChange={setRepairOpen}
          vehicles={(vehicles.data?.vehicles ?? []).map((vehicle) => ({
            id: vehicle.id,
            plate: vehicle.plate,
          })) as RepairFormVehicle[]}
          onSaved={() => vehicles.reload()}
        />
      </div>
    </>
  )
}
