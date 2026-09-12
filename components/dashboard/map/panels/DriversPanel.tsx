// components/dashboard/map/panels/DriversPanel.tsx

import Link from "next/link"
import {
  X,
  Users,
  Truck,
  Timer,
  MapPin,
  ChevronRight,
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
  return (
    <div
      className={`absolute top-0 right-0 bottom-0 w-80 bg-[#121217]/98 backdrop-blur-2xl border-l border-[#2a2a35] z-[999] flex flex-col shadow-2xl transition-transform duration-300 ${
        isOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#2a2a35] flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/15">
            <Users className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h3 className="font-bold text-white">Водители</h3>
            <p className="text-xs text-gray-500">{stats.online} онлайн</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-[#2a2a35] rounded-lg"
        >
          <X className="h-5 w-5 text-gray-400" />
        </button>
      </div>

      {/* Список водителей */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
        {drivers.length === 0 ? (
          <div className="text-center py-16 text-gray-500">Нет водителей</div>
        ) : (
          drivers.map((driver) => {
            const status = STATUS_CONFIG[driver.status] || STATUS_CONFIG.offline
            const isActive = ACTIVE_STATUSES.includes(driver.status)

            return (
              <div
                key={driver.id}
                onClick={() => {
                  onSelectDriver(driver.id)
                  if (driver.latitude && driver.longitude) {
                    onFlyToDriver(driver.latitude, driver.longitude)
                  }
                }}
                className={`relative bg-[#1a1a1f] border rounded-xl p-4 cursor-pointer transition-all ${
                  selectedDriverId === driver.id
                    ? "border-orange-500/50"
                    : "border-[#2a2a35] hover:border-[#3a3a45]"
                }`}
              >
                {isActive && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
                    style={{ background: status.color }}
                  />
                )}

                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white"
                      style={{
                        background: `linear-gradient(135deg, ${status.color}, ${status.color}88)`,
                      }}
                    >
                      {driver.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)}
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-white">
                        {driver.name}
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Truck className="h-3 w-3" />
                        {driver.vehiclePlate || "Нет ТС"}
                      </div>
                    </div>
                  </div>
                  {driver.statusDuration && driver.statusDuration > 0 && (
                    <div className="text-xs text-gray-500 bg-[#0f0f12] px-2 py-1 rounded flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      {formatDuration(driver.statusDuration)}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div
                    className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1.5"
                    style={{ background: status.bg, color: status.color }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {status.label}
                  </div>
                  {driver.routeTo && (
                    <div className="text-[10px] text-gray-600 flex items-center gap-1 truncate max-w-[90px]">
                      <MapPin className="h-3 w-3 flex-shrink-0" />
                      {driver.routeTo.split(",")[0]}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[#2a2a35]">
        <Link
          href="/fleet"
          className="flex items-center justify-center gap-2 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-500 text-sm font-medium hover:bg-orange-500/20 transition-all"
        >
          Управление парком
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}