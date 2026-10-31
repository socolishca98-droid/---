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

import {
  VEHICLE_FEATURES,
  customVehicleFeatures,
  featuresForSave,
  parseVehicleFeatures,
  type VehicleFeatureId,
} from "@/lib/fleet/vehicle-features"

// Локальное определение типа (в lib/types его нет)
type VehicleFeature = VehicleFeatureId

/** Машина, которую редактируем. null/undefined — режим создания. */
export interface EditableVehicle {
  id: string
  plate?: string | null
  type?: string | null
  brand?: string | null
  model?: string | null
  year?: number | string | null
  capacity?: number | string | null
  volume?: number | string | null
  length?: number | string | null
  width?: number | string | null
  height?: number | string | null
  features?: unknown
  fuelTankL?: number | string | null
  fuelConsumptionPer100?: number | string | null
  fuelLevelL?: number | string | null
}

interface AddVehicleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit?: (data: VehicleFormData) => Promise<void>
  /** Если передана машина — диалог правит её, а не заводит новую. */
  vehicle?: EditableVehicle | null
}

export interface VehicleFormData {
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
  fuelTankL: string
  fuelConsumptionPer100: string
  fuelLevelL: string
}

const vehicleTypes = ["Фура", "Газель", "Рефрижератор", "Бортовая", "Тент", "Изотерм"]

// Галочки особенностей — из общего модуля, чтобы форма и карточка читали
// оборудование одинаково.
const featureOptions: { id: VehicleFeature; label: string }[] = VEHICLE_FEATURES

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
  fuelTankL: "",
  fuelConsumptionPer100: "",
  fuelLevelL: "",
}

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value)

export function AddVehicleDialog({
  open,
  onOpenChange,
  onSubmit,
  vehicle = null,
}: AddVehicleDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<VehicleFormData>(initialFormData)
  // Особенности, которых нет среди галочек формы (термограф, коники, кран-балка).
  // Их нельзя терять при сохранении: логист правит тоннаж, а не снимает
  // оборудование, которое ему даже не показали.
  const [preservedFeatures, setPreservedFeatures] = useState<string[]>([])
  const editing = Boolean(vehicle?.id)

  // При открытии: пустая форма для новой машины, заполненная — для правки
  useEffect(() => {
    if (!open) return
    if (!vehicle) {
      setFormData(initialFormData)
      setPreservedFeatures([])
      return
    }
    setPreservedFeatures(customVehicleFeatures(vehicle.features))
    setFormData({
      plate: text(vehicle.plate).toUpperCase(),
      type: text(vehicle.type),
      brand: text(vehicle.brand),
      model: text(vehicle.model),
      year: text(vehicle.year),
      capacity: text(vehicle.capacity),
      volume: text(vehicle.volume),
      length: text(vehicle.length),
      width: text(vehicle.width),
      height: text(vehicle.height),
      features: parseVehicleFeatures(vehicle.features),
      fuelTankL: text(vehicle.fuelTankL),
      fuelConsumptionPer100: text(vehicle.fuelConsumptionPer100),
      fuelLevelL: text(vehicle.fuelLevelL),
    })
  }, [open, vehicle])

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
      // Особенности сохраняем человеческими названиями («Гидроборт»), как они
      // уже лежат в базе и как их показывает карточка. Идентификаторы вида
      // «tail_lift» в карточке выглядели бы машинным текстом.
      const payload: VehicleFormData = {
        ...formData,
        features: featuresForSave(
          formData.features,
          preservedFeatures,
        ) as unknown as VehicleFeature[],
      }
      await onSubmit(payload)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Редактировать ${vehicle?.plate ?? "транспорт"}` : "Добавить транспорт"}
          </DialogTitle>
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

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Топливо (учёт расхода)</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="fuelTankL" className="text-xs text-muted-foreground">Бак, л</Label>
                <Input
                  id="fuelTankL"
                  type="number"
                  placeholder="200"
                  value={formData.fuelTankL}
                  onChange={(e) => setFormData({ ...formData, fuelTankL: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fuelConsumptionPer100" className="text-xs text-muted-foreground">Расход л/100 км</Label>
                <Input
                  id="fuelConsumptionPer100"
                  type="number"
                  placeholder="25"
                  value={formData.fuelConsumptionPer100}
                  onChange={(e) => setFormData({ ...formData, fuelConsumptionPer100: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fuelLevelL" className="text-xs text-muted-foreground">Сейчас в баке, л</Label>
                <Input
                  id="fuelLevelL"
                  type="number"
                  placeholder="120"
                  value={formData.fuelLevelL}
                  onChange={(e) => setFormData({ ...formData, fuelLevelL: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
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
              {editing ? "Сохранить" : "Добавить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}