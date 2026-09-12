"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { MapPin, Calendar, Weight, Box, ArrowRight, Wallet, Bot, Package } from "lucide-react"
import { cn } from "@/lib/utils"

interface SandboxCardProps {
  order: any
  selected: boolean
  onSelect: () => void
}

export function SandboxCard({ order, selected, onSelect }: SandboxCardProps) {
  // Расчет цены за км (оценка эффективности)
  const pricePerKm = order.distance > 0 ? Math.round(order.price / order.distance) : 0
  
  // Цвет источника
  const sourceColor = order.source === 'ATI.SU' ? 'bg-blue-500/10 text-blue-500' : 
                      order.source === 'AI' ? 'bg-purple-500/10 text-purple-500' : 
                      'bg-gray-500/10 text-gray-500'

  return (
    <Card 
      className={cn(
        "relative p-4 transition-all duration-200 hover:shadow-lg border-l-4 cursor-pointer group",
        selected ? "border-l-orange-500 bg-orange-500/5 border-orange-500/50" : "border-l-transparent hover:border-l-orange-500/50"
      )}
      onClick={onSelect}
    >
      <div className="flex items-start gap-4">
        {/* Чекбокс */}
        <div className="pt-1">
          <Checkbox checked={selected} onCheckedChange={onSelect} className="data-[state=checked]:bg-orange-600 data-[state=checked]:border-orange-600" />
        </div>

        {/* Контент */}
        <div className="flex-1 space-y-3">
          
          {/* Заголовок: Маршрут */}
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-green-500">{order.routeFrom}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-red-500">{order.routeTo}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {order.distance} км • ~{Math.round(order.distance / 70)}ч в пути
              </div>
            </div>
            
            <div className="text-right">
              <div className="font-bold text-lg text-white">
                {order.price?.toLocaleString()} ₽
              </div>
              <div className={`text-[10px] font-mono ${pricePerKm > 60 ? 'text-green-500' : 'text-yellow-500'}`}>
                {pricePerKm} ₽/км
              </div>
            </div>
          </div>

          {/* Детали груза */}
          <div className="flex flex-wrap gap-3 text-xs text-gray-400 bg-secondary/30 p-2 rounded-lg">
            <div className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-white">{order.cargoType}</span>
            </div>
            <div className="w-px h-3 bg-gray-700" />
            <div className="flex items-center gap-1">
              <Weight className="h-3.5 w-3.5" />
              <span>{(order.weight / 1000).toFixed(1)} т</span>
            </div>
            {order.volume > 0 && (
              <>
                <div className="w-px h-3 bg-gray-700" />
                <div className="flex items-center gap-1">
                  <Box className="h-3.5 w-3.5" />
                  <span>{order.volume} м³</span>
                </div>
              </>
            )}
          </div>

          {/* Подвал: Источник и Даты */}
          <div className="flex justify-between items-center pt-1">
            <div className="flex gap-2">
              <Badge variant="secondary" className={cn("text-[10px] h-5", sourceColor)}>
                {order.source === 'AI' && <Bot className="h-3 w-3 mr-1" />}
                {order.source}
              </Badge>
              {order.aiScore > 80 && (
                <Badge variant="outline" className="text-[10px] h-5 border-green-500/50 text-green-500">
                  AI: Отличный выбор
                </Badge>
              )}
            </div>
            
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Calendar className="h-3 w-3" />
              {new Date(order.deadline).toLocaleDateString()}
            </div>
          </div>

        </div>
      </div>
    </Card>
  )
}