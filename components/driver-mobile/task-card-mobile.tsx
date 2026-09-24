"use client"

import type { Order } from "@/lib/types"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Phone, Navigation, Check, Play } from "lucide-react"

interface TaskCardMobileProps {
  order: Order
  onAccept?: () => void
  onStart?: () => void
  onComplete?: () => void
  onNavigate?: () => void
  onCall?: () => void
}

// Канон этапов заказа — lib/orders/stages.ts; прежние значения оставлены псевдонимами
const statusConfig: Record<string, { label: string; color: string }> = {
  new: { label: "Новый", color: "bg-blue-500" },
  search: { label: "Поиск", color: "bg-blue-500" },
  processing: { label: "В обработке", color: "bg-amber-500" },
  negotiation: { label: "Согласование", color: "bg-amber-500" },
  confirmed: { label: "Подтверждён", color: "bg-green-500" },
  agreed: { label: "Согласован", color: "bg-green-500" },
  in_route: { label: "В рейсе", color: "bg-primary" },
  documents: { label: "Документы", color: "bg-violet-500" },
  assigned: { label: "Назначен", color: "bg-green-500" },
  in_transit: { label: "В пути", color: "bg-primary" },
  control: { label: "На контроле", color: "bg-primary" },
  delivered: { label: "Доставлен", color: "bg-zinc-500" },
  cancelled: { label: "Отменён", color: "bg-red-500" },
  rejected: { label: "Отклонён", color: "bg-red-500" },
  expired: { label: "Просрочен", color: "bg-zinc-500" },
}

/** Статусы, при которых у водителя есть активная задача. */
const ACTIVE_TASK_STATUSES = ["assigned", "in_route", "control", "confirmed", "in_transit"]

const loadingTypeLabels: Record<string, string> = {
  bulk: "Валом",
  pallets: "Поддоны",
  boxes: "Коробки",
  rolls: "Рулоны",
  bags: "Мешки",
  other: "Другое",
}

export function TaskCardMobile({ order, onAccept, onStart, onComplete, onNavigate, onCall }: TaskCardMobileProps) {
  const status = statusConfig[order.status] ?? statusConfig.assigned
  const isActive = ACTIVE_TASK_STATUSES.includes(order.status)

  return (
    <Card className={isActive ? "border-primary" : undefined}>
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className={`h-2 w-2 rounded-full ${status.color}`} />
              <span className="text-xs text-muted-foreground">{status.label}</span>
              {order.loadingType && (
                <Badge variant="secondary" className="text-xs">
                  {loadingTypeLabels[order.loadingType]}
                </Badge>
              )}
            </div>
            <p className="font-semibold">{order.cargoType}</p>
          </div>
          {order.price && <p className="text-lg font-bold text-primary">{order.price.toLocaleString("ru-RU")} ₽</p>}
        </div>

        {/* Route - big and clear for drivers */}
        <div className="p-3 rounded-lg bg-secondary/50 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-green-500" />
            <span className="text-lg font-medium">{order.routeFrom}</span>
          </div>
          <div className="ml-1.5 border-l-2 border-dashed border-muted-foreground/30 h-4" />
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-red-500" />
            <span className="text-lg font-medium">{order.routeTo}</span>
          </div>
        </div>

        {/* Quick info */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-secondary/30">
            <p className="text-lg font-bold">{order.distance}</p>
            <p className="text-xs text-muted-foreground">км</p>
          </div>
          <div className="p-2 rounded-lg bg-secondary/30">
            <p className="text-lg font-bold">{(order.weight / 1000).toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">тонн</p>
          </div>
          <div className="p-2 rounded-lg bg-secondary/30">
            <p className="text-lg font-bold">{order.volume || "—"}</p>
            <p className="text-xs text-muted-foreground">м³</p>
          </div>
        </div>

        {/* Requirements if any */}
        {order.requirements && (
          <p className="text-sm text-muted-foreground bg-secondary/30 p-2 rounded-lg">{order.requirements}</p>
        )}

        {/* Actions - big buttons for drivers */}
        <div className="space-y-2">
          {order.status === "confirmed" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" className="h-12 text-base" onClick={onStart}>
                  <Play className="h-5 w-5 mr-2" />
                  Начать
                </Button>
                <Button size="lg" variant="outline" className="h-12 text-base bg-transparent" onClick={onNavigate}>
                  <Navigation className="h-5 w-5 mr-2" />
                  Маршрут
                </Button>
              </div>
              <Button size="lg" variant="secondary" className="w-full h-12 text-base" onClick={onCall}>
                <Phone className="h-5 w-5 mr-2" />
                Позвонить клиенту
              </Button>
            </>
          )}

          {order.status === "in_transit" && (
            <>
              <Button size="lg" className="w-full h-14 text-lg bg-green-600 hover:bg-green-700" onClick={onComplete}>
                <Check className="h-6 w-6 mr-2" />
                Завершить доставку
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" variant="outline" className="h-12 bg-transparent" onClick={onNavigate}>
                  <Navigation className="h-5 w-5 mr-2" />
                  Маршрут
                </Button>
                <Button size="lg" variant="outline" className="h-12 bg-transparent" onClick={onCall}>
                  <Phone className="h-5 w-5 mr-2" />
                  Звонок
                </Button>
              </div>
            </>
          )}

          {order.status === "new" && onAccept && (
            <Button size="lg" className="w-full h-12 text-base" onClick={onAccept}>
              Принять заказ
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
