"use client"

import { useState } from "react"
import type { Photo, Route, DogrizSuggestion } from "@/lib/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Sparkles,
  Truck,
  Package,
  MapPin,
  Phone,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Weight,
  Box,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface CargoAnalysisCardProps {
  photo: Photo
  route?: Route
  suggestions?: DogrizSuggestion[]
  onAcceptSuggestion?: (suggestionId: string) => void
  onRejectSuggestion?: (suggestionId: string) => void
}

export function CargoAnalysisCard({
  photo,
  route,
  suggestions = [],
  onAcceptSuggestion,
  onRejectSuggestion,
}: CargoAnalysisCardProps) {
  const [showSuggestions, setShowSuggestions] = useState(true)

  const fillPercent = photo.aiClassification?.cargoFillPercent || 0
  const hasSuggestions = suggestions.length > 0

  // Determine fill status
  const getFillStatus = (percent: number) => {
    if (percent >= 90) return { label: "Полная загрузка", color: "text-green-600", bg: "bg-green-500" }
    if (percent >= 70) return { label: "Хорошая загрузка", color: "text-blue-600", bg: "bg-blue-500" }
    if (percent >= 40) return { label: "Частичная загрузка", color: "text-amber-600", bg: "bg-amber-500" }
    return { label: "Низкая загрузка", color: "text-red-600", bg: "bg-red-500" }
  }

  const fillStatus = getFillStatus(fillPercent)

  return (
    <Card className={cn("border-2", hasSuggestions ? "border-primary/50 bg-primary/5" : "border-border")}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/20">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            ИИ-анализ загрузки кузова
          </CardTitle>
          {hasSuggestions && <Badge className="bg-primary animate-pulse">Есть догруз!</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Photo preview */}
        <div className="flex gap-4">
          <div className="w-32 h-24 rounded-lg overflow-hidden bg-secondary flex-shrink-0">
            <img src={photo.url || "/placeholder.svg"} alt="Фото груза" className="w-full h-full object-cover" />
          </div>

          <div className="flex-1 space-y-3">
            {/* Fill percentage */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">Загрузка кузова</span>
                <span className={cn("text-sm font-bold", fillStatus.color)}>{fillPercent}%</span>
              </div>
              <Progress value={fillPercent} className="h-3" />
              <p className={cn("text-xs mt-1", fillStatus.color)}>{fillStatus.label}</p>
            </div>

            {/* AI description */}
            <p className="text-sm text-muted-foreground">{photo.aiClassification?.description}</p>
          </div>
        </div>

        {/* Available capacity info */}
        {route && fillPercent < 90 && (
          <div className="p-3 rounded-lg bg-secondary/50 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Маршрут: {route.name}</span>
              </div>
            </div>
            <Badge variant="outline">Свободно ~{Math.round(((100 - fillPercent) / 100) * 20)}т</Badge>
          </div>
        )}

        {/* Dogriz suggestions */}
        {hasSuggestions && (
          <div className="space-y-3">
            <button
              onClick={() => setShowSuggestions(!showSuggestions)}
              className="flex items-center justify-between w-full text-sm font-medium"
            >
              <span className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                Предложения по догрузу ({suggestions.length})
              </span>
              {showSuggestions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {showSuggestions && (
              <div className="space-y-3">
                {suggestions.map((suggestion) => (
                  <div key={suggestion.id} className="p-4 rounded-lg bg-background border border-border">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        {/* Order info */}
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{suggestion.suggestedOrder.cargoType}</span>
                          <Badge variant="secondary" className="text-xs">
                            {suggestion.suggestedOrder.source}
                          </Badge>
                        </div>

                        {/* Route */}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>{suggestion.suggestedOrder.routeFrom}</span>
                          <ArrowRight className="h-3 w-3" />
                          <span>{suggestion.suggestedOrder.routeTo}</span>
                        </div>

                        {/* Weight and volume */}
                        <div className="flex items-center gap-4 text-sm">
                          <span className="flex items-center gap-1">
                            <Weight className="h-3.5 w-3.5 text-muted-foreground" />
                            {(suggestion.suggestedOrder.weight / 1000).toFixed(1)}т
                          </span>
                          {suggestion.suggestedOrder.volume && (
                            <span className="flex items-center gap-1">
                              <Box className="h-3.5 w-3.5 text-muted-foreground" />
                              {suggestion.suggestedOrder.volume}м³
                            </span>
                          )}
                        </div>

                        {/* Price */}
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-bold text-primary">
                            +{suggestion.suggestedOrder.price?.toLocaleString("ru-RU")} ₽
                          </span>
                          <span className="text-sm text-muted-foreground">{suggestion.suggestedOrder.clientName}</span>
                        </div>

                        {/* AI reason */}
                        <p className="text-xs text-muted-foreground italic">{suggestion.aiReason}</p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                      <Button size="sm" className="flex-1" onClick={() => onAcceptSuggestion?.(suggestion.id)}>
                        <Phone className="h-3.5 w-3.5 mr-1" />
                        Позвонить
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600 hover:text-green-700 hover:bg-green-50 bg-transparent"
                        onClick={() => onAcceptSuggestion?.(suggestion.id)}
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Взять
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => onRejectSuggestion?.(suggestion.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No suggestions message */}
        {!hasSuggestions && fillPercent < 70 && (
          <div className="p-3 rounded-lg bg-secondary/30 text-center">
            <p className="text-sm text-muted-foreground">ИИ ищет подходящие заказы для догруза...</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
