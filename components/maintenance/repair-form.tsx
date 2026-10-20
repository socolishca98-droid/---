"use client"

// components/maintenance/repair-form.tsx
//
// Форма «Записать ремонт» — один общий компонент: он же стоит в разделе
// «ТО и страховка» (components/maintenance/maintenance-view.tsx) и открывается
// с вкладки «ТО и страховка» в кабинете логиста (/lm/fleet). Данные уходят
// в POST /api/maintenance: организация берётся из сессии, архивные машины
// сервер не принимает.

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  MAINTENANCE_TYPES,
  MAINTENANCE_TYPE_LABELS,
  type MaintenanceType,
} from "@/lib/maintenance/schedule"

export interface RepairFormVehicle {
  id: string
  plate: string
}

interface RepairFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vehicles: RepairFormVehicle[]
  onSaved?: () => void
}

export function RepairForm({ open, onOpenChange, vehicles, onSaved }: RepairFormProps) {
  const [vehicleId, setVehicleId] = useState("")
  const [type, setType] = useState<MaintenanceType>("repair")
  const [description, setDescription] = useState("")
  const [mileage, setMileage] = useState("")
  const [cost, setCost] = useState("")
  const [serviceName, setServiceName] = useState("")
  const [workOrderNumber, setWorkOrderNumber] = useState("")
  const [startedAt, setStartedAt] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // Дата по умолчанию — сегодня (локальная дата, без времени).
    const now = new Date()
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    setStartedAt(iso)
    setError(null)
  }, [open])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!vehicleId) {
      setError("Выберите машину")
      return
    }
    if (description.trim().length < 3) {
      setError("Опишите работу — хотя бы пару слов")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId,
          type,
          description: description.trim(),
          ...(mileage ? { mileage: Number(mileage) } : {}),
          ...(cost ? { cost: Number(cost) } : {}),
          ...(serviceName.trim() ? { serviceName: serviceName.trim() } : {}),
          ...(workOrderNumber.trim() ? { workOrderNumber: workOrderNumber.trim() } : {}),
          ...(startedAt ? { startedAt } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        setError(json?.error || "Не удалось записать работу")
        setBusy(false)
        return
      }
      setBusy(false)
      onOpenChange(false)
      setDescription("")
      setMileage("")
      setCost("")
      setServiceName("")
      setWorkOrderNumber("")
      onSaved?.()
    } catch {
      setError("Нет соединения — попробуйте ещё раз")
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Записать ремонт</DialogTitle>
          <DialogDescription>
            Работа попадёт в журнал ремонтов: её видно в разделе обслуживания и в
            сводке «Потрачено на ремонты». Машину из архива записать нельзя.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-sm font-medium">Машина</label>
            <select
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— выберите машину —</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plate}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Вид работы</label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {MAINTENANCE_TYPES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setType(item)}
                  className={`h-8 rounded-md border px-2.5 text-[12.5px] font-medium ${
                    type === item
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-background text-muted-foreground"
                  }`}
                >
                  {MAINTENANCE_TYPE_LABELS[item]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Что делали</label>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Например: замена масла и фильтра"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Дата</label>
              <Input
                type="date"
                value={startedAt}
                onChange={(event) => setStartedAt(event.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Пробег, км</label>
              <Input
                inputMode="numeric"
                value={mileage}
                onChange={(event) => setMileage(event.target.value.replace(/[^\d]/g, ""))}
                placeholder="необязательно"
                className="mt-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Стоимость, ₽</label>
              <Input
                inputMode="decimal"
                value={cost}
                onChange={(event) => setCost(event.target.value.replace(",", "."))}
                placeholder="необязательно"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Автосервис</label>
              <Input
                value={serviceName}
                onChange={(event) => setServiceName(event.target.value)}
                placeholder="необязательно"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Номер заказ-наряда</label>
            <Input
              value={workOrderNumber}
              onChange={(event) => setWorkOrderNumber(event.target.value)}
              placeholder="необязательно — по бумаге будет проще найти"
              className="mt-1"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Записываю…" : "Записать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
