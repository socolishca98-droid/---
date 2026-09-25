// components/dashboard/map/panels/DriversPanel.tsx

"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import {
  X,
  Users,
  Truck,
  Timer,
  MapPin,
  ChevronRight,
  Search,
  CheckCircle2,
} from "lucide-react"
import type { DriverLocation, DashboardStats } from "../types"
import { STATUS_CONFIG, ACTIVE_STATUSES, formatDuration } from "../constants"

interface DriversPanelProps {
  isOpen: boolean
  onClose: () => void
  drivers: DriverLocation[]
  stats: DashboardStats
  selectedDriverId: string | null
  onSelectDriver: (id: string | null) => void
  onFlyToDriver: (lat: number, lng: number) => void
}

export function DriversPanel({
  isOpen,
  onClose,
  drivers,
  stats,
  selectedDriverId,
  onSelectDriver,
  onFlyToDriver,
}: DriversPanelProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredDrivers = useMemo(() => {
    if (!searchQuery.trim()) return drivers
    const q = searchQuery.toLowerCase()
    return drivers.filter((d: any) =>
        d.name.toLowerCase().includes(q) ||
        (d.vehiclePlate && d.vehiclePlate.toLowerCase().includes(q)) ||
        (d.routeTo && d.routeTo.toLowerCase().includes(q))
    )
  }, [drivers, searchQuery])

  return (
    <div
      className={`absolute top-0 right-0 bottom-0 w-84 max-w-[calc(100vw-2rem)] bg-[#111319]/96 backdrop-blur-2xl border-l border-white/[0.08] z-[1050] flex flex-col shadow-2xl transition-transform duration-300 ease-out ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Шапка панели */}
      <div className="p-4 border-b border-white/[0.08] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/30 text-orange-400">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              Водители
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                {stats.online} online
              </span>
            </h3>
            <p className="text-[11px] text-gray-400">Мониторинг местоположения</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          title="Закрыть панель"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Поиск */}
      <div className="p-3 border-b border-white/[0.06] shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по водителю или номеру ТС..."
            className="w-full bg-[#181a24] border border-white/[0.08] rounded-xl pl-9 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Список водителей */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {filteredDrivers.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-xs">
            {drivers.length === 0 ? "Нет активных водителей" : "Ничего не найдено"}
          </div>
        ) : (
          filteredDrivers.map((driver: any) => {
            const status = STATUS_CONFIG[driver.status] || STATUS_CONFIG.offline
            const isActive = ACTIVE_STATUSES.includes(driver.status)
            const isSelected = selectedDriverId === driver.id

            return (
              <div
                key={driver.id}
                onClick={() => {
                  onSelectDriver(driver.id)
                  if (driver.latitude && driver.longitude) {
                    onFlyToDriver(driver.latitude, driver.longitude)
                  }
                }}
                className={`relative bg-[#161822] border rounded-2xl p-3.5 cursor-pointer transition-all ${
                  isSelected
                    ? "border-orange-500 shadow-lg shadow-orange-500/10 bg-[#1b1e2c]"
                    : "border-white/[0.06] hover:border-white/[0.15] hover:bg-[#1a1c28]"
                }`}
              >
                {isActive && (
                  <div
                    className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full"
                    style={{ background: status.color }}
                  />
                )}

                <div className="flex justify-between items-start mb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold text-white shadow-md"
                      style={{
                        background: `linear-gradient(135deg, ${status.color}, ${status.color}88)`,
                      }}
                    >
                      {driver.name
                        .split(" ")
                        .map((n: any) => n[0])
                        .join("")
                        .slice(0, 2)}
                    </div>
                    <div>
                      <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                        {driver.name}
                        {isSelected && (
                          <CheckCircle2 className="h-3 w-3 text-orange-400" />
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                        <Truck className="h-3 w-3 text-gray-500" />
                        <span>{driver.vehiclePlate || "Без ТС"}</span>
                      </div>
                    </div>
                  </div>

                  {driver.statusDuration && driver.statusDuration > 0 && (
                    <div className="text-[10px] text-gray-400 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-lg flex items-center gap-1">
                      <Timer className="h-3 w-3 text-gray-500" />
                      {formatDuration(driver.statusDuration)}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-white/[0.04]">
                  <div
                    className="px-2 py-0.5 rounded-md text-[9.5px] font-bold uppercase tracking-wider flex items-center gap-1.5 border"
                    style={{
                      background: status.bg,
                      color: status.color,
                      borderColor: `${status.color}30`,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: status.color }}
                    />
                    {status.label}
                  </div>

                  {driver.routeTo && (
                    <div className="text-[10px] text-gray-400 flex items-center gap-1 truncate max-w-[110px]">
                      <MapPin className="h-3 w-3 text-gray-500 shrink-0" />
                      <span className="truncate">{driver.routeTo.split(",")[0]}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Подвал */}
      <div className="p-3 border-t border-white/[0.08] shrink-0">
        <Link
          href="/fleet"
          className="flex items-center justify-center gap-2 py-2.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-xl text-orange-400 text-xs font-semibold transition-all"
        >
          <span>Управление автопарком</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
