"use client"

// components/fuel/fuel-view.tsx
//
// Топливная ведомость: итоги за период, расход по машинам «факт против
// оценки» и книга чеков. Данные — GET /api/fuel (только своя организация).
// Отчёты показывают деньги по рейсам и машинам вообще; здесь — только топливо:
// литры, цена литра и отклонения от паспортного расхода.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataTable, type DataTableColumn } from "@/components/ui/data-table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TruckLoader } from "@/components/ui/truck-loader"
import { formatLocalDate } from "@/lib/dates"

interface FuelEntry {
  id: string
  spentAt: string
  liters: number | null
  amountRub: number | null
  pricePerL: number | null
  vendor: string | null
  source: string
  odometer: number | null
  routeId: string | null
  routeName: string | null
  driverName: string | null
  vehicleId: string | null
  vehiclePlate: string | null
}

interface FuelVehicle {
  vehicleId: string
  plate: string
  routes: number
  liters: number | null
  amountRub: number
  pricePerL: number | null
  estimatedL: number | null
  diffPct: number | null
  flag: boolean
}

interface FuelData {
  period: { days: number; since: string }
  totals: {
    count: number
    liters: number | null
    amountRub: number
    pricePerL: number | null
    flaggedVehicles: number
  }
  vehicles: FuelVehicle[]
  entries: FuelEntry[]
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

function liters(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  return `${Math.round(value * 10) / 10} л`
}

/** Отклонение факта от оценки: >20 % — красный бейдж (как на карточке рейса). */
function DiffBadge({ vehicle }: { vehicle: FuelVehicle }) {
  if (vehicle.diffPct === null) {
    return <span className="text-muted-foreground">нет оценки</span>
  }
  const sign = vehicle.diffPct > 0 ? "+" : ""
  const text = `${sign}${vehicle.diffPct} % к оценке`
  if (vehicle.flag) {
    return <Badge variant="destructive">{text}</Badge>
  }
  return <Badge variant="secondary">{text}</Badge>
}

const vehicleColumns: DataTableColumn<FuelVehicle>[] = [
  { key: "plate", label: "Машина", cell: (row) => <span className="font-medium">{row.plate}</span> },
  { key: "routes", label: "Рейсов", align: "right", cell: (row) => row.routes },
  { key: "liters", label: "Факт", align: "right", cellClassName: "font-medium", cell: (row) => liters(row.liters) },
  { key: "estimated", label: "Оценка", align: "right", cell: (row) => liters(row.estimatedL) },
  { key: "diff", label: "Отклонение", cell: (row) => <DiffBadge vehicle={row} /> },
  { key: "amount", label: "Сумма", align: "right", cell: (row) => money(row.amountRub) },
  { key: "price", label: "₽/л", align: "right", cell: (row) => (row.pricePerL !== null ? row.pricePerL.toFixed(1) : "—") },
]

const entryColumns: DataTableColumn<FuelEntry>[] = [
  { key: "date", label: "Дата", cell: (row) => formatLocalDate(row.spentAt) },
  { key: "vehicle", label: "Машина", cell: (row) => row.vehiclePlate ?? "—" },
  { key: "driver", label: "Водитель", cell: (row) => row.driverName ?? "—" },
  { key: "route", label: "Рейс", cell: (row) => row.routeName ?? "—" },
  { key: "liters", label: "Литры", align: "right", cellClassName: "font-medium", cell: (row) => liters(row.liters) },
  { key: "amount", label: "Сумма", align: "right", cell: (row) => money(row.amountRub) },
  { key: "price", label: "₽/л", align: "right", cell: (row) => (row.pricePerL !== null ? row.pricePerL.toFixed(1) : "—") },
  {
    key: "source",
    label: "Чек",
    cell: (row) =>
      row.source === "ocr" ? (
        <Badge variant="secondary">по фото</Badge>
      ) : (
        <Badge variant="outline">вручную</Badge>
      ),
  },
]

export function FuelView() {
  const [days, setDays] = useState("30")
  const [data, setData] = useState<FuelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/fuel?days=${days}`, { credentials: "include" })
      const json = await response.json()
      if (!response.ok || !json?.success) {
        setError(json?.error || "Не удалось загрузить ведомость")
        return
      }
      setData(json as FuelData)
    } catch {
      setError("Сервер недоступен")
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <TruckLoader className="text-primary" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
      </Card>
    )
  }

  const totals = data?.totals
  const kpis = [
    { label: "Чеков", value: totals ? String(totals.count) : "—" },
    { label: "Залито литров", value: totals ? liters(totals.liters) : "—" },
    { label: "Потрачено", value: totals ? money(totals.amountRub) : "—" },
    {
      label: "Средняя цена литра",
      value: totals && totals.pricePerL !== null ? `${totals.pricePerL.toFixed(1)} ₽` : "—",
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Период:</span>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 дней</SelectItem>
              <SelectItem value="30">30 дней</SelectItem>
              <SelectItem value="90">90 дней</SelectItem>
              <SelectItem value="365">Год</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {totals && totals.flaggedVehicles > 0 && (
          <Badge variant="destructive">
            Машин с отклонением расхода: {totals.flaggedVehicles}
          </Badge>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {kpi.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Расход по машинам</h2>
        <p className="text-sm text-muted-foreground">
          Факт — сумма чеков рейсов машины, оценка — паспортный расход с поправкой на загрузку.
          Отклонение больше 20 % помечено красным.
        </p>
        <DataTable
          columns={vehicleColumns}
          rows={data?.vehicles ?? []}
          rowKey={(row) => row.vehicleId}
          isLoading={loading}
          empty={
            <p className="p-6 text-center text-sm text-muted-foreground">
              За период нет рейсов с топливными чеками
            </p>
          }
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Книга чеков</h2>
        <DataTable
          columns={entryColumns}
          rows={data?.entries ?? []}
          rowKey={(row) => row.id}
          density="compact"
          isLoading={loading}
          empty={
            <p className="p-6 text-center text-sm text-muted-foreground">
              Топливных чеков за период нет
            </p>
          }
        />
      </div>
    </div>
  )
}
