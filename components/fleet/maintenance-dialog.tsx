"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Wrench, Calendar as CalendarIcon } from "lucide-react"
import type { Vehicle } from "@/lib/types"

interface MaintenanceDialogProps {
  vehicle: Vehicle | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const MAINTENANCE_TYPES = [
  { id: "scheduled", label: "Плановое ТО" },
  { id: "repair", label: "Ремонт" },
  { id: "oil_change", label: "Замена масла" },
  { id: "tire_change", label: "Замена шин" },
  { id: "inspection", label: "Осмотр" },
  { id: "other", label: "Другое" },
]

export function MaintenanceDialog({ vehicle, open, onOpenChange, onSuccess }: MaintenanceDialogProps) {
  const [loading, setLoading] = useState(false)
  
  // Поля
  const [type, setType] = useState("scheduled")
  const [description, setDescription] = useState("")
  const [mileage, setMileage] = useState("")
  const [cost, setCost] = useState("")
  const [performer, setPerformer] = useState("service")
  const [serviceName, setServiceName] = useState("")
  
  // Планирование
  const [isPlanned, setIsPlanned] = useState(false)
  const [plannedDate, setPlannedDate] = useState("")

  // Активный лог (для завершения)
  const [activeLog, setActiveLog] = useState<any>(null)

  useEffect(() => {
    if (open && vehicle) {
      // Сброс
      setType("scheduled")
      setDescription("")
      setMileage(vehicle.mileage ? vehicle.mileage.toString() : "")
      setCost("")
      setPerformer("service")
      setServiceName("")
      setIsPlanned(false)
      setPlannedDate("")
      setActiveLog(null)

      // Если машина на ТО, пробуем подгрузить активный лог
      if (vehicle.status === 'maintenance') {
        setLoading(true)
        fetch(`/api/m/maintenance?vehicleId=${vehicle.id}`)
          .then(res => res.json())
          .then(data => {
            if (data.success && data.maintenance) {
              setActiveLog(data.maintenance)
            }
          })
          .finally(() => setLoading(false))
      }
    }
  }, [open, vehicle])

  if (!vehicle) return null

  const isMaintenanceActive = vehicle.status === "maintenance"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (isMaintenanceActive && activeLog) {
        // Завершить
        const res = await fetch("/api/m/maintenance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            maintenanceId: activeLog.id,
            cost: cost ? parseInt(cost) : null,
          }),
        })
        if (!res.ok) throw new Error("Ошибка завершения")
        
      } else {
        // Начать или Запланировать
        const res = await fetch("/api/m/maintenance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId: vehicle.id,
            type,
            description,
            mileage: mileage ? parseInt(mileage) : null,
            cost: cost ? parseInt(cost) : null,
            performer,
            serviceName: performer === 'service' ? serviceName : null,
            status: isPlanned ? "planned" : "in_progress",
            plannedDate: isPlanned ? plannedDate : undefined
          }),
        })
        if (!res.ok) throw new Error("Ошибка создания")
      }

      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error(error)
      alert("Произошла ошибка при сохранении")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isMaintenanceActive ? "Завершение обслуживания" : "Отправка на ТО / Ремонт"}
          </DialogTitle>
        </DialogHeader>

        {isMaintenanceActive ? (
          // Форма завершения
          <form onSubmit={handleSubmit} className="space-y-4">
            {activeLog ? (
              <div className="p-4 bg-secondary/50 rounded-lg space-y-2 text-sm">
                <p><strong>Тип:</strong> {MAINTENANCE_TYPES.find(t=>t.id===activeLog.type)?.label}</p>
                <p><strong>Описание:</strong> {activeLog.description}</p>
                <p><strong>Начало:</strong> {new Date(activeLog.startedAt).toLocaleString("ru-RU")}</p>
              </div>
            ) : (
              <div className="flex justify-center"><Loader2 className="animate-spin" /></div>
            )}

            <div className="space-y-2">
              <Label>Итоговая стоимость (₽)</Label>
              <Input 
                type="number" 
                value={cost} 
                onChange={(e) => setCost(e.target.value)} 
                placeholder="Например: 15000"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Завершить обслуживание
              </Button>
            </DialogFooter>
          </form>
        ) : (
          // Форма создания
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center space-x-2 pb-2">
              <Checkbox id="planned" checked={isPlanned} onCheckedChange={(c) => setIsPlanned(!!c)} />
              <Label htmlFor="planned" className="cursor-pointer">Запланировать на будущее</Label>
            </div>

            {isPlanned && (
              <div className="space-y-2">
                <Label>Дата планируемого ТО</Label>
                <Input 
                  type="datetime-local" 
                  value={plannedDate} 
                  onChange={(e) => setPlannedDate(e.target.value)} 
                  required={isPlanned}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Тип работ</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAINTENANCE_TYPES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Пробег (км)</Label>
                <Input 
                  type="number" 
                  value={mileage} 
                  onChange={(e) => setMileage(e.target.value)} 
                  placeholder="150000"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Описание работ</Label>
              <Textarea 
                value={description} 
                onChange={(e) => setDescription(e.target.value)} 
                placeholder="Что нужно сделать..."
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Исполнитель</Label>
              <Tabs value={performer} onValueChange={setPerformer} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="service">Автосервис</TabsTrigger>
                  <TabsTrigger value="driver">Водитель</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {performer === "service" && (
              <div className="space-y-2">
                <Label>Название сервиса</Label>
                <Input 
                  value={serviceName} 
                  onChange={(e) => setServiceName(e.target.value)} 
                  placeholder="Например: Bosch Service"
                />
              </div>
            )}

            {!isPlanned && (
              <div className="space-y-2">
                <Label>Предварительная стоимость (₽)</Label>
                <Input 
                  type="number" 
                  value={cost} 
                  onChange={(e) => setCost(e.target.value)} 
                  placeholder="0"
                />
              </div>
            )}

            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isPlanned ? "Запланировать" : "Отправить на ТО"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}