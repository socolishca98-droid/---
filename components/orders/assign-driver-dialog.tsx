// components/orders/assign-driver-dialog.tsx

"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2 } from "lucide-react"

interface AssignDriverDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAssign: (driverId: string) => Promise<void>
}

export function AssignDriverDialog({ open, onOpenChange, onAssign }: AssignDriverDialogProps) {
  const [drivers, setDrivers] = useState<any[]>([])
  const [selectedDriver, setSelectedDriver] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      fetch('/api/drivers?status=available')
        .then(res => res.json())
        .then(data => {
          if (data.success) setDrivers(data.drivers)
        })
    }
  }, [open])

  const handleAssign = async () => {
    if (!selectedDriver) return
    setLoading(true)
    try {
      await onAssign(selectedDriver)
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Назначить водителя</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <Select value={selectedDriver} onValueChange={setSelectedDriver}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите водителя" />
            </SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} ({d.vehiclePlate || 'Без авто'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {drivers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center">
              Нет свободных водителей
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleAssign} disabled={!selectedDriver || loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Назначить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}