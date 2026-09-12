"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Order } from "@/lib/types"
import { MapPin, Clock, Phone, Navigation, CheckCircle, Camera, ChevronDown, ChevronUp } from "lucide-react"

interface TaskCardProps {
  order: Order
  onAccept?: () => void
  onStartRoute?: () => void
  onComplete?: () => void
  onUploadPhoto?: () => void
}

const statusConfig = {
  confirmed: { label: "Назначен", className: "bg-primary/20 text-primary", action: "Принять" },
  in_transit: { label: "В пути", className: "bg-warning/20 text-warning", action: "Завершить" },
  delivered: { label: "Доставлен", className: "bg-success/20 text-success", action: null },
}

export function TaskCard({ order, onAccept, onStartRoute, onComplete, onUploadPhoto }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false)
  const status = statusConfig[order.status as keyof typeof statusConfig] || statusConfig.confirmed

  const handleCall = () => {
    window.open(`tel:${order.clientContact}`, "_self")
  }

  const handleNavigate = () => {
    const destination = encodeURIComponent(order.routeTo)
    window.open(`https://yandex.ru/maps/?rtext=~${destination}&rtt=auto`, "_blank")
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <Badge variant="secondary" className={status.className}>
            {status.label}
          </Badge>
          <div className="text-right">
            <div className="text-xl font-bold text-primary">
              {order.price ? `${order.price.toLocaleString()} ₽` : "Договорная"}
            </div>
          </div>
        </div>

        {/* Route */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-success/20 flex items-center justify-center">
              <MapPin className="h-4 w-4 text-success" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Откуда</div>
              <div className="font-medium">{order.routeFrom}</div>
            </div>
          </div>
          <div className="ml-4 border-l-2 border-dashed border-border h-4" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Куда</div>
              <div className="font-medium">{order.routeTo}</div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-secondary/50">
            <div className="text-lg font-bold">{order.distance}</div>
            <div className="text-xs text-muted-foreground">км</div>
          </div>
          <div className="p-2 rounded-lg bg-secondary/50">
            <div className="text-lg font-bold">{(order.weight / 1000).toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">тонн</div>
          </div>
          <div className="p-2 rounded-lg bg-secondary/50">
            <div className="text-lg font-bold">{order.cargoType.split(" ")[0]}</div>
            <div className="text-xs text-muted-foreground">груз</div>
          </div>
        </div>

        {/* Expanded Info */}
        {expanded && (
          <div className="space-y-3 pt-2 border-t border-border">
            {/* Deadline */}
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Срок:</span>
              <span className="font-medium">
                {new Date(order.deadline).toLocaleString("ru-RU", {
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>

            {/* Requirements */}
            {order.requirements && (
              <div className="p-3 rounded-lg bg-secondary/50 text-sm">
                <div className="text-xs text-muted-foreground mb-1">Требования</div>
                <div>{order.requirements}</div>
              </div>
            )}

            {/* Client Info */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
              <div>
                <div className="text-xs text-muted-foreground">Клиент</div>
                <div className="font-medium">{order.clientName || "Не указан"}</div>
              </div>
              <Button size="sm" variant="outline" onClick={handleCall}>
                <Phone className="h-4 w-4 mr-1" />
                Позвонить
              </Button>
            </div>
          </div>
        )}

        {/* Expand Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="w-full text-muted-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-4 w-4 mr-1" />
              Свернуть
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4 mr-1" />
              Подробнее
            </>
          )}
        </Button>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
          {order.status === "confirmed" && (
            <>
              <Button className="bg-primary text-primary-foreground" onClick={onAccept}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Принять
              </Button>
              <Button variant="outline" onClick={handleNavigate}>
                <Navigation className="h-4 w-4 mr-2" />
                Маршрут
              </Button>
            </>
          )}
          {order.status === "in_transit" && (
            <>
              <Button variant="outline" onClick={onUploadPhoto}>
                <Camera className="h-4 w-4 mr-2" />
                Фото
              </Button>
              <Button className="bg-success text-white hover:bg-success/90" onClick={onComplete}>
                <CheckCircle className="h-4 w-4 mr-2" />
                Завершить
              </Button>
            </>
          )}
          {order.status === "delivered" && (
            <Button variant="outline" className="col-span-2 bg-transparent" onClick={onUploadPhoto}>
              <Camera className="h-4 w-4 mr-2" />
              Загрузить фото/чеки
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
