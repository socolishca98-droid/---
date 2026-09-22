"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { Star, Truck, TrendingUp, TrendingDown } from "lucide-react"

interface DriverStats {
  id: string
  name: string
  ordersCompleted: number
  ordersTarget: number
  revenue: number
  rating: number
  avgDeliveryTime: number
  totalDistance: number
  fuelEfficiency: number
  trend: "up" | "down" | "stable"
}

const driversStats: DriverStats[] = [
  {
    id: "1",
    name: "Александр Петров",
    ordersCompleted: 47,
    ordersTarget: 50,
    revenue: 892000,
    rating: 4.8,
    avgDeliveryTime: 16.2,
    totalDistance: 12400,
    fuelEfficiency: 28.5,
    trend: "up",
  },
  {
    id: "2",
    name: "Михаил Сидоров",
    ordersCompleted: 38,
    ordersTarget: 45,
    revenue: 654000,
    rating: 4.6,
    avgDeliveryTime: 18.5,
    totalDistance: 9800,
    fuelEfficiency: 31.2,
    trend: "stable",
  },
  {
    id: "3",
    name: "Дмитрий Козлов",
    ordersCompleted: 52,
    ordersTarget: 50,
    revenue: 1120000,
    rating: 4.9,
    avgDeliveryTime: 14.8,
    totalDistance: 15600,
    fuelEfficiency: 26.8,
    trend: "up",
  },
]

export function DriverPerformance() {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          Эффективность водителей
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {driversStats.map((driver: any) => {
          const completionRate = Math.round((driver.ordersCompleted / driver.ordersTarget) * 100)
          const initials = driver.name
            .split(" ")
            .map((n: any) => n[0])
            .join("")

          return (
            <div key={driver.id} className="p-4 rounded-lg bg-secondary/50">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/20 text-primary">{initials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="font-medium">{driver.name}</div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Star className="h-3 w-3 text-warning fill-warning" />
                      {driver.rating}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {driver.trend === "up" && (
                    <Badge variant="secondary" className="bg-success/20 text-success">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      Рост
                    </Badge>
                  )}
                  {driver.trend === "down" && (
                    <Badge variant="secondary" className="bg-destructive/20 text-destructive">
                      <TrendingDown className="h-3 w-3 mr-1" />
                      Снижение
                    </Badge>
                  )}
                  {driver.trend === "stable" && <Badge variant="secondary">Стабильно</Badge>}
                </div>
              </div>

              {/* Progress */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Выполнение плана</span>
                  <span className="font-medium">
                    {driver.ordersCompleted}/{driver.ordersTarget} заказов
                  </span>
                </div>
                <Progress value={Math.min(completionRate, 100)} className="h-2" />
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-primary">{(driver.revenue / 1000).toFixed(0)}к ₽</div>
                  <div className="text-xs text-muted-foreground">Выручка</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold">{driver.avgDeliveryTime}ч</div>
                  <div className="text-xs text-muted-foreground">Ср. время</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold">{(driver.totalDistance / 1000).toFixed(1)}к км</div>
                  <div className="text-xs text-muted-foreground">Пробег</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold">{driver.fuelEfficiency}л</div>
                  <div className="text-xs text-muted-foreground">Расход/100км</div>
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
