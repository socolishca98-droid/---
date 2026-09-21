// components/dashboard/map/panels/StatsOverlay.tsx

"use client"

import { useState } from "react"
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
  AlertTriangle,
  Car,
  Layers,
  Crosshair,
  Radio,
  CheckCircle2,
  X,
} from "lucide-react"
import type { BaseData, DashboardStats } from "../types"
import { formatDistance } from "../constants"
import type { MapTheme } from "../hooks/useMapInstance"
import type { TrafficLevelInfo } from "../layers/TrafficLayer"

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
  onResetView?: () => void
  mapTheme?: MapTheme
  onChangeTheme?: (theme: MapTheme) => void
  showTraffic?: boolean
  isTrafficPanelOpen?: boolean
  onToggleTrafficPanel?: () => void
  trafficLevel?: number | null
  trafficInfo?: TrafficLevelInfo | null
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
  onResetView,
  mapTheme = "dark",
  onChangeTheme,
  showTraffic = true,
  isTrafficPanelOpen = false,
  onToggleTrafficPanel,
  trafficLevel,
  trafficInfo,
}: StatsOverlayProps) {
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [warningDismissed, setWarningDismissed] = useState(false)

  const isCritical = trafficInfo?.status === "critical"
  const isWarning = trafficInfo?.status === "warning"

  const trafficBadgeColor = isCritical
    ? "text-rose-300 bg-rose-500/20 border-rose-500/40"
    : isWarning
    ? "text-amber-300 bg-amber-500/20 border-amber-500/40"
    : "text-emerald-300 bg-emerald-500/20 border-emerald-500/40"

  const trafficDotColor = isCritical
    ? "bg-rose-400 shadow-rose-500/50"
    : isWarning
    ? "bg-amber-400 shadow-amber-500/50"
    : "bg-emerald-400 shadow-emerald-500/50"

  const trafficLabel = trafficInfo
    ? isCritical
      ? trafficInfo.accidentsCount > 0
        ? `ДТП • +${trafficInfo.totalDelayMinutes}м`
        : `Сбой • +${trafficInfo.totalDelayMinutes}м`
      : isWarning
      ? `+${trafficInfo.totalDelayMinutes} мин`
      : "В графике"
    : typeof trafficLevel === "number"
    ? `${trafficLevel} б.`
    : "В графике"

  return (
    <>
      {/* ══════════════════════════════════════════════════════════════════
          ВЕРХНИЙ ХАБ УПРАВЛЕНИЯ (COMMAND BAR HUD)
         ══════════════════════════════════════════════════════════════════ */}
      <header className="absolute top-4 left-4 right-4 z-[1000] flex items-center justify-between gap-3 pointer-events-none">
        
        {/* ЛЕВЫЙ МОДУЛЬ: База флота */}
        <div className="flex items-center gap-2 pointer-events-auto shrink-0">
          {base ? (
            <button
              onClick={onFlyToBase}
              title="Перелететь к штабу / базе"
              className="group flex items-center gap-3 bg-[#111319]/90 hover:bg-[#161922] backdrop-blur-xl border border-white/[0.08] hover:border-orange-500/40 rounded-2xl px-3.5 py-2.5 shadow-2xl transition-all text-left cursor-pointer"
            >
              <div className="relative p-2.5 rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 border border-orange-500/30 text-orange-400 group-hover:scale-105 transition-transform">
                <Building2 className="h-4 w-4" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-500 animate-ping" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-500" />
              </div>
              <div className="max-w-[150px] sm:max-w-[180px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400/90">База</span>
                  <span className="text-gray-500 text-[10px]">•</span>
                  <span className="text-[10px] text-gray-400 truncate">{base.name}</span>
                </div>
                <div className="text-xs font-semibold text-gray-200 truncate mt-0.5">
                  {base.address || "Адрес базы"}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-500 group-hover:text-orange-400 group-hover:translate-x-0.5 transition-all" />
            </button>
          ) : (
            <Link
              href="/fleet"
              className="flex items-center gap-2.5 bg-[#111319]/90 hover:bg-[#161922] backdrop-blur-xl border border-dashed border-orange-500/40 rounded-2xl px-3.5 py-2.5 shadow-2xl transition-all text-left text-xs font-medium text-orange-400 hover:text-orange-300"
            >
              <Building2 className="h-4 w-4" />
              <span>Указать базу флота</span>
            </Link>
          )}
        </div>

        {/* ЦЕНТРАЛЬНЫЙ МОДУЛЬ: KPI Капсула (Скрывается на очень узких экранах) */}
        <div className="hidden lg:flex items-center gap-1 bg-[#111319]/90 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-1.5 shadow-2xl pointer-events-auto">
          {/* В работе */}
          <Link
            href="/orders?status=active"
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl hover:bg-white/[0.04] transition-colors"
          >
            <div className="p-1.5 rounded-lg bg-orange-500/15 text-orange-400">
              <Package className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white tracking-tight">
                {stats.orders.active}
              </div>
              <div className="text-[9px] font-medium uppercase tracking-wider text-gray-400">
                В работе
              </div>
            </div>
          </Link>

          <div className="w-px h-6 bg-white/[0.08]" />

          {/* Маршрутов */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl">
            <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400">
              <Route className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white tracking-tight">
                {routesCount}
              </div>
              <div className="text-[9px] font-medium uppercase tracking-wider text-gray-400">
                Рейсов
              </div>
            </div>
          </div>

          <div className="w-px h-6 bg-white/[0.08]" />

          {/* Общий пробег */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl">
            <div className="p-1.5 rounded-lg bg-cyan-500/15 text-cyan-400">
              <TrendingUp className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white tracking-tight">
                {formatDistance(totalActiveKm)} <span className="text-[10px] font-normal text-gray-400">км</span>
              </div>
              <div className="text-[9px] font-medium uppercase tracking-wider text-gray-400">
                Дистанция
              </div>
            </div>
          </div>

          <div className="w-px h-6 bg-white/[0.08]" />

          {/* Водители на связи */}
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl">
            <div className="p-1.5 rounded-lg bg-indigo-500/15 text-indigo-400">
              <Radio className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                <span>{stats.online}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <div className="text-[9px] font-medium uppercase tracking-wider text-gray-400">
                Онлайн
              </div>
            </div>
          </div>
        </div>

        {/* ПРАВЫЙ МОДУЛЬ: Панель инструментов (Control Cluster) */}
        <div className="flex items-center gap-2 pointer-events-auto shrink-0">
          
          {/* Индикатор дорожной обстановки флота */}
          <button
            onClick={onToggleTrafficPanel}
            title={
              showTraffic
                ? "Дорожная обстановка по рейсам флота (клик для детальной сводки по трассам)"
                : "Включить мониторинг дорожной обстановки"
            }
            className={`flex items-center gap-2 backdrop-blur-xl border rounded-2xl px-3 py-2 text-xs font-semibold shadow-xl transition-all cursor-pointer ${
              isTrafficPanelOpen
                ? "bg-orange-500/20 border-orange-500 text-orange-300 shadow-orange-500/20"
                : showTraffic
                ? "bg-[#111319]/90 border-white/[0.08] hover:border-orange-500/40 text-gray-200 hover:text-white"
                : "bg-[#111319]/60 border-white/[0.05] text-gray-500 hover:text-gray-300"
            }`}
          >
            <Car className={`h-4 w-4 ${showTraffic ? (isCritical ? "text-rose-400" : isWarning ? "text-amber-400" : "text-orange-400") : "text-gray-500"}`} />
            <span className="hidden sm:inline">Дороги</span>
            {showTraffic && (
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${trafficBadgeColor}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${trafficDotColor} ${isCritical ? "animate-ping" : ""}`} />
                {trafficLabel}
              </span>
            )}
          </button>

          {/* Маршруты Toggle */}
          <button
            onClick={onToggleRoutes}
            title={showRoutes ? "Скрыть линии маршрутов" : "Показать линии маршрутов"}
            className={`p-2.5 backdrop-blur-xl border rounded-2xl shadow-xl transition-all cursor-pointer ${
              showRoutes
                ? "bg-orange-500/20 border-orange-500/40 text-orange-400"
                : "bg-[#111319]/90 border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20"
            }`}
          >
            <Zap className="h-4 w-4" />
          </button>

          {/* Меню переключения стилей карты */}
          {onChangeTheme && (
            <div className="relative">
              <button
                onClick={() => setThemeMenuOpen(!themeMenuOpen)}
                title="Стиль карты (Тёмный / Графит / Спутник)"
                className={`p-2.5 backdrop-blur-xl border rounded-2xl shadow-xl transition-all cursor-pointer ${
                  themeMenuOpen
                    ? "bg-white/[0.12] border-white/30 text-white"
                    : "bg-[#111319]/90 border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20"
                }`}
              >
                <Layers className="h-4 w-4" />
              </button>

              {themeMenuOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-[#12141c]/98 backdrop-blur-2xl border border-white/10 rounded-2xl p-1.5 shadow-2xl z-[1100] animate-in fade-in zoom-in-95 duration-150">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 px-3 py-1.5">
                    Стиль карты
                  </div>
                  <button
                    onClick={() => {
                      onChangeTheme("dark")
                      setThemeMenuOpen(false)
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                      mapTheme === "dark"
                        ? "bg-orange-500/20 text-orange-400"
                        : "text-gray-300 hover:bg-white/[0.05]"
                    }`}
                  >
                    <span>🌒 Тёмный неон (Carto)</span>
                    {mapTheme === "dark" && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => {
                      onChangeTheme("graphite")
                      setThemeMenuOpen(false)
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                      mapTheme === "graphite"
                        ? "bg-orange-500/20 text-orange-400"
                        : "text-gray-300 hover:bg-white/[0.05]"
                    }`}
                  >
                    <span>🗺️ Графит (Esri)</span>
                    {mapTheme === "graphite" && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => {
                      onChangeTheme("satellite")
                      setThemeMenuOpen(false)
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                      mapTheme === "satellite"
                        ? "bg-orange-500/20 text-orange-400"
                        : "text-gray-300 hover:bg-white/[0.05]"
                    }`}
                  >
                    <span>🛰️ Спутник HD</span>
                    {mapTheme === "satellite" && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Список водителей */}
          <button
            onClick={onToggleDriversPanel}
            title="Список водителей флота"
            className={`relative p-2.5 backdrop-blur-xl border rounded-2xl shadow-xl transition-all cursor-pointer ${
              showDriversPanel
                ? "bg-orange-500/20 border-orange-500/40 text-orange-400"
                : "bg-[#111319]/90 border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20"
            }`}
          >
            <Users className="h-4 w-4" />
            {stats.online > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-emerald-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center shadow-lg shadow-emerald-500/40">
                {stats.online}
              </span>
            )}
          </button>

          {/* Центрировать флот / сбросить вид */}
          {onResetView && (
            <button
              onClick={onResetView}
              title="Центрировать карту по флоту"
              className="p-2.5 bg-[#111319]/90 hover:bg-[#161922] backdrop-blur-xl border border-white/[0.08] hover:border-white/20 rounded-2xl text-gray-400 hover:text-white shadow-xl transition-all cursor-pointer"
            >
              <Crosshair className="h-4 w-4" />
            </button>
          )}

          {/* Обновить данные */}
          <button
            onClick={onRefresh}
            disabled={isLoading}
            title="Обновить телеметрию"
            className="p-2.5 bg-[#111319]/90 hover:bg-[#161922] backdrop-blur-xl border border-white/[0.08] hover:border-white/20 rounded-2xl text-gray-400 hover:text-white shadow-xl transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin text-orange-400" : ""}`} />
          </button>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════
          НИЖНИЙ СТАТУС-БАР ТЕЛЕМЕТРИИ (LIVE STATUS BAR)
         ══════════════════════════════════════════════════════════════════ */}
      <footer className="absolute bottom-4 left-4 right-4 z-[900] pointer-events-none flex items-end justify-between gap-3">
        {/* Слева: Live статус и телеметрия */}
        <div className="flex items-center gap-2 bg-[#111319]/90 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-3.5 py-2 shadow-2xl pointer-events-auto">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-[10.5px] font-semibold text-gray-300 tracking-wider uppercase">
            Live
          </span>
          <span className="text-gray-600 text-xs">•</span>
          <span className="text-xs text-gray-400">
            {stats.online} водителей на связи
          </span>
          <span className="text-gray-600 text-xs hidden sm:inline">•</span>
          <span className="text-xs text-gray-500 hidden sm:inline">
            Обновлено {lastUpdate ? lastUpdate.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—"}
          </span>
        </div>

        {/* Предупреждение о базе (аккуратный Toast справа внизу, не загораживающий карту) */}
        {baseWarning && !warningDismissed && (
          <aside aria-label="Предупреждение базы" className="flex items-center gap-3 bg-[#181510]/95 backdrop-blur-xl border border-amber-500/40 text-amber-200 rounded-2xl px-4 py-2.5 shadow-2xl pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200 max-w-md">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <div className="text-xs">
              <span>{baseWarning}</span>{" "}
              <Link href="/fleet" className="font-bold underline text-amber-300 hover:text-white ml-1">
                Настроить
              </Link>
            </div>
            <button
              onClick={() => setWarningDismissed(true)}
              className="p-1 text-amber-400 hover:text-white rounded-lg transition-colors ml-auto"
              title="Закрыть уведомление"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </aside>
        )}
      </footer>
    </>
  )
}
