// components/routes/add-load-dialog.tsx

"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Loader2,
  Package,
  Search,
  MapPin,
  Weight,
  ArrowRight,
  Plus,
  AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface AddLoadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  route: {
    id: string
    driverName: string
    vehiclePlate: string
    availableCapacity: number
    orders: any[]
  } | null
  onSuccess: () => void
}

interface AtiLoad {
  id: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  price: number
  cargoType: string
  firmName: string
}

export function AddLoadDialog({ open, onOpenChange, route, onSuccess }: AddLoadDialogProps) {
  const [activeTab, setActiveTab] = useState<"ati" | "manual">("ati")
  const [searchQuery, setSearchQuery] = useState("")
  const [atiLoads, setAtiLoads] = useState<AtiLoad[]>([])
  const [loadingAti, setLoadingAti] = useState(false)
  const [selectedLoad, setSelectedLoad] = useState<AtiLoad | null>(null)
  const [proposeToDriver, setProposeToDriver] = useState(false)
  const [saving, setSaving] = useState(false)

  // Ручной ввод
  const [manualData, setManualData] = useState({
    routeFrom: "",
    routeTo: "",
    distance: "",
    weight: "",
    price: "",
    cargoType: "",
    clientName: "",
    clientContact: "",
  })

  useEffect(() => {
    if (open) {
      loadAtiLoads()
    }
  }, [open])

  const loadAtiLoads = async () => {
    setLoadingAti(true)
    try {
      const res = await fetch("/api/ati/cache?status=new&limit=50")
      const data = await res.json()
      if (data.items) {
        setAtiLoads(data.items)
      }
    } catch (error) {
      console.error("Failed to load ATI:", error)
    } finally {
      setLoadingAti(false)
    }
  }

  const filteredLoads = atiLoads.filter((load: any) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      load.routeFrom.toLowerCase().includes(q) ||
      load.routeTo.toLowerCase().includes(q) ||
      load.cargoType?.toLowerCase().includes(q)
    )
  })

  const canAddLoad = (weight: number) => {
    return route ? weight <= route.availableCapacity : false
  }

  const handleAddFromAti = async () => {
    if (!selectedLoad || !route) return

    if (!canAddLoad(selectedLoad.weight)) {
      toast.error("Груз не помещается", {
        description: `Требуется ${(selectedLoad.weight / 1000).toFixed(1)}т, доступно ${(route.availableCapacity / 1000).toFixed(1)}т`,
      })
      return
    }

    setSaving(true)

    try {
      // Сначала импортируем груз из ATI
      const importRes = await fetch("/api/ati/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cacheId: selectedLoad.id,
          fetchContacts: true,
        }),
      })

      const importData = await importRes.json()
      if (!importData.success) {
        toast.error(importData.error || "Ошибка импорта груза")
        setSaving(false)
        return
      }

      // Добавляем к маршруту
      const res = await fetch(`/api/routes/${route.id}/add-load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          atiCacheId: selectedLoad.id,
          routeFrom: selectedLoad.routeFrom,
          routeTo: selectedLoad.routeTo,
          distance: selectedLoad.distance,
          weight: selectedLoad.weight,
          price: selectedLoad.price,
          cargoType: selectedLoad.cargoType,
          clientName: selectedLoad.firmName,
          clientContact: importData.contact?.phone || "",
          proposeToDriver,
        }),
      })

      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        onSuccess()
        onOpenChange(false)
        resetForm()
      } else {
        toast.error(data.error)
      }
    } catch (error) {
      toast.error("Ошибка добавления догруза")
    } finally {
      setSaving(false)
    }
  }

  const handleAddManual = async () => {
    if (!route) return

    const weight = parseInt(manualData.weight, 10) * 1000 || 0

    if (!manualData.routeFrom || !manualData.routeTo) {
      toast.error("Укажите маршрут")
      return
    }

    if (!canAddLoad(weight)) {
      toast.error("Груз не помещается", {
        description: `Требуется ${(weight / 1000).toFixed(1)}т, доступно ${(route.availableCapacity / 1000).toFixed(1)}т`,
      })
      return
    }

    setSaving(true)

    try {
      const res = await fetch(`/api/routes/${route.id}/add-load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeFrom: manualData.routeFrom,
          routeTo: manualData.routeTo,
          distance: parseInt(manualData.distance, 10) || 0,
          weight,
          price: parseInt(manualData.price, 10) || 0,
          cargoType: manualData.cargoType || "Груз",
          clientName: manualData.clientName,
          clientContact: manualData.clientContact,
          proposeToDriver,
        }),
      })

      const data = await res.json()
      if (data.success) {
        toast.success(data.message)
        onSuccess()
        onOpenChange(false)
        resetForm()
      } else {
        toast.error(data.error)
      }
    } catch (error) {
      toast.error("Ошибка добавления догруза")
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setSelectedLoad(null)
    setManualData({
      routeFrom: "",
      routeTo: "",
      distance: "",
      weight: "",
      price: "",
      cargoType: "",
      clientName: "",
      clientContact: "",
    })
    setProposeToDriver(false)
  }

  if (!route) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-purple-500" />
            Добавить догруз
          </DialogTitle>
          <DialogDescription>
            Маршрут: {route.vehiclePlate} • Свободно: {(route.availableCapacity / 1000).toFixed(1)} т
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="ati">Из базы ATI</TabsTrigger>
            <TabsTrigger value="manual">Вручную</TabsTrigger>
          </TabsList>

          <TabsContent value="ati" className="flex-1 mt-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по городу или грузу..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <ScrollArea className="h-[300px] pr-4">
              {loadingAti ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : filteredLoads.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Нет доступных грузов</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredLoads.map((load: any) => {
                    const fits = canAddLoad(load.weight)
                    const isSelected = selectedLoad?.id === load.id

                    return (
                      <div
                        key={load.id}
                        onClick={() => fits && setSelectedLoad(isSelected ? null : load)}
                        className={cn(
                          "p-3 rounded-lg border cursor-pointer transition-all",
                          isSelected
                            ? "border-purple-500 bg-purple-500/10"
                            : fits
                              ? "border-border hover:border-purple-500/50"
                              : "border-border opacity-50 cursor-not-allowed"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {load.routeFrom.split(",")[0]}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">
                              {load.routeTo.split(",")[0]}
                            </span>
                          </div>
                          <span className="font-bold text-green-600">
                            {load.price.toLocaleString()} ₽
                          </span>
                        </div>

                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {load.distance} км
                          </span>
                          <span className="flex items-center gap-1">
                            <Weight className="h-3.5 w-3.5" />
                            {(load.weight / 1000).toFixed(1)} т
                          </span>
                          <span>{load.cargoType}</span>
                        </div>

                        {!fits && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-amber-500">
                            <AlertTriangle className="h-3 w-3" />
                            Не помещается
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="manual" className="mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Откуда</Label>
                <Input
                  placeholder="Москва"
                  value={manualData.routeFrom}
                  onChange={(e) => setManualData({ ...manualData, routeFrom: e.target.value })}
                />
              </div>
              <div>
                <Label>Куда</Label>
                <Input
                  placeholder="Санкт-Петербург"
                  value={manualData.routeTo}
                  onChange={(e) => setManualData({ ...manualData, routeTo: e.target.value })}
                />
              </div>
              <div>
                <Label>Расстояние (км)</Label>
                <Input
                  type="number"
                  placeholder="700"
                  value={manualData.distance}
                  onChange={(e) => setManualData({ ...manualData, distance: e.target.value })}
                />
              </div>
              <div>
                <Label>Вес (тонн)</Label>
                <Input
                  type="number"
                  placeholder="5"
                  value={manualData.weight}
                  onChange={(e) => setManualData({ ...manualData, weight: e.target.value })}
                />
              </div>
              <div>
                <Label>Цена (₽)</Label>
                <Input
                  type="number"
                  placeholder="50000"
                  value={manualData.price}
                  onChange={(e) => setManualData({ ...manualData, price: e.target.value })}
                />
              </div>
              <div>
                <Label>Тип груза</Label>
                <Input
                  placeholder="Сборный груз"
                  value={manualData.cargoType}
                  onChange={(e) => setManualData({ ...manualData, cargoType: e.target.value })}
                />
              </div>
              <div>
                <Label>Заказчик</Label>
                <Input
                  placeholder="ООО Компания"
                  value={manualData.clientName}
                  onChange={(e) => setManualData({ ...manualData, clientName: e.target.value })}
                />
              </div>
              <div>
                <Label>Телефон</Label>
                <Input
                  placeholder="+7..."
                  value={manualData.clientContact}
                  onChange={(e) => setManualData({ ...manualData, clientContact: e.target.value })}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between pt-4 border-t">
          <div className="flex items-center gap-2">
            <Switch
              id="propose"
              checked={proposeToDriver}
              onCheckedChange={setProposeToDriver}
            />
            <Label htmlFor="propose" className="text-sm">
              Предложить водителю (может отказаться)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={activeTab === "ati" ? handleAddFromAti : handleAddManual}
            disabled={saving || (activeTab === "ati" && !selectedLoad)}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Добавить догруз
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}