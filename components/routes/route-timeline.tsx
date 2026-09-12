"use client"

import { useEffect, useState, useMemo } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import {
  Clock,
  MapPin,
  Camera,
  AlertTriangle,
  Info,
  CheckCircle2,
  XCircle,
  Truck,
  Package,
  Navigation,
  FileText,
  MessageSquare,
  ZoomIn,
} from "lucide-react"
import { cn } from "@/lib/utils"

type RouteEventDto = {
  id: string
  routeId: string
  orderId?: string | null
  driverId: string
  vehicleId?: string | null
  stageId?: string | null
  type: string
  status?: string | null
  latitude?: number | null
  longitude?: number | null
  address?: string | null
  data?: string | null
  createdAt: string
}

interface RouteTimelineProps {
  routeId: string
}

// Хелпер для парсинга JSON
function parseEventData(jsonString: string | null) {
  if (!jsonString) return null
  try {
    return JSON.parse(jsonString)
  } catch {
    return null
  }
}

// Форматирование времени
function formatTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Форматирование даты
function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  })
}

// Конфиг событий
function getEventConfig(type: string, status?: string | null) {
  switch (type) {
    case "location":
      return {
        label: "Геопозиция",
        icon: MapPin,
        color: "text-blue-500",
        bg: "bg-blue-500/10",
        border: "border-blue-500/20",
      }
    case "photo":
      return {
        label: "Фото",
        icon: Camera,
        color: "text-purple-500",
        bg: "bg-purple-500/10",
        border: "border-purple-500/20",
      }
    case "sos":
      return {
        label: "SOS СИГНАЛ",
        icon: AlertTriangle,
        color: "text-red-500",
        bg: "bg-red-500/10",
        border: "border-red-500/50",
      }
    case "status":
      if (status === "route_created")
        return {
          label: "Рейс создан",
          icon: Navigation,
          color: "text-green-500",
          bg: "bg-green-500/10",
          border: "border-green-500/20",
        }
      if (status === "route_completed")
        return {
          label: "Рейс завершён",
          icon: CheckCircle2,
          color: "text-emerald-600",
          bg: "bg-emerald-600/10",
          border: "border-emerald-600/30",
        }
      if (status === "route_cancelled")
        return {
          label: "Рейс отменён",
          icon: XCircle,
          color: "text-red-500",
          bg: "bg-red-500/10",
          border: "border-red-500/30",
        }
      if (status === "load_added")
        return {
          label: "Догруз добавлен",
          icon: Package,
          color: "text-orange-500",
          bg: "bg-orange-500/10",
          border: "border-orange-500/20",
        }
      if (status === "load_proposed")
        return {
          label: "Предложен догруз",
          icon: MessageSquare,
          color: "text-amber-500",
          bg: "bg-amber-500/10",
          border: "border-amber-500/20",
        }
      if (status === "load_accepted")
        return {
          label: "Догруз принят",
          icon: CheckCircle2,
          color: "text-green-500",
          bg: "bg-green-500/10",
          border: "border-green-500/20",
        }
      if (status === "load_rejected")
        return {
          label: "Догруз отклонён",
          icon: XCircle,
          color: "text-red-400",
          bg: "bg-red-400/10",
          border: "border-red-400/20",
        }
      if (status === "loading")
        return {
          label: "На погрузке",
          icon: Truck,
          color: "text-blue-400",
          bg: "bg-blue-400/10",
          border: "border-blue-400/20",
        }
      if (status === "unloading")
        return {
          label: "На выгрузке",
          icon: Truck,
          color: "text-indigo-400",
          bg: "bg-indigo-400/10",
          border: "border-indigo-400/20",
        }
      if (status === "delivered")
        return {
          label: "Доставлен",
          icon: CheckCircle2,
          color: "text-green-500",
          bg: "bg-green-500/10",
          border: "border-green-500/20",
        }
      return {
        label: "Статус изменён",
        icon: Info,
        color: "text-slate-400",
        bg: "bg-slate-500/10",
        border: "border-slate-500/20",
      }
    default:
      return {
        label: type,
        icon: Info,
        color: "text-slate-400",
        bg: "bg-slate-500/10",
        border: "border-slate-500/20",
      }
  }
}

