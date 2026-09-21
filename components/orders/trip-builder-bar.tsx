"use client"

import { Button } from "@/components/ui/button"
import { X, Route, Truck } from "lucide-react"
import { useSidebar } from "@/lib/sidebar-context"

interface TripBuilderBarProps {
  selectedCount: number
  selectedOrders: any[]
  onClear: () => void
  onCreateTrip: () => void
}

export function TripBuilderBar({ selectedCount, selectedOrders, onClear, onCreateTrip }: TripBuilderBarProps) {
  const { isCollapsed } = useSidebar()

  // Суммируем вес и цену
  const totalWeight = selectedOrders.reduce((sum, o) => sum + (o.weight || 0), 0) / 1000
  const totalRevenue = selectedOrders.reduce((sum, o) => sum + (o.price || 0), 0)
  
  return (
    <div
      className="fixed bottom-6 right-6 z-50 transition-all duration-300 ease-in-out animate-in slide-in-from-bottom-10"
      style={{ left: isCollapsed ? "96px" : "272px" }}
    >
      <div className="bg-[#121217] border border-orange-500/30 shadow-2xl rounded-2xl p-4 flex items-center justify-between">
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="bg-orange-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">
              {selectedCount}
            </div>
            <div>
              <div className="text-sm font-medium text-white">Выбрано заказов</div>
              <div className="text-xs text-gray-400">
                {totalWeight.toFixed(1)} т • {totalRevenue.toLocaleString()} ₽
              </div>
            </div>
          </div>

          <div className="h-8 w-px bg-gray-800 hidden md:block" />

          {/* Предпросмотр маршрута */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-gray-400">
            <Route className="h-4 w-4 text-orange-500" />
            <span className="text-gray-500 font-mono uppercase">Маршрут:</span>
            {selectedOrders.map((o, i) => (
              <span key={o.id} className="flex items-center">
                {i > 0 && <span className="mx-1 text-gray-600">→</span>}
                <span className="text-white">{o.routeFrom.split(',')[0]}</span>
                <span className="mx-1 text-gray-600">→</span>
                <span className="text-white">{o.routeTo.split(',')[0]}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onClear} className="text-gray-400 hover:text-white">
            <X className="h-4 w-4 mr-2" />
            Отмена
          </Button>
          <Button onClick={onCreateTrip} className="bg-orange-600 hover:bg-orange-700 text-white font-bold shadow-lg shadow-orange-900/20">
            <Truck className="mr-2 h-4 w-4" />
            Сформировать рейс
          </Button>
        </div>

      </div>
    </div>
  )
}