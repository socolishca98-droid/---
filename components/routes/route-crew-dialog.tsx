"use client"

// components/routes/route-crew-dialog.tsx
//
// Назначение машины и водителя на рейс (задача 3, пункт 3).
//
// API это умел и раньше (PATCH /api/routes/[routeId] принимает driverId и
// vehicleId), но в интерфейсе назначить экипаж на уже собранный рейс было
// негде: рейс собирался в песочнице вместе с машиной, и поменять её потом
// можно было только через API.
//
// Сохранение делает PATCH, поэтому работают те же проверки, что и в остальном
// проекте: машина из своей организации, грузоподъёмность, занятость машины
// другим водителем, единая связь «водитель ↔ машина».

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Truck, User } from "lucide-react"
import { toast } from "sonner"

type DriverOption = {
  id: string
  name: string
  status: string
  vehicleId: string | null
  vehicle: { id: string; plate: string; type: string } | null
}

type VehicleOption = {
  id: string
  plate: string
  type: string
  capacity: number
  status: string
  driver: { id: string; name: string } | null
}

interface RouteCrewDialogProps {
  routeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  currentDriverId: string | null
  currentVehicleId: string | null
  /** Вызывается после успешного сохранения — карточка перечитывает данные. */
  onAssigned: () => void
}

/** Значение «не назначен» в Select: пустая строка как значение Radix не годится. */
const NONE = "__none__"

export function RouteCrewDialog({
  routeId,
  open,
  onOpenChange,
  currentDriverId,
  currentVehicleId,
  onAssigned,
}: RouteCrewDialogProps) {
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [driverId, setDriverId] = useState<string>(currentDriverId || NONE)
  const [vehicleId, setVehicleId] = useState<string>(currentVehicleId || NONE)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/fleet")
      const data = await res.json()

      if (!data?.success) {
        throw new Error(data?.error || "Не удалось загрузить автопарк")
      }

      setDrivers(data.drivers || [])
      setVehicles(data.vehicles || [])
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить автопарк")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setDriverId(currentDriverId || NONE)
    setVehicleId(currentVehicleId || NONE)
    void load()
  }, [open, currentDriverId, currentVehicleId, load])

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/routes/${routeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: driverId === NONE ? null : driverId,
          vehicleId: vehicleId === NONE ? null : vehicleId,
        }),
      })

      const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось сохранить экипаж")
      }

      toast.success("Экипаж обновлён", {
        description: "Водитель увидит рейс в мобильном приложении",
      })
      onAssigned()
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить экипаж")
    } finally {
      setIsSaving(false)
    }
  }

  const availableVehicles = vehicles.filter((vehicle) => vehicle.status !== "maintenance")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Машина и водитель рейса
          </DialogTitle>
          <DialogDescription>
            Рейс уходит водителю в мобильное приложение: он увидит точки по порядку
            объезда и получит уведомление о назначении.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Загружаю автопарк…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <User className="h-3.5 w-3.5" />
                Водитель
              </label>
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger>
                  <SelectValue placeholder="Не назначен" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Не назначен</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name}
                      {driver.vehicle ? ` · ${driver.vehicle.plate}` : ""}
                      
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Truck className="h-3.5 w-3.5" />
                Машина
              </label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Не назначена" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Не назначена</SelectItem>
                  {availableVehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate} · {vehicle.type} · {(vehicle.capacity / 1000).toFixed(1)}т
                      {vehicle.driver ? ` · закреплена за ${vehicle.driver.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Отмена
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Сохранить
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
