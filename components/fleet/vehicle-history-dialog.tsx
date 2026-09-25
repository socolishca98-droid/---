"use client"

// components/fleet/vehicle-history-dialog.tsx
//
// История назначений водителей на машину (задача 4).
//
// Показывает последние рейсы машины: кто был за рулём, когда выехал и вернулся,
// какой был рейс. Данные приходят из GET /api/fleet/insights (блок history) —
// отдельный запрос на каждую карточку не нужен.

import { History, User } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type VehicleAssignment = {
  routeId: string
  routeName: string | null
  driverId: string | null
  driverName: string | null
  startedAt: string | null
  completedAt: string | null
  status: string
  isActive: boolean
}

const ROUTE_STATUS_LABELS: Record<string, string> = {
  planned: "Запланирован",
  active: "В работе",
  completed: "Завершён",
  cancelled: "Отменён",
}

function formatDay(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

interface VehicleHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  plate: string
  assignments: VehicleAssignment[]
  /** Кто закреплён за машиной сейчас (Driver.vehicleId). */
  currentDriverName: string | null
}

export function VehicleHistoryDialog({
  open,
  onOpenChange,
  plate,
  assignments,
  currentDriverName,
}: VehicleHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            История машины {plate}
          </DialogTitle>
          <DialogDescription>
            Последние рейсы и водители, которые были за рулём.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-3 text-sm">
            <span className="text-muted-foreground">Закреплён сейчас: </span>
            {currentDriverName ? (
              <span className="font-medium">{currentDriverName}</span>
            ) : (
              <span className="text-muted-foreground">никто</span>
            )}
          </div>

          {assignments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Машина ещё не выходила в рейс.
            </p>
          ) : (
            <ol className="space-y-3">
              {assignments.map((item) => (
                <li key={item.routeId} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        {item.driverName || "Водитель не указан"}
                        {item.isActive ? (
                          <Badge variant="secondary" className="text-[10px]">
                            сейчас
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.routeName || "Рейс без названия"}
                      </div>
                    </div>

                    <div className="text-right text-xs text-muted-foreground">
                      <div>{ROUTE_STATUS_LABELS[item.status] || item.status}</div>
                      <div className="mt-1">
                        {formatDay(item.startedAt) || formatDay(item.completedAt) || "дата не задана"}
                        {item.completedAt && item.startedAt ? ` — ${formatDay(item.completedAt)}` : ""}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
