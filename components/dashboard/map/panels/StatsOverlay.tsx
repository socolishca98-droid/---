// components/dashboard/map/panels/StatsOverlay.tsx

import Link from "next/link"
import {
  RefreshCw,
  Package,
  Route,
  TrendingUp,
  Building2,
  ChevronRight,
  Zap,
  Users,
  Activity,
  AlertTriangle,
} from "lucide-react"
import type { BaseData, DashboardStats } from "../types"
import { formatDistance } from "../constants"

interface StatsOverlayProps {
  base: BaseData | null
  baseWarning: string | null
  stats: DashboardStats
  routesCount: number
  totalActiveKm: number
  showRoutes: boolean
  onToggleRoutes: () => void
  onToggleDriversPanel: () => void
  showDriversPanel: boolean
  isLoading: boolean
  lastUpdate: Date | null
  onRefresh: () => void
  onFlyToBase: () => void
}

export function StatsOverlay({
  base,
  baseWarning,
  stats,
  routesCount,
  totalActiveKm,
  showRoutes,
  onToggleRoutes,
  onToggleDriversPanel,
  showDriversPanel,
  isLoading,
  lastUpdate,
  onRefresh,
  onFlyToBase,
}: StatsOverlayProps) {
  return (
    <>
      {/* Warning */}
      {baseWarning && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1001] bg-amber-500/90 text-black px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium shadow-lg">
          <AlertTriangle className="h-4 w-4" />
          {baseWarning}
          <Link href="/fleet" className="underline ml-2">
            Настроить
          </Link>
        </div>
      )}

      {/* Top Left */}
      <div className="absolute top-4 left-4 z-[1000] flex flex-col gap-3">
        {base && (
          <div
            className="group bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-2xl p-4 shadow-xl cursor-pointer hover:border-orange-500/40 transition-all"
            onClick={onFlyToBase}
          >
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg shadow-orange-500/30">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">{base.name}</div>
                <div className="text-xs text-gray-500 max-w-[140px] truncate">
                  {base.address}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-orange-500 transition-colors" />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Link href="/orders?status=active">
            <div className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-xl px-4 py-3 hover:border-orange-500/40 transition-all cursor-pointer">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/15">
                  <Package className="h-4 w-4 text-orange-500" />
                </div>
                <div>
                  <div className="text-xl font-bold text-white">
                    {stats.orders.active}
                  </div>
                  <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
                    В работе
                  </div>
                </div>
              </div>
            </div>
          </Link>

          <div className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-xl px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/15">
                <Route className="h-4 w-4 text-green-500" />
              </div>
              <div>
                <div className="text-xl font-bold text-white">{routesCount}</div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
                  Маршрутов
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-xl px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/15">
                <TrendingUp className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <div className="text-xl font-bold text-white">
                  {formatDistance(totalActiveKm)}{" "}
                  <span className="text-sm font-normal text-gray-500">км</span>
                </div>
                <div className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">
                  Активно
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Right */}
      <div className="absolute top-4 right-4 z-[1000] flex gap-2">
        <button
          onClick={onToggleRoutes}
          className={`bg-[#121217]/95 backdrop-blur-xl border rounded-xl p-3 transition-all ${
            showRoutes
              ? "border-orange-500/50 text-orange-500"
              : "border-[#2a2a35] text-gray-500 hover:text-white"
          }`}
        >
          <Zap className="h-5 w-5" />
        </button>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-xl p-3 text-gray-500 hover:text-white transition-all"
        >
          <RefreshCw
            className={`h-5 w-5 ${isLoading ? "animate-spin text-orange-500" : ""}`}
          />
        </button>
        <button
          onClick={onToggleDriversPanel}
          className={`relative bg-[#121217]/95 backdrop-blur-xl border rounded-xl p-3 transition-all ${
            showDriversPanel
              ? "border-orange-500/50 text-orange-500"
              : "border-[#2a2a35] text-gray-500 hover:text-white"
          }`}
        >
          <Users className="h-5 w-5" />
          {stats.online > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
              {stats.online}
            </span>
          )}
        </button>
      </div>

      {/* Bottom Left */}
      <div className="absolute bottom-6 left-4 z-[1000]">
        <Link href="/fleet">
          <div className="bg-[#121217]/95 backdrop-blur-xl border border-[#2a2a35] rounded-2xl px-6 py-4 shadow-xl hover:border-orange-500/30 transition-all">
            <div className="flex items-center gap-1.5 mb-3">
              <Activity className="h-4 w-4 text-orange-500" />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                Live
              </span>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            </div>
            <div className="flex gap-8">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">
                  {stats.online}
                </div>
                <div className="text-[9px] uppercase text-gray-500 tracking-wider font-semibold">
                  На связи
                </div>
              </div>
              <div className="w-px bg-[#2a2a35]" />
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-500">
                  {stats.inRoute}
                </div>
                <div className="text-[9px] uppercase text-gray-500 tracking-wider font-semibold">
                  В рейсе
                </div>
              </div>
              <div className="w-px bg-[#2a2a35]" />
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-500">
                  {stats.orders.completedToday}
                </div>
                <div className="text-[9px] uppercase text-gray-500 tracking-wider font-semibold">
                  Сегодня
                </div>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* Bottom Right */}
      <div className="absolute bottom-6 right-4 z-[1000]">
        <div className="flex items-center gap-2 bg-[#121217]/80 backdrop-blur border border-[#2a2a35] rounded-xl px-3 py-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isLoading ? "bg-orange-500 animate-pulse" : "bg-green-500"
            }`}
          />
          <span className="text-xs text-gray-500">
            {lastUpdate
              ? lastUpdate.toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "..."}
          </span>
        </div>
      </div>
    </>
  )
}