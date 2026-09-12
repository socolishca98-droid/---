// components/driver-mobile/pending-load-card.tsx

"use client"

import { useState } from "react"
import { 
  Package, 
  MapPin, 
  Weight, 
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Clock,
  ArrowRight,
} from "lucide-react"

interface PendingLoadCardProps {
  load: {
    id: string
    routeFrom: string
    routeTo: string
    distance: number
    weight: number
    price: number
    cargoType: string
    proposedAt?: string
  }
  onAccept: () => void
  onReject: (reason?: string) => void
}

const REJECTION_REASONS = [
  "Нет места в кузове",
  "Не по маршруту",
  "Слишком далеко",
  "Нет времени",
  "Другая причина",
]

export function PendingLoadCard({ load, onAccept, onReject }: PendingLoadCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showRejectReasons, setShowRejectReasons] = useState(false)

  const timeSinceProposed = load.proposedAt 
    ? Math.round((Date.now() - new Date(load.proposedAt).getTime()) / 60000)
    : 0

  return (
    <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-2xl overflow-hidden">
      <div 
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Package className="h-4 w-4 text-amber-500" />
              <span className="text-amber-400 font-medium text-sm">
                Предложен догруз
              </span>
              {timeSinceProposed > 0 && (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {timeSinceProposed} мин назад
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 text-white font-medium">
              <span className="truncate max-w-[120px]">{load.routeFrom.split(",")[0]}</span>
              <ArrowRight className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <span className="truncate max-w-[120px]">{load.routeTo.split(",")[0]}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-green-400">
              +{load.price.toLocaleString()}₽
            </span>
            {expanded ? (
              <ChevronUp className="h-5 w-5 text-gray-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-500" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {load.distance} км
          </span>
          <span className="flex items-center gap-1">
            <Weight className="h-3.5 w-3.5" />
            {(load.weight / 1000).toFixed(1)} т
          </span>
          <span>{load.cargoType}</span>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="h-px bg-gray-700/50" />
          
          {!showRejectReasons ? (
            <div className="flex gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onAccept()
                }}
                className="flex-1 py-3 bg-green-500 hover:bg-green-600 rounded-xl font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
              >
                <Check className="h-5 w-5" />
                Принять
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowRejectReasons(true)
                }}
                className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
              >
                <X className="h-5 w-5" />
                Отклонить
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-gray-400">Укажите причину:</p>
              {REJECTION_REASONS.map((reason) => (
                <button
                  key={reason}
                  onClick={(e) => {
                    e.stopPropagation()
                    onReject(reason)
                  }}
                  className="w-full py-2.5 px-4 bg-gray-800 hover:bg-gray-700 rounded-lg text-left text-sm active:scale-[0.99] transition-all"
                >
                  {reason}
                </button>
              ))}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowRejectReasons(false)
                }}
                className="w-full py-2 text-gray-500 text-sm hover:text-white"
              >
                Отмена
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}