"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Order } from "@/lib/types"
import {
  MapPin,
  Weight,
  Box,
  Clock,
  Phone,
  ArrowRight,
  Flame,
  HelpCircle,
  AlertTriangle,
  CheckCircle,
  User,
  Truck,
  ChevronDown,
  ChevronUp,
  Bot,
  CreditCard,
  Banknote,
  Calendar,
  Package,
} from "lucide-react"

interface OrderCardProps {
  order: Order
  onStatusChange?: (orderId: string, status: Order["status"]) => void
  onAssignDriver?: (orderId: string) => void
  onCall?: (orderId: string) => void
}

const priorityConfig: Record<
  string,
  { label: string; icon: any; className: string }
> = {
  hot: {
    label: "Лучший вариант",
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
  // Добавляем fallback ключи, если они придут из моков
  profitable: {
    label: "Выгодный",
    icon: Flame,
    className: "bg-primary/20 text-primary border-primary/30",
  },
  reject: {
    label: "Отказ",
    icon: AlertTriangle,
    className: "bg-destructive/20 text-destructive border-destructive/30",
  },
}

const statusConfig: Record<
  string,
  { label: string; className: string }
> = {
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

const loadingTypeLabels: Record<string, string> = {
  bulk: "Валом",
  pallets: "Паллеты",
  boxes: "Коробки",
  rolls: "Рулоны",
  bags: "Мешки",
  other: "Другое",
}

const paymentTypeConfig: Record<
  string,
  { label: string; icon: any; className: string }
> = {
  cash: { label: "Наличные", icon: Banknote, className: "text-green-600" },
  bank_transfer: {
    label: "Безнал",
    icon: CreditCard,
    className: "text-blue-600",
  },
  deferred: {
    label: "Отсрочка",
    icon: Calendar,
    className: "text-amber-600",
  },
}

export function OrderCard({
  order,
  onStatusChange,
  onAssignDriver,
  onCall,
}: OrderCardProps) {
  const [expanded, setExpanded] = useState(false)

  // Приводим к any, чтобы получить доступ к свойствам моков
  const orderAny = order as any

  const priority =
    priorityConfig[order.priority] || priorityConfig.needs_clarification
  const status = statusConfig[order.status] || statusConfig.new
  const PriorityIcon = priority.icon

  const payment = orderAny.payment
  const paymentType = payment ? paymentTypeConfig[payment.type] : null
  const PaymentIcon = paymentType?.icon

  const loadingTypeLabel =
    loadingTypeLabels[order.loadingType] || order.loadingType

  return (
    <Card className="bg-card border-border hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={priority.className}>
              <PriorityIcon className="h-3 w-3 mr-1" />
              {priority.label}
            </Badge>
            <Badge variant="secondary" className={status.className}>
              {status.label}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {order.source}
            </Badge>
            {order.loadingType && (
              <Badge variant="secondary" className="text-xs">
                <Package className="h-3 w-3 mr-1" />
                {loadingTypeLabel}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">#{order.id}</span>
          </div>

          <div className="text-right flex-shrink-0">
            <div className="text-xl font-bold text-primary">
              {order.price
                ? `${order.price.toLocaleString()} ₽`
                : "Договорная"}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
              <Bot className="h-3 w-3" />
              AI: {order.aiScore}%
            </div>
          </div>
        </div>

        {/* Route */}
        <div className="flex items-center gap-2 text-base font-medium mb-3">
          <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="truncate">{order.routeFrom}</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="truncate">{order.routeTo}</span>
          <span className="text-muted-foreground text-sm">
            ({order.distance} км)
          </span>
        </div>

        {/* Quick Info */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3 flex-wrap">
          <div className="flex items-center gap-1">
            <Weight className="h-4 w-4" />
            {(order.weight / 1000).toFixed(1)}т
          </div>
          {order.volume && (
            <div className="flex items-center gap-1">
              <Box className="h-4 w-4" />
              {order.volume}м³
            </div>
          )}
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            до {new Date(order.deadline).toLocaleDateString("ru-RU")}
          </div>
          <div className="flex items-center gap-1">
            <Truck className="h-4 w-4" />
            {order.cargoType}
          </div>
          {paymentType && PaymentIcon && (
            <div className={`flex items-center gap-1 ${paymentType.className}`}>
              <PaymentIcon className="h-4 w-4" />
              {paymentType.label}
              {payment?.vat === "with_vat" && (
                <span className="text-xs">(НДС)</span>
              )}
              {payment?.type === "deferred" && payment.deferredDays && (
                <span className="text-xs">({payment.deferredDays}д)</span>
              )}
            </div>
          )}
        </div>

        {/* AI Reason */}
        {order.aiReason && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2 mb-3">
            <Bot className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
            <span>{order.aiReason}</span>
          </div>
        )}

        {/* Expanded Content */}
        {expanded && (
          <div className="border-t border-border pt-3 mt-3 space-y-3">
            {/* Client Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground mb-1">Клиент</div>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  <span>{order.clientName || "Не указан"}</span>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Контакт</div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-primary" />
                  <span>{order.clientContact}</span>
                </div>
              </div>
            </div>

            {payment && (
              <div className="text-sm">
                <div className="text-muted-foreground mb-1">
                  Условия оплаты
                </div>
                <div className="bg-secondary/50 rounded-lg px-3 py-2 flex items-center gap-4">
                  {PaymentIcon && (
                    <PaymentIcon
                      className={`h-4 w-4 ${paymentType?.className}`}
                    />
                  )}
                  <span>{paymentType?.label}</span>
                  <Badge variant="outline" className="text-xs">
                    {payment.vat === "with_vat" ? "С НДС" : "Без НДС"}
                  </Badge>
                  {payment.type === "deferred" && payment.deferredDays && (
                    <span className="text-xs text-amber-600">
                      Отсрочка {payment.deferredDays} дней
                    </span>
                  )}
                  {payment.isPaid ? (
                    <Badge className="bg-green-500/20 text-green-600">
                      Оплачено
                    </Badge>
                  ) : (
                    payment.dueDate && (
                      <span className="text-xs text-muted-foreground">
                        Срок:{" "}
                        {new Date(payment.dueDate).toLocaleDateString("ru-RU")}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Requirements */}
            {order.requirements && (
              <div className="text-sm">
                <div className="text-muted-foreground mb-1">Требования</div>
                <div className="bg-secondary/50 rounded-lg px-3 py-2">
                  {order.requirements}
                </div>
              </div>
            )}

            {/* Assigned Driver */}
            {orderAny.assignedDriver && (
              <div className="text-sm">
                <div className="text-muted-foreground mb-1">
                  Назначенный водитель
                </div>
                <Badge variant="secondary">
                  <Truck className="h-3 w-3 mr-1" />
                  Водитель #{orderAny.assignedDriver}
                </Badge>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                onClick={() => onCall?.(order.id)}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Phone className="h-4 w-4 mr-1" />
                Позвонить
              </Button>
              {!orderAny.assignedDriver && order.status !== "cancelled" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onAssignDriver?.(order.id)}
                >
                  <Truck className="h-4 w-4 mr-1" />
                  Назначить
                </Button>
              )}
              {order.status === "new" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onStatusChange?.(order.id, "processing")}
                >
                  В обработку
                </Button>
              )}
              {order.status === "processing" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onStatusChange?.(order.id, "confirmed")}
                >
                  Подтвердить
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Expand Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-2 text-muted-foreground hover:text-foreground"
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
      </CardContent>
    </Card>
  )
}