"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Fuel, Loader2 } from "lucide-react"

interface FuelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (liters: number, amount: number) => Promise<void>
}

export function FuelDialog({ open, onOpenChange, onSubmit }: FuelDialogProps) {
  const [liters, setLiters] = useState(100)
  const [amount, setAmount] = useState<string>("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await onSubmit(liters, amount ? parseFloat(amount) : 0)
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] bg-[#1a1a1f] border-gray-800 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
              <Fuel className="h-5 w-5" />
            </div>
            Заправка
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Литры */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <Label className="text-gray-400">Количество топлива</Label>
              <span className="text-xl font-bold text-purple-400">{liters} л</span>
            </div>
            <Slider
              value={[liters]}
              onValueChange={(v) => setLiters(v[0])}
              max={500}
              step={5}
              className="py-2"
            />
          </div>

          {/* Сумма */}
          <div className="space-y-2">
            <Label className="text-gray-400">Сумма (₽)</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="bg-[#111116] border-gray-700 text-lg"
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button 
            variant="ghost" 
            onClick={() => onOpenChange(false)}
            className="text-gray-400 hover:text-white"
          >
            Отмена
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Подтвердить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}