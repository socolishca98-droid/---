"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Order } from "@/lib/types"
import {
  MapPin,
  Weight,
  Clock,
  Phone,
  ArrowRight,
  Flame,
  HelpCircle,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  XCircle,
} from "lucide-react"
import Link from "next/link"

interface OrdersPreviewProps {
  orders: Order[]
}

const priorityConfig = {
  hot: {
    label: "Горячий",
    icon: Flame,
    className: "bg-primary/20 text-primary border-primary/30",
  },
  possible: {
    label: "Возможный",
    icon: CheckCircle,
    className: "bg-success/20 text-success border-success/30",
  },
  doubtful: {
    label: "Сомнительный",
    icon: AlertTriangle,
    className: "bg-warning/20 text-warning border-warning/30",
  },
  needs_clarification: {
    label: "Уточнить",
    icon: HelpCircle,
    className: "bg-muted text-muted-foreground border-border",
  },
  // Добавленные ключи, чтобы TS не падал
  profitable: {
    label: "Выгодный",
    icon: DollarSign,
    className: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30",
  },
  reject: {
    label: "Отказ",
    icon: XCircle,
    className: "bg-destructive/20 text-destructive border-destructive/30",
  },
}

const statusConfig = {
  new: { label: "Новый", className: "bg-primary/20 text-primary" },
  processing: {
    label: "В обработке",
    className: "bg-warning/20 text-warning",
  },
  confirmed: {
    label: "Подтверждён",
    className: "bg-success/20 text-success",
  },
  in_transit: { label: "В пути", className: "bg-chart-2/20 text-chart-2" },
  delivered: {
    label: "Доставлен",
    className: "bg-muted text-muted-foreground",
  },
  cancelled: {
    label: "Отменён",
    className: "bg-destructive/20 text-destructive",
  },
}

export function OrdersPreview({ orders }: OrdersPreviewProps) {
  const sortedOrders = [...orders]
    .sort((a, b) => b.aiScore - a.aiScore)
    .slice(0, 5)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">
          Приоритетные заказы
        </CardTitle>
        <Link href="/orders">
          <Button
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary/80"
          >
            Все заказы <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {sortedOrders.map((order: any) => {
          // Fallback, если приоритет не найден в конфиге
          const priorityKey = (order.priority as keyof typeof priorityConfig) || "needs_clarification"
          const priority = priorityConfig[priorityKey]
          
          const statusKey = (order.status as keyof typeof statusConfig) || "new"
          const status = statusConfig[statusKey]
          
          const PriorityIcon = priority.icon

          return (
            <div
              key={order.id}
              className="flex flex-col gap-3 p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className={priority.className}>
                      <PriorityIcon className="h-3 w-3 mr-1" />
                      {priority.label}
                    </Badge>
                    <Badge variant="secondary" className={status.className}>
                      {status.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {order.source}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span>{order.routeFrom}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span>{order.routeTo}</span>
                    <span className="text-muted-foreground">
                      ({order.distance} км)
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-lg font-bold text-primary">
                    {order.price
                      ? `${order.price.toLocaleString()} ₽`
                      : "Договорная"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    AI: {order.aiScore}%
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Weight className="h-3 w-3" />
                  {(order.weight / 1000).toFixed(1)}т
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(order.deadline).toLocaleDateString("ru-RU")}
                </div>
                {order.clientName && (
                  <div className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {order.clientName}
                  </div>
                )}
                <div className="flex-1 text-right">{order.cargoType}</div>
              </div>

              {order.aiReason && (
                <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
                  ИИ: {order.aiReason}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}