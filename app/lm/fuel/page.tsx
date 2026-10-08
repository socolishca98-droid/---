// app/lm/fuel/page.tsx — топливо.
//
// Логисту важно видеть две вещи: сколько денег ушло на заправки и у какой машины
// расход выше паспортного (это повод разбираться). Запись чеков делают водители
// с телефона, поэтому экран читающий.

"use client"

import { useMemo, useState } from "react"
import { Fuel as FuelIcon, Receipt, TriangleAlert } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, EmptyState, ErrorState, KpiCard, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import type { MobileFuelEntry, MobileFuelVehicle } from "@/lib/logist-mobile/types"
import { formatDateShort, formatMoney } from "@/lib/logist-mobile/format"

interface FuelResponse {
  success: boolean
  period: { days: number; since: string }
  totals: { count: number; liters: number | null; amountRub: number; pricePerL: number | null; flaggedVehicles: number }
  vehicles: MobileFuelVehicle[]
  entries: MobileFuelEntry[]
}

const PERIODS = [
  { id: "7", label: "7 дней" },
  { id: "30", label: "30 дней" },
  { id: "90", label: "90 дней" },
]

function liters(value?: number | null): string {
  if (value === null || value === undefined) return "—"
  return `${Math.round(value).toLocaleString("ru-RU")} л`
}

function price(value?: number | null): string {
  if (value === null || value === undefined) return "—"
  return `${value.toFixed(1).replace(".", ",")} ₽/л`
}

export default function LogistFuelPage() {
  const { user } = useStaffSession()
  const [days, setDays] = useState("30")
  const { data, error, loading, reload } = useJsonApi<FuelResponse>(user ? `/api/fuel?days=${days}` : null)

  const totals = data?.totals
  const vehicles = useMemo(
    () => [...(data?.vehicles ?? [])].sort((a, b) => Number(b.flag) - Number(a.flag) || b.amountRub - a.amountRub),
    [data],
  )
  const entries = data?.entries ?? []

  return (
    <>
      <LogistHeader title="Топливо" subtitle={data ? `за ${data.period.days} дней` : undefined} back userName={user?.name} />

      <div className="px-4 pt-4">
        <div className="flex gap-2">
          {PERIODS.map((period) => (
            <button
              key={period.id}
              type="button"
              onClick={() => setDays(period.id)}
              className={`h-10 flex-1 rounded-xl border text-[13px] font-medium ${
                days === period.id
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card shadow-sm text-muted-foreground"
              }`}
            >
              {period.label}
            </button>
          ))}
        </div>

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !data ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <KpiCard label="Потрачено" value={formatMoney(totals?.amountRub ?? 0)} tone="warn" />
              <KpiCard label="Заправок" value={totals?.count ?? 0} hint={liters(totals?.liters)} />
              <KpiCard label="Средняя цена" value={price(totals?.pricePerL)} />
              <KpiCard
                label="Перерасход"
                value={totals?.flaggedVehicles ?? 0}
                hint="машин с расходом выше нормы"
                tone={totals?.flaggedVehicles ? "warn" : "default"}
              />
            </div>

            <SectionTitle title="По машинам" />
            {vehicles.length === 0 ? (
              <EmptyState
                icon={<FuelIcon className="h-6 w-6" />}
                title="Записей нет"
                description="Чеки на топливо вносят водители — здесь появятся итоги по машинам"
              />
            ) : (
              <div className="space-y-2.5">
                {vehicles.map((vehicle) => (
                  <Card key={vehicle.vehicleId} className={vehicle.flag ? "border-warning/25 bg-warning/10" : ""}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[15px] font-semibold text-foreground">{vehicle.plate}</p>
                      <p className="shrink-0 text-[14px] font-medium text-foreground">{formatMoney(vehicle.amountRub)}</p>
                    </div>
                    <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                      {[
                        `рейсов: ${vehicle.routes}`,
                        vehicle.liters !== null ? `факт ${liters(vehicle.liters)}` : null,
                        vehicle.estimatedL !== null ? `норма ${liters(vehicle.estimatedL)}` : null,
                        vehicle.pricePerL !== null ? price(vehicle.pricePerL) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {vehicle.flag ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-warning">
                        <TriangleAlert className="h-3.5 w-3.5" />
                        Расход выше нормы
                        {vehicle.diffPct !== null ? ` на ${Math.round(vehicle.diffPct)}%` : ""}
                      </p>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}

            <SectionTitle title="Чеки" />
            {entries.length === 0 ? (
              <EmptyState icon={<Receipt className="h-6 w-6" />} title="Чеков за период нет" />
            ) : (
              <div className="space-y-2.5">
                {entries.slice(0, 30).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card shadow-sm p-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] text-foreground">
                        {entry.vehiclePlate || "машина не указана"}
                        {entry.driverName ? ` · ${entry.driverName}` : ""}
                      </p>
                      <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                        {formatDateShort(entry.spentAt)}
                        {entry.vendor ? ` · ${entry.vendor}` : ""}
                        {entry.routeName ? ` · ${entry.routeName}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[14px] font-medium text-foreground">{formatMoney(entry.amountRub)}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {liters(entry.liters)}
                        {entry.pricePerL !== null ? ` · ${price(entry.pricePerL)}` : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
