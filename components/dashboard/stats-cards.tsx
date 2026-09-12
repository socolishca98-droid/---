"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Package, TrendingUp, Truck, ArrowUpRight, ArrowDownRight } from "lucide-react"

// Локальное определение, т.к. в lib/types его нет
export interface DashboardStats {
  activeOrders: number
  totalOrders: number
  completedToday: number
  revenue: number
  vehicleUtilization: number
}

interface StatsCardsProps {
  stats: DashboardStats
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards = [
    {
      title: "Активных заказов",
      value: stats.activeOrders,
      change: "+12%",
      changeType: "positive" as const,
      icon: Package,
      description: `Всего: ${stats.totalOrders}`,
    },
    {
      title: "Выполнено сегодня",
      value: stats.completedToday,
      change: "+8%",
      changeType: "positive" as const,
      icon: TrendingUp,
      description: "Заказов",
    },
    {
      title: "Выручка",
      value: `${(stats.revenue / 1000000).toFixed(1)}М ₽`,
      change: "+23%",
      changeType: "positive" as const,
      icon: TrendingUp,
      description: "За месяц",
    },
    {
      title: "Загрузка машин",
      value: `${stats.vehicleUtilization}%`,
      change: "-5%",
      changeType: "negative" as const,
      icon: Truck,
      description: "Среднее время: 18.5ч",
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <card.icon className="h-5 w-5 text-primary" />
              </div>
              <div
                className={`flex items-center gap-1 text-sm ${
                  card.changeType === "positive" ? "text-success" : "text-destructive"
                }`}
              >
                {card.changeType === "positive" ? (
                  <ArrowUpRight className="h-4 w-4" />
                ) : (
                  <ArrowDownRight className="h-4 w-4" />
                )}
                {card.change}
              </div>
            </div>
            <div className="mt-4">
              <h3 className="text-2xl font-bold text-card-foreground">{card.value}</h3>
              <p className="text-sm text-muted-foreground">{card.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{card.description}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}