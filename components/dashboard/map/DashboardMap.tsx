// components/dashboard/map/DashboardMap.tsx
//
// Карта дашборда: подложка Leaflet, рейсы с анимацией, водители, точки
// загрузки/выгрузки, слой пробок и плавающие панели управления.
//
// Слои рисуются императивно через Leaflet (а не react-leaflet): карта живёт в
// одном экземпляре, слои обновляются точечно, а анимация маршрутов идёт на
// canvas внутри собственного pane — см. hooks/useRouteAnimation.ts.

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

  // Флаг, чтобы карта не «прыгала» при каждом обновлении данных
  const initialFitDone = useRef(false)

  const [showDriversList, setShowDriversList] = useState(false)
  const [showRoutes, setShowRoutes] = useState(true)
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null)

  // Слой пробок
  const [showTraffic, setShowTraffic] = useState(true)
  const [showTrafficEvents, setShowTrafficEvents] = useState(true)
  const [trafficCongestionsOnly, setTrafficCongestionsOnly] = useState(false)
  const [trafficOpacity, setTrafficOpacity] = useState(0.85)
  const [isTrafficPanelOpen, setIsTrafficPanelOpen] = useState(false)
  const [trafficInfo, setTrafficInfo] = useState<TrafficLevelInfo | null>(null)

  const { map, flyTo, fitBounds, theme, setTheme, tilesReady } = useMapInstance({
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
    trafficMock,
    problems,
  } = useMapData()

  // Цвет рейса назначаем один раз на id: при обновлении данных нить не меняет цвет
  const animationRoutes = useMemo(() => {
    return routes.map((route, index) => ({
      ...route,
      color: route.color || ROUTE_COLORS[index % ROUTE_COLORS.length],
    }))
  }, [routes])

  useRouteAnimation({ map, routes: animationRoutes, enabled: showRoutes })

  // Авто-зум — один раз при первой загрузке данных
  useEffect(() => {
    if (!map || initialFitDone.current) return
    if (drivers.length === 0 && routes.length === 0 && !base) return

    const allPoints: [number, number][] = []

    if (base?.coordinates) allPoints.push(base.coordinates)

    for (const driver of drivers) {
      if (driver.latitude && driver.longitude) allPoints.push([driver.latitude, driver.longitude])
    }

    for (const route of routes) {
      for (const waypoint of route.waypoints ?? []) {
        if (waypoint.position) allPoints.push(waypoint.position)
      }
    }

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

  const handleSelectDriver = useCallback((id: string | null) => {
    setSelectedDriver(id)
  }, [])

  // Ручной сброс вида: снимаем флаг авто-зума и возвращаемся к базе
  const handleResetView = useCallback(() => {
    initialFitDone.current = false
    if (base) {
      flyTo(base.coordinates, 10)
    } else {
      const points: [number, number][] = []
      for (const driver of drivers) {
        if (driver.latitude && driver.longitude) points.push([driver.latitude, driver.longitude])
      }
      if (points.length > 0) fitBounds(points)
    }
  }, [base, drivers, flyTo, fitBounds])

  const toggleRoutes = useCallback(() => setShowRoutes((value) => !value), [])
  const toggleDriversPanel = useCallback(() => setShowDriversList((value) => !value), [])
  const toggleTraffic = useCallback(() => setShowTraffic((value) => !value), [])
  const toggleTrafficEvents = useCallback(() => setShowTrafficEvents((value) => !value), [])
  const toggleCongestionsOnly = useCallback(
    () => setTrafficCongestionsOnly((value) => !value),
    [],
  )
  const toggleTrafficPanel = useCallback(() => setIsTrafficPanelOpen((value) => !value), [])
  const closeTrafficPanel = useCallback(() => setIsTrafficPanelOpen(false), [])
  const closeDriversPanel = useCallback(() => setShowDriversList(false), [])

  return (
        // isolate — карта живёт в собственном стековом контексте: её панели и HUD
    // (z-900…z-1100, чтобы быть выше слоёв Leaflet) не вылезают на уровень
    // страницы и не перекрывают шапку, сайдбар, диалоги и тосты.
    <div className="relative isolate h-full w-full overflow-hidden bg-[#0a0a0f]">
      <style jsx global>{mapStyles}</style>

      <div
        ref={mapContainerRef}
        // map-drawer-open — сигнал стилам карты: контролы Leaflet в правом
        // нижнем углу уезжают влево, когда панель водителей их закрывает
        className={`absolute inset-0 z-0 ${showDriversList ? "map-drawer-open" : ""}`}
      />

      {/* Мягкая подложка, пока тайлы не приехали: карта не «мигает» чёрным */}
      <div
        className={`map-tiles-veil pointer-events-none absolute inset-0 z-[1] transition-opacity duration-700 ${
          tilesReady ? "opacity-0" : "opacity-100"
        }`}
        aria-hidden="true"
      />

      {map && (
        <>
          <TrafficLayer
            map={map}
            routes={animationRoutes}
            trafficByRouteId={trafficByRouteId}
            enabled={showTraffic}
            showEvents={showTrafficEvents}
            congestionsOnly={trafficCongestionsOnly}
            opacity={trafficOpacity}
            onTrafficInfoChange={setTrafficInfo}
          />
          <BaseMarker map={map} base={base} />
          <WaypointMarkers map={map} routes={animationRoutes} enabled={showRoutes} />
          <DriverMarkers
            map={map}
            drivers={drivers}
            selectedDriverId={selectedDriver}
            onSelectDriver={handleSelectDriver}
          />
        </>
      )}

      <StatsOverlay
        base={base}
        baseWarning={baseWarning}
        geocodeProblems={problems}
        stats={stats}
        routesCount={routes.length}
        totalActiveKm={totalActiveKm}
        showRoutes={showRoutes}
        onToggleRoutes={toggleRoutes}
        onToggleDriversPanel={toggleDriversPanel}
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
        onToggleTrafficPanel={toggleTrafficPanel}
        trafficLevel={trafficInfo?.level}
        trafficInfo={trafficInfo}
      />

      <TrafficPlanningPanel
        isOpen={isTrafficPanelOpen}
        onClose={closeTrafficPanel}
        driversPanelOpen={showDriversList}
        showTraffic={showTraffic}
        onToggleTraffic={toggleTraffic}
        showEvents={showTrafficEvents}
        onToggleEvents={toggleTrafficEvents}
        congestionsOnly={trafficCongestionsOnly}
        onToggleCongestionsOnly={toggleCongestionsOnly}
        opacity={trafficOpacity}
        onChangeOpacity={setTrafficOpacity}
        trafficInfo={trafficInfo}
        trafficIsMock={trafficMock}
        onRefreshTraffic={refresh}
        activeRoutesCount={routes.length}
        onFocusLocation={handleFocusLocation}
      />

      <DriversPanel
        isOpen={showDriversList}
        onClose={closeDriversPanel}
        drivers={drivers}
        stats={stats}
        selectedDriverId={selectedDriver}
        onSelectDriver={handleSelectDriver}
        onFlyToDriver={handleFlyToDriver}
      />
    </div>
  )
}
