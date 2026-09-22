// components/fleet/assign-driver-dialog.tsx

"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, User, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import type { Driver, Vehicle } from "@/lib/types"

interface AssignDriverDialogProps {
  vehicle: Vehicle | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function AssignDriverDialog({
  vehicle,
  open,
  onOpenChange,
  onSuccess,
}: AssignDriverDialogProps) {
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [assigningId, setAssigningId] = useState<string | null>(null)

  useEffect(() => {
    if (open && vehicle) {
      setLoading(true)
      setSearch("")

      fetch("/api/fleet")
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            const freeDrivers = (data.drivers as Driver[]).filter(
              (d: any) => d.status === "available" && !d.vehicleId,
            )
            setDrivers(freeDrivers)
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false))
    }
  }, [open, vehicle])

  const handleAssign = async (driverId: string) => {
    if (!vehicle) return
    setAssigningId(driverId)

    try {
      const res = await fetch("/api/fleet/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId,
          vehicleId: vehicle.id,
        }),
      })

      const result = await res.json()

      if (!result.success) {
        throw new Error(result.error || "Ошибка назначения")
      }

      toast.success("Водитель назначен")
      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.message || "Не удалось назначить водителя")
    } finally {
      setAssigningId(null)
    }
  }

  const filtered = drivers.filter((d: any) =>
      d.name.toLowerCase().includes(search.toLowerCase()) || d.phone.includes(search),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Назначить водителя на {vehicle?.plate}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск водителя..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto space-y-2">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Нет свободных водителей</p>
              </div>
            ) : (
              filtered.map((driver: any) => (
                <div
                  key={driver.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{driver.name}</p>
                      <p className="text-xs text-muted-foreground">{driver.phone}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAssign(driver.id)}
                    disabled={assigningId !== null}
                  >
                    {assigningId === driver.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Выбрать"
                    )}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}