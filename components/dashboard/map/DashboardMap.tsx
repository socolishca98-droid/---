// components/dashboard/map/DashboardMap.tsx

"use client"

import { useRef, useState, useCallback, useEffect, useMemo } from "react"
import "leaflet/dist/leaflet.css"

// Hooks
import { useMapInstance } from "./hooks/useMapInstance"
import { useMapData } from "./hooks/useMapData"
import { useRouteAnimation } from "./hooks/useRouteAnimation"

// Layers
import { BaseMarker } from "./layers/BaseMarker"
import { WaypointMarkers } from "./layers/WaypointMarkers"
import { DriverMarkers } from "./layers/DriverMarkers"
import { TrafficLayer, type TrafficLevelInfo } from "./layers/TrafficLayer"

// Panels
import { DriversPanel } from "./panels/DriversPanel"
import { StatsOverlay } from "./panels/StatsOverlay"
import { TrafficPlanningPanel } from "./panels/TrafficPlanningPanel"

// Styles & Constants
import { mapStyles } from "./styles"
import { ROUTE_COLORS } from "./constants"

export default function DashboardMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  
  // Флаг, чтобы карта не прыгала при каждом обновлении данных
  const initialFitDone = useRef(false)

  const [showDriversList, setShowDriversList] = useState(false)
  const [showRoutes, setShowRoutes] = useState(true)
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null)

  // Яндекс.Пробки состояние
  const [showTraffic, setShowTraffic] = useState(true)
  const [showTrafficEvents, setShowTrafficEvents] = useState(true)
  const [trafficCongestionsOnly, setTrafficCongestionsOnly] = useState(false)
  const [trafficOpacity, setTrafficOpacity] = useState(0.85)
  const [isTrafficPanelOpen, setIsTrafficPanelOpen] = useState(false)
  const [trafficInfo, setTrafficInfo] = useState<TrafficLevelInfo | null>(null)

  const { map, canvasRef, flyTo, fitBounds, theme, setTheme } = useMapInstance({
    containerRef: mapContainerRef,
  })

  const {
    drivers,
    routes,
    base,
    baseWarning,
    stats,
    totalActiveKm,
    isLoading,
    lastUpdate,
    refresh,
    trafficByRouteId,
  } = useMapData()

  // Подготавливаем данные для анимации, добавляя цвета
  const animationRoutes = useMemo(() => {
    return routes.map((route, index) => ({
      ...route,
      color: (route as any).color || ROUTE_COLORS[index % ROUTE_COLORS.length]
    }))
  }, [routes])

  useRouteAnimation({
    canvasRef,
    map,
    routes: animationRoutes,
    enabled: showRoutes,
    trafficByRouteId,
  })

  // Авто-зум срабатывает ТОЛЬКО один раз при первой загрузке данных
  useEffect(() => {
    if (!map || initialFitDone.current) return
    if (drivers.length === 0 && routes.length === 0 && !base) return

    const allPoints: [number, number][] = []
    
    if (base?.coordinates) {
      allPoints.push(base.coordinates)
    }
    
    drivers.forEach((d) => {
      if (d.latitude && d.longitude) {
        allPoints.push([d.latitude, d.longitude])
      }
    })
    
    routes.forEach((r) => {
      r.waypoints?.forEach((wp) => {
        if (wp.position) {
          allPoints.push(wp.position)
        }
      })
    })

    if (allPoints.length > 0) {
      fitBounds(allPoints)
      initialFitDone.current = true
    }
  }, [map, base, drivers, routes, fitBounds])

  const handleFlyToBase = useCallback(() => {
    if (base) flyTo(base.coordinates, 14)
  }, [base, flyTo])

  const handleFlyToDriver = useCallback(
    (lat: number, lng: number) => {
      flyTo([lat, lng], 15)
    },
    [flyTo],
  )

  const handleFocusLocation = useCallback(
    (coords: [number, number], zoom = 13) => {
      flyTo(coords, zoom)
    },
    [flyTo],
  )

  // Принимает string | null для совместимости с DriversPanel
  const handleSelectDriver = useCallback((id: string | null) => {
    setSelectedDriver(id)
  }, [])

  // Кнопка для ручного сброса вида
  const handleResetView = useCallback(() => {
    initialFitDone.current = false
    if (base) {
      flyTo(base.coordinates, 10)
    }
  }, [base, flyTo])

  return (
    <div className="relative h-full w-full bg-[#0a0a0f] overflow-hidden">
      <style jsx global>{mapStyles}</style>

      <div ref={mapContainerRef} className="h-full w-full z-0" />

      {/* Canvas layer для анимации маршрутов */}
      <canvas 
        ref={canvasRef}
        className="absolute inset-0 z-10 pointer-events-none"
        style={{ mixBlendMode: "screen" }}
      />

      {map && (
        <>
          {/* Слой пробок строго по маршрутам (только сильные заторы, перекрытия и ДТП) */}
          <TrafficLayer
            map={map}
            routes={animationRoutes}
            trafficByRouteId={trafficByRouteId}
            enabled={showTraffic}
            showEvents={showTrafficEvents}
            opacity={trafficOpacity}
            onTrafficInfoChange={setTrafficInfo}
          />
          <BaseMarker map={map} base={base} />
          <WaypointMarkers map={map} routes={animationRoutes} enabled={showRoutes} />
          <DriverMarkers
            map={map}
            drivers={drivers}
            selectedDriverId={selectedDriver}
            onSelectDriver={(id: string) => handleSelectDriver(id)}
          />
        </>
      )}

      <StatsOverlay
        base={base}
        baseWarning={baseWarning}
        stats={stats}
        routesCount={routes.length}
        totalActiveKm={totalActiveKm}
        showRoutes={showRoutes}
        onToggleRoutes={() => setShowRoutes(!showRoutes)}
        onToggleDriversPanel={() => setShowDriversList(!showDriversList)}
        showDriversPanel={showDriversList}
        isLoading={isLoading}
        lastUpdate={lastUpdate}
        onRefresh={refresh}
        onFlyToBase={handleFlyToBase}
        onResetView={handleResetView}
        mapTheme={theme}
        onChangeTheme={setTheme}
        showTraffic={showTraffic}
        isTrafficPanelOpen={isTrafficPanelOpen}
        onToggleTrafficPanel={() => setIsTrafficPanelOpen(!isTrafficPanelOpen)}
        trafficLevel={trafficInfo?.level}
        trafficInfo={trafficInfo}
      />

      {/* Панель планирования с учетом Яндекс.Пробок */}
      <TrafficPlanningPanel
        isOpen={isTrafficPanelOpen}
        onClose={() => setIsTrafficPanelOpen(false)}
        showTraffic={showTraffic}
        onToggleTraffic={() => setShowTraffic(!showTraffic)}
        showEvents={showTrafficEvents}
        onToggleEvents={() => setShowTrafficEvents(!showTrafficEvents)}
        congestionsOnly={trafficCongestionsOnly}
        onToggleCongestionsOnly={() => setTrafficCongestionsOnly(!trafficCongestionsOnly)}
        opacity={trafficOpacity}
        onChangeOpacity={setTrafficOpacity}
        trafficInfo={trafficInfo}
        onRefreshTraffic={refresh}
        activeRoutesCount={routes.length}
        onFocusLocation={handleFocusLocation}
      />

      <DriversPanel
        isOpen={showDriversList}
        onClose={() => setShowDriversList(false)}
        drivers={drivers}
        stats={stats}
        selectedDriverId={selectedDriver}
        onSelectDriver={handleSelectDriver}
        onFlyToDriver={handleFlyToDriver}
      />
    </div>
  )
}