// components/fleet/add-vehicle-dialog.tsx

"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2 } from "lucide-react"

// Локальное определение типа (в lib/types его нет)
type VehicleFeature = "tent" | "refrigerator" | "top_loading" | "side_loading" | "tail_lift" | "gps" | "adr"

interface AddVehicleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit?: (data: VehicleFormData) => Promise<void>
}

interface VehicleFormData {
  plate: string
  type: string
  brand: string
  model: string
  year: string
  capacity: string
  volume: string
  length: string
  width: string
  height: string
  features: VehicleFeature[]
}

const vehicleTypes = ["Фура", "Газель", "Рефрижератор", "Бортовая", "Тент", "Изотерм"]

const featureOptions: { id: VehicleFeature; label: string }[] = [
  { id: "tent", label: "Тент" },
  { id: "refrigerator", label: "Рефрижератор" },
  { id: "top_loading", label: "Верхняя загрузка" },
  { id: "side_loading", label: "Боковая загрузка" },
  { id: "tail_lift", label: "Гидроборт" },
  { id: "gps", label: "GPS-трекер" },
  { id: "adr", label: "ADR (опасные грузы)" },
]

const initialFormData: VehicleFormData = {
  plate: "",
  type: "",
  brand: "",
  model: "",
  year: "",
  capacity: "",
  volume: "",
  length: "",
  width: "",
  height: "",
  features: [],
}

export function AddVehicleDialog({ open, onOpenChange, onSubmit }: AddVehicleDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<VehicleFormData>(initialFormData)

  // Сброс формы при открытии
  useEffect(() => {
    if (open) {
      setFormData(initialFormData)
    }
  }, [open])

  const handleFeatureToggle = (feature: VehicleFeature) => {
    setFormData((prev) => ({
      ...prev,
      features: prev.features.includes(feature)
        ? prev.features.filter((f: any) => f !== feature)
        : [...prev.features, feature],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!onSubmit) {
      onOpenChange(false)
      return
    }
    
    setIsSubmitting(true)
    try {
      await onSubmit(formData)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Добавить транспорт</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Основное */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="plate">Гос. номер *</Label>
              <Input
                id="plate"
                placeholder="А123БВ777"
                value={formData.plate}
                onChange={(e) => setFormData({ ...formData, plate: e.target.value.toUpperCase() })}
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Тип ТС *</Label>
              <Select 
                value={formData.type} 
                onValueChange={(v) => setFormData({ ...formData, type: v })}
                disabled={isSubmitting}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите тип" />
                </SelectTrigger>
                <SelectContent>
                  {vehicleTypes.map((type: any) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand">Марка</Label>
              <Input
                id="brand"
                placeholder="MAN"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Модель</Label>
              <Input
                id="model"
                placeholder="TGX 18.440"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="year">Год</Label>
              <Input
                id="year"
                type="number"
                placeholder="2020"
                min="1990"
                max="2030"
                value={formData.year}
                onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Размеры */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Грузоподъёмность и размеры</Label>
            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label htmlFor="capacity" className="text-xs text-muted-foreground">
                  Грузоп. (кг) *
                </Label>
                <Input
                  id="capacity"
                  type="number"
                  placeholder="20000"
                  value={formData.capacity}
                  onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
                  required
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="volume" className="text-xs text-muted-foreground">
                  Объём (м³)
                </Label>
                <Input
                  id="volume"
                  type="number"
                  placeholder="96"
                  value={formData.volume}
                  onChange={(e) => setFormData({ ...formData, volume: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="length" className="text-xs text-muted-foreground">
                  Длина (м)
                </Label>
                <Input
                  id="length"
                  type="number"
                  step="0.1"
                  placeholder="13.6"
                  value={formData.length}
                  onChange={(e) => setFormData({ ...formData, length: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="height" className="text-xs text-muted-foreground">
                  Высота (м)
                </Label>
                <Input
                  id="height"
                  type="number"
                  step="0.1"
                  placeholder="2.7"
                  value={formData.height}
                  onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>

          {/* Особенности */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Особенности</Label>
            <div className="grid grid-cols-2 gap-2">
              {featureOptions.map(({ id, label }) => (
                <label 
                  key={id} 
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/50 cursor-pointer"
                >
                  <Checkbox 
                    checked={formData.features.includes(id)} 
                    onCheckedChange={() => handleFeatureToggle(id)}
                    disabled={isSubmitting}
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting || !formData.type || !formData.plate || !formData.capacity}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}