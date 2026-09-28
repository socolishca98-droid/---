"use client"

// components/routes/backhaul-dialog.tsx
//
// Попутные грузы на обратное плечо: рейс заканчивается не у базы — список
// грузов «из города конца рейса в город базы» из накопленной базы поиска.
// Кнопка «В рейс» кладёт груз догрузом через тот же серверный контур, что и
// обычный догруз: импорт контактов из ATI и add-load с проверкой загрузки.

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowRight, Loader2, Package } from "lucide-react"
import { toast } from "sonner"

interface BackhaulLoad {
  id: string
  routeFrom: string
  routeTo: string
  distance: number | null
  weight: number | null
  price: number | null
  cargoType: string | null
}

interface BackhaulDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  route: { id: string; vehiclePlate: string } | null
  onSuccess: () => void
}

export function BackhaulDialog({ open, onOpenChange, route, onSuccess }: BackhaulDialogProps) {
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [endpointCity, setEndpointCity] = useState("")
  const [baseCity, setBaseCity] = useState("")
  const [emptyReturnKm, setEmptyReturnKm] = useState<number | null>(null)
  const [candidates, setCandidates] = useState<BackhaulLoad[]>([])

  useEffect(() => {
    if (!open || !route) return
    let alive = true
    setLoading(true)
    fetch(`/api/routes/${route.id}/backhaul`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return
        if (!data.success) {
          toast.error(data.error || "Не удалось подобрать грузы")
          return
        }
        setEndpointCity(data.endpointCity || "")
        setBaseCity(data.baseCity || "")
        setEmptyReturnKm(data.emptyReturnKm ?? null)
        setCandidates(data.candidates || [])
      })
      .catch(() => alive && toast.error("Ошибка связи с сервером"))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [open, route])

  const takeLoad = async (load: BackhaulLoad) => {
    if (!route) return
    setSavingId(load.id)
    try {
      // Контакты клиента тянем из ATI тем же контуром, что и обычный догруз
      const importRes = await fetch("/api/ati/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cacheId: load.id, fetchContacts: true }),
      })
      const importData = await importRes.json().catch(() => null)

      const res = await fetch(`/api/routes/${route.id}/add-load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          atiCacheId: load.id,
          routeFrom: load.routeFrom,
          routeTo: load.routeTo,
          distance: load.distance ?? 0,
          weight: load.weight ?? 0,
          price: load.price ?? 0,
          cargoType: load.cargoType || "Груз",
          clientName: importData?.firm?.name || undefined,
          clientContact: importData?.contact?.phone || "",
          proposeToDriver: true,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(data.message || "Груз взят догрузом на обратное плечо")
        onSuccess()
        onOpenChange(false)
        return
      }
      if (data.details?.overflow) {
        toast.error("Груз не помещается по грузоподъёмности", {
          description: `Перегруз ${(data.details.overflow / 1000).toFixed(1)} т: добавьте через «Догруз» с ответственностью логиста`,
        })
        return
      }
      toast.error(data.error || "Не удалось добавить груз")
    } catch {
      toast.error("Ошибка связи с сервером")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Обратное плечо: попутные грузы</DialogTitle>
          <DialogDescription>
            {endpointCity && baseCity
              ? `Рейс заканчивается в г. ${endpointCity}, база — г. ${baseCity}.`
              : "Подбор грузов на дорогу к базе."}
            {emptyReturnKm !== null && ` Порожний возврат ≈${emptyReturnKm} км.`}
            {" "}Грузы ниже загружаются в точке конца рейса и выгружаются у базы.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Подбираем грузы…
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Сейчас в базе поиска нет грузов на этом направлении. Загляните позже
            или откройте «Поиск грузов» вручную.
          </p>
        ) : (
          <ScrollArea className="max-h-[50vh] pr-2">
            <ul className="space-y-2">
              {candidates.map((load) => (
                <li
                  key={load.id}
                  className="rounded-lg border border-border/60 bg-secondary/30 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {load.routeFrom}
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      {load.routeTo}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void takeLoad(load)}
                      disabled={savingId === load.id}
                    >
                      {savingId === load.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "В рейс"
                      )}
                    </Button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="gap-1">
                      <Package className="h-3 w-3" />
                      {load.cargoType || "Груз"}
                    </Badge>
                    {load.weight !== null && <span>{(load.weight / 1000).toFixed(1)} т</span>}
                    {load.distance !== null && <span>· {load.distance} км</span>}
                    {load.price !== null && (
                      <span className="font-semibold text-foreground">
                        · {load.price.toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