export function RouteTimeline({ routeId }: RouteTimelineProps) {
  const [events, setEvents] = useState<RouteEventDto[]>([])
  const [loading, setLoading] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  // Фото подгружаем отдельно, так как в событии может не быть URL
  // (В идеале нужно джойнить таблицу Photo на бэке, но пока сделаем лениво)
  const [photosMap, setPhotosMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!routeId) return

    let cancelled = false
    const load = async () => {
      if (events.length === 0) setLoading(true)
      try {
        const res = await fetch(`/api/routes/${routeId}/events`)
        const data = await res.json()
        if (!cancelled && data.success && Array.isArray(data.events)) {
          const list = data.events
            .map((e: any) => ({
              ...e,
              createdAt:
                typeof e.createdAt === "string"
                  ? e.createdAt
                  : new Date(e.createdAt).toISOString(),
            }))
            .sort(
              (a: any, b: any) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            )
          setEvents(list)

          // Ищем события фото без URL и пытаемся их подтянуть
          // (это временный хак, лучше бы бэк сразу отдавал URL)
          const photoEvents = list.filter(
            (e: any) => e.type === "photo" && !photosMap[e.id],
          )
          if (photoEvents.length > 0) {
            // Тут можно сделать запрос за фото, если API позволяет фильтровать по дате/типу
            // Пока просто оставим заглушку или используем URL если он был в data
            // (В data мы сохраняем description, но URL там может и не быть)
          }
        }
      } catch (e) {
        console.error("[RouteTimeline] load error:", e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const interval = setInterval(load, 15000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [routeId])

  const groupedEvents = useMemo(() => {
    const groups: Record<string, RouteEventDto[]> = {}
    events.forEach((e) => {
      const dateKey = formatDate(e.createdAt)
      if (!groups[dateKey]) groups[dateKey] = []
      groups[dateKey].push(e)
    })
    return groups
  }, [events])

  if (loading && events.length === 0) {
    return (
      <div className="flex justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg bg-muted/20">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Нет событий по рейсу</p>
        <p className="text-xs opacity-70">
          История появится, когда водитель начнет движение
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {Object.entries(groupedEvents).map(([date, dayEvents]) => (
        <div key={date} className="relative">
          <div className="sticky top-0 z-10 flex items-center justify-center mb-4 pointer-events-none">
            <span className="bg-background/95 backdrop-blur px-3 py-1 rounded-full border border-border text-xs font-medium text-muted-foreground shadow-sm">
              {date}
            </span>
          </div>

          <div className="space-y-4 pl-4 border-l border-border/50 ml-4">
            {dayEvents.map((e) => {
              const config = getEventConfig(e.type, e.status)
              const Icon = config.icon
              const eventData = parseEventData(e.data)

              // Если в data есть url (например, мы начали его туда писать), берем его
              const imageUrl = eventData?.url || null

              return (
                <div key={e.id} className="relative group">
                  <div
                    className={cn(
                      "absolute -left-[21px] top-2.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                      config.color.replace("text-", "bg-"),
                    )}
                  />

                  <Card
                    className={cn(
                      "p-3 transition-all hover:shadow-md",
                      config.border,
                      config.bg,
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 overflow-hidden">
                        <div
                          className={cn(
                            "p-2 rounded-lg bg-background/60 flex-shrink-0",
                            config.color,
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-medium text-sm text-foreground">
                              {config.label}
                            </span>
                            {e.status && e.type !== "status" && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 h-5 border-current opacity-60"
                              >
                                {e.status}
                              </Badge>
                            )}
                          </div>

                          <div className="text-xs text-muted-foreground space-y-1.5">
                            {e.address && (
                              <div className="flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                <span className="truncate max-w-[240px]">
                                  {e.address}
                                </span>
                              </div>
                            )}

                            {/* Детали события */}
                            {eventData && (
                              <div className="bg-background/50 rounded p-2 text-[11px] leading-relaxed border border-border/50">
                                {eventData.description && (
                                  <p>{eventData.description}</p>
                                )}
                                {eventData.message && (
                                  <p className="text-red-500 font-bold">
                                    "{eventData.message}"
                                  </p>
                                )}
                                {eventData.rejectionReason && (
                                  <p className="text-red-400">
                                    Причина: {eventData.rejectionReason}
                                  </p>
                                )}
                                {eventData.weight && (
                                  <p>
                                    Вес: {(eventData.weight / 1000).toFixed(1)}т
                                    {eventData.price &&
                                      ` • ${eventData.price.toLocaleString()}₽`}
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Превью фото, если есть URL */}
                            {imageUrl && (
                              <div
                                className="mt-2 relative w-24 h-24 rounded-lg overflow-hidden cursor-zoom-in border border-border"
                                onClick={() => setPreviewImage(imageUrl)}
                              >
                                <img
                                  src={imageUrl}
                                  alt="Фото"
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center">
                                  <ZoomIn className="text-white opacity-0 group-hover:opacity-100 h-6 w-6 drop-shadow-md" />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-[10px] text-muted-foreground whitespace-nowrap tabular-nums font-medium opacity-70">
                        {formatTime(e.createdAt)}
                      </div>
                    </div>
                  </Card>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-black/95 border-none shadow-2xl">
          {previewImage && (
            <div className="relative w-full h-[80vh] flex items-center justify-center">
              <img
                src={previewImage}
                alt="Preview"
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}