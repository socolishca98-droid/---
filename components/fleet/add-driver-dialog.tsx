// components/fleet/add-driver-dialog.tsx

"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2 } from "lucide-react"

interface AddDriverDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit?: (data: DriverFormData) => Promise<void>
  availableVehicles?: any[]
}

interface DriverFormData {
  name: string
  phone: string
  vehicleId: string
  vehicleType: string
  vehiclePlate: string
  licenseNumber: string
  licenseExpiry: string
  medicalExpiry: string
}

export function AddDriverDialog({ 
  open, 
  onOpenChange, 
  onSubmit,
  availableVehicles = []
}: AddDriverDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<DriverFormData>({
    name: "",
    phone: "",
    vehicleId: "",
    vehicleType: "",
    vehiclePlate: "",
    licenseNumber: "",
    licenseExpiry: "",
    medicalExpiry: "",
  })

  // Сброс формы при открытии
  useEffect(() => {
    if (open) {
      setFormData({
        name: "",
        phone: "",
        vehicleId: "",
        vehicleType: "",
        vehiclePlate: "",
        licenseNumber: "",
        licenseExpiry: "",
        medicalExpiry: "",
      })
    }
  }, [open])

  // Автозаполнение типа и номера при выборе ТС
  const handleVehicleSelect = (vehicleId: string) => {
    const vehicle = availableVehicles.find(v => v.id === vehicleId)
    setFormData({
      ...formData,
      vehicleId,
      vehicleType: vehicle?.type || "",
      vehiclePlate: vehicle?.plate || "",
    })
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Добавить водителя</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">ФИО *</Label>
            <Input
              id="name"
              placeholder="Иванов Иван Иванович"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Телефон *</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="+7 (999) 123-45-67"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vehicle">Закреплённое ТС</Label>
            <Select 
              value={formData.vehicleId} 
              onValueChange={handleVehicleSelect}
              disabled={isSubmitting}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите ТС (опционально)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Без закрепления</SelectItem>
                {availableVehicles.map((vehicle: any) => (
                  <SelectItem key={vehicle.id} value={vehicle.id}>
                    {vehicle.plate} — {vehicle.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableVehicles.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Нет свободных ТС. Сначала добавьте транспорт.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="licenseNumber">Номер ВУ</Label>
              <Input
                id="licenseNumber"
                placeholder="77 АА 123456"
                value={formData.licenseNumber}
                onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })}
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="licenseExpiry">Срок ВУ</Label>
              <Input
                id="licenseExpiry"
                type="date"
                value={formData.licenseExpiry}
                onChange={(e) => setFormData({ ...formData, licenseExpiry: e.target.value })}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="medicalExpiry">Срок мед. справки</Label>
            <Input
              id="medicalExpiry"
              type="date"
              value={formData.medicalExpiry}
              onChange={(e) => setFormData({ ...formData, medicalExpiry: e.target.value })}
              disabled={isSubmitting}
            />
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
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Добавить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}