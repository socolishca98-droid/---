"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RouteMap } from "./route-map"
import {
  RouteIcon,
  Fuel,
  Clock,
  Truck,
  Bot,
  ChevronRight,
  MapPin,
  Coins,
  User,
} from "lucide-react"

export interface SuggestedRouteDriver {
  id: string
  name: string
  vehiclePlate?: string
}

export type SuggestedRouteWaypoint = {
  name: string
  type: "start" | "waypoint" | "end"
}

export interface SuggestedRoute {
  id: string
  name: string
  orders: string[]
  totalDistance: number
  estimatedTime: number
  fuelCost: number
  tollCost: number
  estimatedProfit: number
  driver: SuggestedRouteDriver | null
  vehicleId?: string
  waypoints: SuggestedRouteWaypoint[]
  aiExplanation: string
  status?: string

  // допускаем дополнительные поля у моков/будущих API
  [key: string]: unknown
}

interface RouteCardProps {
  route: SuggestedRoute
  onAssignDriver?: (routeId: string) => void
  onViewDetails?: (routeId: string) => void
}

export function RouteCard({ route, onAssignDriver, onViewDetails }: RouteCardProps) {
  return (
    <Card className="bg-card border-border hover:border-primary/30 transition-colors">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <RouteIcon className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">{route.name}</h3>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary" className="text-xs">
                {route.orders.length} {route.orders.length === 1 ? "заказ" : "заказа"}
              </Badge>
              {route.orders.length > 1 && (
                <Badge
                  variant="outline"
                  className="text-xs bg-success/10 text-success border-success/30"
                >
                  Объединённый
                </Badge>
              )}
            </div>
          </div>

          <div className="text-right">
            <div className="text-xl font-bold text-success">
              +{route.estimatedProfit.toLocaleString()} ₽
            </div>
            <div className="text-xs text-muted-foreground">прибыль</div>
          </div>
        </div>

        {/* Route Map */}
        <RouteMap waypoints={route.waypoints} />

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-secondary/50 rounded-lg p-3 text-center">
            <MapPin className="h-4 w-4 text-primary mx-auto mb-1" />
            <div className="text-sm font-medium">{route.totalDistance} км</div>
            <div className="text-xs text-muted-foreground">расстояние</div>
          </div>

          <div className="bg-secondary/50 rounded-lg p-3 text-center">
            <Clock className="h-4 w-4 text-primary mx-auto mb-1" />
            <div className="text-sm font-medium">{route.estimatedTime} ч</div>
            <div className="text-xs text-muted-foreground">в пути</div>
          </div>

          <div className="bg-secondary/50 rounded-lg p-3 text-center">
            <Fuel className="h-4 w-4 text-warning mx-auto mb-1" />
            <div className="text-sm font-medium">{route.fuelCost.toLocaleString()} ₽</div>
            <div className="text-xs text-muted-foreground">топливо</div>
          </div>

          <div className="bg-secondary/50 rounded-lg p-3 text-center">
            <Coins className="h-4 w-4 text-muted-foreground mx-auto mb-1" />
            <div className="text-sm font-medium">{route.tollCost.toLocaleString()} ₽</div>
            <div className="text-xs text-muted-foreground">платные</div>
          </div>
        </div>

        {/* AI Explanation */}
        <div className="flex items-start gap-2 text-sm bg-secondary/50 rounded-lg p-3">
          <Bot className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
          <span className="text-muted-foreground">{route.aiExplanation}</span>
        </div>

        {/* Driver Assignment */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          {route.driver ? (
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                <User className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-medium">{route.driver.name}</div>
                <div className="text-xs text-muted-foreground">
                  {route.driver.vehiclePlate || "—"}
                </div>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onAssignDriver?.(route.id)}>
              <Truck className="h-4 w-4 mr-1" />
              Назначить водителя
            </Button>
          )}

          <Button variant="ghost" size="sm" onClick={() => onViewDetails?.(route.id)}>
            Подробнее
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}