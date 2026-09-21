// components/dashboard/map/panels/TrafficPlanningPanel.tsx

"use client"

import React, { useState } from "react"
import {
  Car,
  AlertTriangle,
  Clock,
  Sliders,
  RefreshCw,
  X,
  Layers,
  ChevronRight,
  ShieldAlert,
  Info,
  Route,
  CheckCircle2,
  AlertOctagon,
  Sparkles,
} from "lucide-react"
import type { TrafficLevelInfo } from "../layers/TrafficLayer"

interface TrafficPlanningPanelProps {
  isOpen: boolean
  onClose: () => void
  showTraffic: boolean
  onToggleTraffic: () => void
  showEvents: boolean
  onToggleEvents: () => void
  congestionsOnly?: boolean
  onToggleCongestionsOnly?: () => void
  opacity: number
  onChangeOpacity: (value: number) => void
  trafficInfo: TrafficLevelInfo | null
  onRefreshTraffic: () => void
  activeRoutesCount: number
  onFocusLocation?: (coords: [number, number], zoom?: number) => void
}

export function TrafficPlanningPanel({
  isOpen,
  onClose,
  showTraffic,
  onToggleTraffic,
  showEvents,
  onToggleEvents,
  congestionsOnly = false,
  onToggleCongestionsOnly,
  opacity,
  onChangeOpacity,
  trafficInfo,
  onRefreshTraffic,
  activeRoutesCount,
  onFocusLocation,
}: TrafficPlanningPanelProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "bottlenecks" | "incidents">("overview")
  const [showExplanation, setShowExplanation] = useState(true)

  if (!isOpen) return null

  const status = trafficInfo?.status || "normal"
  const isCritical = status === "critical"
  const isWarning = status === "warning"
  const isNormal = status === "normal"

  const riskScore = trafficInfo?.riskScore ?? (isCritical ? 75 : isWarning ? 35 : 5)
  const totalDelayMinutes = trafficInfo?.totalDelayMinutes ?? 0
  const accidentsCount = trafficInfo?.accidentsCount ?? 0
  const closuresCount = trafficInfo?.closuresCount ?? 0
  const jamsCount = trafficInfo?.jamsCount ?? 0

  const arterials = trafficInfo?.arterials || []
  const incidents = trafficInfo?.incidents || []
  const congestedArterials = arterials.filter((a) => a.severity === "critical" || a.severity === "heavy" || a.delayMinutes > 0)

  // Цвета плашки общего статуса
  const statusBadge = isCritical
    ? {
        border: "border-rose-500/40",
        bg: "bg-gradient-to-br from-rose-500/15 via-rose-950/20 to-transparent",
        scoreBg: "bg-rose-500/20 text-rose-300 border-rose-500/40",
        dot: "bg-rose-400",
        title: "Критический дорожный риск",
        desc: "На маршрутах флота зафиксированы ДТП и перекрытия трасс. График доставки нарушен.",
      }
    : isWarning
    ? {
        border: "border-amber-500/40",
        bg: "bg-gradient-to-br from-amber-500/15 via-amber-950/20 to-transparent",
        scoreBg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
        dot: "bg-amber-400",
        title: "Задержки на участках трасс",
        desc: "Зафиксированы локальные заторы на федеральных трассах. Ожидается умеренное отставание.",
      }
    : {
        border: "border-emerald-500/40",
        bg: "bg-gradient-to-br from-emerald-500/15 via-emerald-950/20 to-transparent",
        scoreBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
        dot: "bg-emerald-400",
        title: "Все рейсы следуют в графике",
        desc: "Критических пробок и ДТП по траекториям автомобилей не обнаружено.",
      }

  return (
    <div
      id="traffic-planning-panel"
      className="absolute top-18 right-4 z-[1050] w-[420px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)] flex flex-col bg-[#10121a]/98 backdrop-blur-2xl border border-white/[0.08] rounded-2xl shadow-2xl text-white animate-in fade-in slide-in-from-top-3 duration-200 overflow-hidden"
    >
      {/* ══════════════════════════════════════════════════════════════════
          ШАПКА ПАНЕЛИ
         ══════════════════════════════════════════════════════════════════ */}
      <div className="p-4 border-b border-white/[0.08] flex items-center justify-between shrink-0 bg-[#0c0e14]">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl border ${statusBadge.scoreBg} shadow-lg`}>
            {isCritical ? (
              <AlertOctagon className="h-4 w-4 text-rose-400" />
            ) : isWarning ? (
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            ) : (
              <Car className="h-4 w-4 text-emerald-400" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-white">Дорожная обстановка флота</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
                Трассы РФ
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Контроль задержек и ДТП по маршрутам между областями
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Закрыть панель"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ВКЛАДКИ НАВИГАЦИИ
         ══════════════════════════════════════════════════════════════════ */}
      <div className="flex border-b border-white/[0.06] bg-[#0c0e14]/80 text-xs font-medium shrink-0 p-1.5 gap-1">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex-1 py-2 px-3 rounded-xl text-center transition-all cursor-pointer ${
            activeTab === "overview"
              ? "bg-white/[0.08] text-orange-400 font-bold shadow-sm"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Сводка флота
        </button>
        <button
          onClick={() => setActiveTab("bottlenecks")}
          className={`flex-1 py-2 px-3 rounded-xl text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === "bottlenecks"
              ? "bg-white/[0.08] text-orange-400 font-bold shadow-sm"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          <span>Заторы</span>
          {congestedArterials.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500/20 text-rose-300 font-bold">
              {congestedArterials.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("incidents")}
          className={`flex-1 py-2 px-3 rounded-xl text-center transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === "incidents"
              ? "bg-white/[0.08] text-orange-400 font-bold shadow-sm"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          <span>ДТП / Перекрытия</span>
          {incidents.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500/25 text-rose-300 font-bold animate-pulse">
              {incidents.length}
            </span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ТЕЛО ПАНЕЛИ
         ══════════════════════════════════════════════════════════════════ */}
      <div className="p-4 overflow-y-auto custom-scrollbar flex-1 space-y-3.5 text-sm">
        {/* ВКЛАДКА 1: СВОДКА */}
        {activeTab === "overview" && (
          <>
            {/* Карточка статуса риска флота */}
            <div className={`p-4 rounded-2xl border ${statusBadge.border} ${statusBadge.bg} transition-all`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2.5 h-2.5 rounded-full ${statusBadge.dot} ${isCritical ? "animate-ping" : ""}`} />
                    <span className="font-bold text-sm text-white">{statusBadge.title}</span>
                  </div>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {statusBadge.desc}
                  </p>
                </div>
                <div className={`px-2.5 py-1.5 rounded-xl border font-bold text-xs shrink-0 ${statusBadge.scoreBg} text-center`}>
                  <div className="text-base leading-none font-extrabold">{riskScore}%</div>
                  <div className="text-[9px] uppercase tracking-wider opacity-80 mt-0.5">риск</div>
                </div>
              </div>

              {/* Метрики в 3 колонки */}
              <div className="grid grid-cols-3 gap-2 mt-3.5 pt-3 border-t border-white/[0.06]">
                <div className="bg-[#151722]/80 p-2.5 rounded-xl border border-white/[0.04] text-center">
                  <span className="text-[10px] text-gray-400 block font-medium">Отставание</span>
                  <span className={`text-xs font-bold mt-0.5 block ${totalDelayMinutes > 0 ? "text-rose-400" : "text-emerald-400"}`}>
                    {totalDelayMinutes > 0 ? `+${totalDelayMinutes} мин` : "0 мин"}
                  </span>
                </div>
                <div className="bg-[#151722]/80 p-2.5 rounded-xl border border-white/[0.04] text-center">
                  <span className="text-[10px] text-gray-400 block font-medium">В рейсах</span>
                  <span className="text-xs font-bold text-gray-200 mt-0.5 block">
                    {activeRoutesCount} маш.
                  </span>
                </div>
                <div className="bg-[#151722]/80 p-2.5 rounded-xl border border-white/[0.04] text-center">
                  <span className="text-[10px] text-gray-400 block font-medium">ДТП / Работы</span>
                  <span className={`text-xs font-bold mt-0.5 block ${incidents.length > 0 ? "text-amber-400" : "text-gray-400"}`}>
                    {incidents.length} соб.
                  </span>
                </div>
              </div>
            </div>

            {/* БЛОК ОБЪЯСНЕНИЯ ДЛЯ ЧЕГО НУЖНА ЭТА ШКАЛА */}
            <div className="p-3.5 rounded-2xl bg-[#141620] border border-white/[0.06] text-xs text-gray-300">
              <button
                onClick={() => setShowExplanation(!showExplanation)}
                className="w-full flex items-center justify-between text-left font-semibold text-gray-200 cursor-pointer"
              >
                <div className="flex items-center gap-2 text-orange-400">
                  <Info className="h-4 w-4 shrink-0" />
                  <span className="text-xs font-bold text-white">Для чего нужна эта шкала логисту?</span>
                </div>
                <span className="text-[10px] text-gray-400 font-normal">
                  {showExplanation ? "Свернуть" : "Подробнее"}
                </span>
              </button>

              {showExplanation && (
                <div className="mt-2.5 text-[11px] text-gray-300 leading-relaxed space-y-2 border-t border-white/[0.04] pt-2.5 animate-in fade-in duration-150">
                  <p>
                    <strong className="text-white">Почему не баллы отдельного города?</strong> Логистическая программа обслуживает междугородние перевозки в разных областях (Москва, Владимир, Тверь, СПб и др.). Городской балл пробок одного мегаполиса бессмысленен для междугороднего тягача.
                  </p>
                  <p>
                    <strong className="text-orange-300">Индекс дорожного риска автопарка</strong> суммирует обстановку <span className="text-white font-medium">строго по трассам ваших автомобилей</span>. Он выявляет узкие места (М-10, М-7, М-4, ЦКАД), находит ДТП с перекрытием полос и мгновенно прогнозирует срыв временных окон разгрузки.
                  </p>
                </div>
              )}
            </div>

            {/* НАСТРОЙКИ СЛОЕВ НА КАРТЕ */}
            <div className="space-y-3 pt-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Отображение на карте
              </div>

              {/* Заторы по маршрутам */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#141620] border border-white/[0.05]">
                <div className="flex items-center gap-2.5">
                  <Route className="h-4 w-4 text-orange-400 shrink-0" />
                  <div className="text-xs">
                    <span className="font-semibold text-gray-200 block">
                      Пробки только по маршрутам
                    </span>
                    <span className="text-[10px] text-gray-400">
                      Подсвечивает участки сильных заторов (ruby/coral)
                    </span>
                  </div>
                </div>
                <button
                  onClick={onToggleTraffic}
                  className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                    showTraffic ? "bg-orange-500" : "bg-white/[0.1]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      showTraffic ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Маркеры ДТП и перекрытий */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#141620] border border-white/[0.05]">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                  <div className="text-xs">
                    <span className="font-semibold text-gray-200 block">
                      Маркеры ДТП и перекрытий
                    </span>
                    <span className="text-[10px] text-gray-400">
                      Точечные значки происшествий (💥 и ⛔) на трассах
                    </span>
                  </div>
                </div>
                <button
                  onClick={onToggleEvents}
                  className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none cursor-pointer ${
                    showEvents ? "bg-orange-500" : "bg-white/[0.1]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      showEvents ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Ползунок прозрачности */}
              <div className="p-2.5 rounded-xl bg-[#141620] border border-white/[0.05]">
                <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                  <span className="flex items-center gap-1.5 font-medium text-gray-300">
                    <Sliders className="h-3.5 w-3.5 text-orange-400" />
                    Яркость линий пробок
                  </span>
                  <span className="font-bold text-white text-xs">
                    {Math.round(opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.3"
                  max="1"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => onChangeOpacity(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-white/[0.1] rounded-lg appearance-none cursor-pointer accent-orange-500"
                />
              </div>
            </div>
          </>
        )}

        {/* ВКЛАДКА 2: ЗАТОРЫ НА ТРАССАХ */}
        {activeTab === "bottlenecks" && (
          <div className="space-y-2">
            <div className="text-xs text-gray-400 mb-2">
              Участки замедления движения на активных рейсах:
            </div>
            {congestedArterials.length === 0 ? (
              <div className="p-6 rounded-2xl bg-[#141620] border border-white/[0.05] text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2 opacity-90" />
                <span className="text-xs font-semibold text-gray-200 block">
                  Заторов на маршрутах нет
                </span>
                <span className="text-[11px] text-gray-400 mt-1 block">
                  Все транспортные средства движутся с расчетной скоростью
                </span>
              </div>
            ) : (
              congestedArterials.map((arterial) => {
                const isCrit = arterial.severity === "critical"
                const isHvy = arterial.severity === "heavy"

                return (
                  <div
                    key={arterial.id}
                    onClick={() => {
                      if (onFocusLocation && arterial.coordinates[0]) {
                        onFocusLocation(arterial.coordinates[0], 13)
                      }
                    }}
                    className="p-3 rounded-xl bg-[#141620] border border-white/[0.06] hover:border-orange-500/40 cursor-pointer transition-all flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-white truncate">
                          {arterial.name}
                        </span>
                        {arterial.delayMinutes > 0 && (
                          <span className="text-[10px] font-bold text-rose-300 bg-rose-500/20 border border-rose-500/30 px-1.5 py-0.2 rounded shrink-0">
                            +{arterial.delayMinutes} мин
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-1">
                        <span>Скорость: <strong className="text-gray-200">{arterial.speed} км/ч</strong></span>
                        <span>•</span>
                        <span className="truncate">{arterial.status}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-semibold text-orange-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                        На карте <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* ВКЛАДКА 3: ДТП И ПЕРЕКРЫТИЯ */}
        {activeTab === "incidents" && (
          <div className="space-y-2">
            <div className="text-xs text-gray-400 mb-2">
              События, требующие оперативного реагирования диспетчера:
            </div>
            {incidents.length === 0 ? (
              <div className="p-6 rounded-2xl bg-[#141620] border border-white/[0.05] text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2 opacity-90" />
                <span className="text-xs font-semibold text-gray-200 block">
                  Инцидентов не зафиксировано
                </span>
                <span className="text-[11px] text-gray-400 mt-1 block">
                  Перекрытых дорог и аварий на трассах следования нет
                </span>
              </div>
            ) : (
              incidents.map((inc) => {
                const isAcc = inc.type === "accident"
                return (
                  <div
                    key={inc.id}
                    onClick={() => {
                      if (onFocusLocation && inc.location) {
                        onFocusLocation(inc.location, 14)
                      }
                    }}
                    className="p-3.5 rounded-xl bg-[#141620] border border-white/[0.06] hover:border-orange-500/40 cursor-pointer transition-all group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">
                          {isAcc ? "💥" : "⛔"}
                        </span>
                        <span className="font-semibold text-xs text-white">
                          {inc.title}
                        </span>
                      </div>
                      {inc.delayMinutes > 0 && (
                        <span className="text-[10px] font-bold text-rose-300 bg-rose-500/20 border border-rose-500/30 px-1.5 py-0.2 rounded shrink-0">
                          +{inc.delayMinutes} мин
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-300 mt-2 leading-relaxed">
                      {inc.description}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mt-2.5 pt-2 border-t border-white/[0.04]">
                      <span>{inc.lane ? `Полоса: ${inc.lane}` : "Федеральная трасса"}</span>
                      <span className="text-orange-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-1 font-semibold">
                        Приблизить на карте <ChevronRight className="h-3 w-3" />
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          ПОДВАЛ
         ══════════════════════════════════════════════════════════════════ */}
      <div className="p-3 border-t border-white/[0.08] flex items-center justify-between text-xs text-gray-400 shrink-0 bg-[#0c0e14]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] text-gray-400">Синхронизация трасс: Live</span>
        </div>
        <button
          onClick={onRefreshTraffic}
          className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 font-semibold px-2 py-1 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Обновить данные</span>
        </button>
      </div>
    </div>
  )
}
