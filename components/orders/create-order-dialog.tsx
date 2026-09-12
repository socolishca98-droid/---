// components/orders/create-order-dialog.tsx

"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"

interface CreateOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: any) => Promise<void>
}

export function CreateOrderDialog({ open, onOpenChange, onSubmit }: CreateOrderDialogProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    routeFrom: '', routeTo: '', distance: '', cargoType: '',
    weight: '', volume: '', price: '', clientName: '', clientContact: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await onSubmit(formData)
      onOpenChange(false)
      setFormData({
        routeFrom: '', routeTo: '', distance: '', cargoType: '',
        weight: '', volume: '', price: '', clientName: '', clientContact: ''
      })
    } catch (e) {
      alert('Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Новый заказ</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Откуда *</Label><Input required value={formData.routeFrom} onChange={e => setFormData({...formData, routeFrom: e.target.value})} placeholder="Москва" /></div>
            <div className="space-y-2"><Label>Куда *</Label><Input required value={formData.routeTo} onChange={e => setFormData({...formData, routeTo: e.target.value})} placeholder="СПб" /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Км</Label><Input type="number" value={formData.distance} onChange={e => setFormData({...formData, distance: e.target.value})} /></div>
            <div className="space-y-2"><Label>Кг</Label><Input type="number" value={formData.weight} onChange={e => setFormData({...formData, weight: e.target.value})} placeholder="20000" /></div>
            <div className="space-y-2"><Label>М³</Label><Input type="number" value={formData.volume} onChange={e => setFormData({...formData, volume: e.target.value})} /></div>
          </div>
          <div className="space-y-2"><Label>Груз *</Label><Input required value={formData.cargoType} onChange={e => setFormData({...formData, cargoType: e.target.value})} placeholder="Стройматериалы" /></div>
          <div className="space-y-2"><Label>Цена (₽)</Label><Input type="number" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} placeholder="85000" /></div>
          <div className="space-y-2"><Label>Телефон клиента</Label><Input value={formData.clientContact} onChange={e => setFormData({...formData, clientContact: e.target.value})} placeholder="+7..." /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Создать</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}