"use client"

// components/maintenance/maintenance-view.tsx
//
// Обслуживание и документы машин: сроки ТО / страховки / техосмотра и журнал
// работ. Данные — GET /api/maintenance (только своя организация). В автопарке
// история машины спрятана в диалоге карточки; здесь — сводная картина по парку:
// что просрочено, что подойдёт в ближайший месяц и сколько стоят ремонты.

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DataTable, type DataTableColumn } from "@/components/ui/data-table"
import { TruckLoader } from "@/components/ui/truck-loader"
import { formatLocalDate } from "@/lib/dates"

interface Deadline {
  status: "expired" | "soon" | "ok"
  daysLeft: number
  date: string
}

interface MaintenanceVehicle {
  id: string
  plate: string
  brand: string | null
  model: string | null
  year: number | null
  mileage: number | null
  status: string
  lastMaintenanceDate: string | null
  deadlines: {
    maintenance: Deadline | null
    insurance: Deadline | null
    inspection: Deadline | null
    worst: Deadline["status"] | null
  }
}

interface MaintenanceLogRow {
  id: string
  type: string
  description: string
  mileage: number | null
  costRub: number | null
  performer: string
  serviceName: string | null
  status: string
  startedAt: string
  completedAt: string | null
  vehicleId: string | null
  vehiclePlate: string | null
  driverName: string | null
}

interface MaintenanceData {
  now: string
  totals: {
    vehicles: number
    inMaintenance: number
    expiredCount: number
    soonCount: number
    count: number
    inProgress: number
    costRub: number
  }
  vehicles: MaintenanceVehicle[]
  logs: MaintenanceLogRow[]
}

// Те же подписи типов, что в диалоге обслуживания автопарка
const TYPE_LABELS: Record<string, string> = {
  scheduled: "Плановое ТО",
  repair: "Ремонт",
  oil_change: "Замена масла",
  tire_change: "Замена шин",
  inspection: "Осмотр",
  other: "Другое",
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—"
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

function DeadlineCell({ deadline }: { deadline: Deadline | null }) {
  if (!deadline) return <span className="text-muted-foreground">не задан</span>
  if (deadline.status === "expired") {
    return (
      <Badge variant="destructive">
        просрочено на {Math.abs(deadline.daysLeft)} дн.
      </Badge>
    )
  }
  if (deadline.status === "soon") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      >
        через {deadline.daysLeft} дн. · {formatLocalDate(deadline.date)}
      </Badge>
    )
  }
  return <span className="text-muted-foreground">{formatLocalDate(deadline.date)}</span>
}

const VEHICLE_STATUS_LABELS: Record<string, string> = {
  available: "свободна",
  in_use: "в рейсе",
  maintenance: "в ремонте",
}

const vehicleColumns: DataTableColumn<MaintenanceVehicle>[] = [
  {
    key: "plate",
    label: "Машина",
    cell: (row) => (
      <div>
        <p className="font-medium">{row.plate}</p>
        <p className="text-xs text-muted-foreground">
          {[row.brand, row.model, row.year].filter(Boolean).join(" ") || "—"}
        </p>
      </div>
    ),
  },
  {
    key: "status",
    label: "Статус",
    cell: (row) =>
      row.status === "maintenance" ? (
        <Badge variant="destructive">в ремонте</Badge>
      ) : (
        <Badge variant="secondary">{VEHICLE_STATUS_LABELS[row.status] ?? row.status}</Badge>
      ),
  },
  {
    key: "mileage",
    label: "Пробег",
    align: "right",
    cell: (row) => (row.mileage !== null ? `${row.mileage.toLocaleString("ru-RU")} км` : "—"),
  },
  {
    key: "maintenance",
    label: "След. ТО",
    cell: (row) => <DeadlineCell deadline={row.deadlines.maintenance} />,
  },
  {
    key: "insurance",
    label: "Страховка",
    cell: (row) => <DeadlineCell deadline={row.deadlines.insurance} />,
  },
  {
    key: "inspection",
    label: "Техосмотр",
    cell: (row) => <DeadlineCell deadline={row.deadlines.inspection} />,
  },
]

const logColumns: DataTableColumn<MaintenanceLogRow>[] = [
  { key: "date", label: "Дата", cell: (row) => formatLocalDate(row.startedAt) },
  { key: "vehicle", label: "Машина", cell: (row) => row.vehiclePlate ?? "—" },
  { key: "type", label: "Тип", cell: (row) => TYPE_LABELS[row.type] ?? row.type },
  {
    key: "description",
    label: "Описание",
    cell: (row) => (
      <span className="line-clamp-2 max-w-md text-muted-foreground">{row.description}</span>
    ),
  },
  {
    key: "performer",
    label: "Кто делал",
    cell: (row) =>
      row.performer === "service" ? (
        <span>{row.serviceName ? `Сервис: ${row.serviceName}` : "Автосервис"}</span>
      ) : (
        <span>{row.driverName ? `Водитель: ${row.driverName}` : "Водитель"}</span>
      ),
  },
  {
    key: "status",
    label: "Статус",
    cell: (row) =>
      row.status === "in_progress" ? (
        <Badge variant="secondary">в работе</Badge>
      ) : (
        <Badge variant="outline">завершено</Badge>
      ),
  },
  {
    key: "cost",
    label: "Стоимость",
    align: "right",
    cellClassName: "font-medium",
    cell: (row) => money(row.costRub),
  },
]

export function MaintenanceView() {
  const [data, setData] = useState<MaintenanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/maintenance", { credentials: "include" })
      const json = await response.json()
      if (!response.ok || !json?.success) {
        setError(json?.error || "Не удалось загрузить обслуживание")
        return
      }
      setData(json as MaintenanceData)
    } catch {
      setError("Сервер недоступен")
    } finally {
      setLoading(false)
    }
  }, [])

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
    {
      label: "Просрочено сроков",
      value: totals ? String(totals.expiredCount) : "—",
      alert: (totals?.expiredCount ?? 0) > 0,
    },
    { label: "Подойдёт в месяц", value: totals ? String(totals.soonCount) : "—" },
    { label: "Машин в ремонте", value: totals ? String(totals.inMaintenance) : "—" },
    { label: "Расходы на работы", value: totals ? money(totals.costRub) : "—" },
  ]

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {kpi.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={
                  "text-2xl font-bold tabular-nums" + ("alert" in kpi && kpi.alert ? " text-destructive" : "")
                }
              >
                {kpi.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Сроки по машинам</h2>
        <p className="text-sm text-muted-foreground">
          Сначала машины с проблемами: просроченные документы и ТО, затем ближайшие 30 дней.
        </p>
        <DataTable
          columns={vehicleColumns}
          rows={data?.vehicles ?? []}
          rowKey={(row) => row.id}
          isLoading={loading}
          empty={
            <p className="p-6 text-center text-sm text-muted-foreground">В парке нет машин</p>
          }
        />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Журнал работ</h2>
        <DataTable
          columns={logColumns}
          rows={data?.logs ?? []}
          rowKey={(row) => row.id}
          density="compact"
          isLoading={loading}
          empty={
            <p className="p-6 text-center text-sm text-muted-foreground">
              Записей об обслуживании пока нет
            </p>
          }
        />
      </div>
    </div>
  )
}
