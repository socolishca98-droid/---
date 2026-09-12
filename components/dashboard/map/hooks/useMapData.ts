// components/dashboard/map/hooks/useMapData.ts

import { useState, useCallback, useEffect, useRef } from "react"
import type { DriverLocation, RouteData, BaseData, DashboardStats } from "../types"
import type { LatLng, TrafficBatchResponse, TrafficRouteInfo } from "@/lib/traffic/types"

interface UseMapDataReturn {
  drivers: DriverLocation[]
  routes: RouteData[]
  base: BaseData | null
  baseWarning: string | null
  stats: DashboardStats
  totalActiveKm: number
  isLoading: boolean
  lastUpdate: Date | null
  trafficByRouteId: Record<string, TrafficRouteInfo>
  refresh: () => Promise<void>
}

const DEFAULT_STATS: DashboardStats = {
  online: 0,
  inRoute: 0,
  total: 0,
  orders: { total: 0, active: 0, completedToday: 0, newToday: 0 },
  revenue: 0,
  alerts: 0,
}

const TRAFFIC_CLIENT_MIN_INTERVAL_MS = 75_000
const TRAFFIC_MAX_POINTS = 120

function downsampleCoordinates(coords: [number, number][], maxPoints: number): [number, number][] {
  if (!Array.isArray(coords)) return []
  if (coords.length <= maxPoints) return coords
  const step = Math.ceil(coords.length / maxPoints)
  const res: [number, number][] = []
  for (let i = 0; i < coords.length; i += step) res.push(coords[i])
  if (res.length > 0 && res[res.length - 1] !== coords[coords.length - 1]) {
    res.push(coords[coords.length - 1])
  }
  return res
}

function isLatLng(x: unknown): x is LatLng {
  return (
    Array.isArray(x) &&
    x.length === 2 &&
    typeof x[0] === "number" &&
    typeof x[1] === "number" &&
    Number.isFinite(x[0]) &&
    Number.isFinite(x[1])
  )
}

export function useMapData(): UseMapDataReturn {
  const [drivers, setDrivers] = useState<DriverLocation[]>([])
  const [routes, setRoutes] = useState<RouteData[]>([])
  const [base, setBase] = useState<BaseData | null>(null)
  const [baseWarning, setBaseWarning] = useState<string | null>(null)
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS)
  const [totalActiveKm, setTotalActiveKm] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const [trafficByRouteId, setTrafficByRouteId] = useState<Record<string, TrafficRouteInfo>>({})
  const lastTrafficFetchAtRef = useRef<number>(0)

  const fetchTrafficBatch = useCallback(async (routesList: RouteData[]) => {
    const now = Date.now()
    if (now - lastTrafficFetchAtRef.current < TRAFFIC_CLIENT_MIN_INTERVAL_MS) return
    lastTrafficFetchAtRef.current = now

    const payloadRoutes = routesList
      .filter((r) => Array.isArray(r.coordinates) && r.coordinates.length >= 2)
      .map((r) => ({
        routeId: r.id,
        coordinates: downsampleCoordinates(r.coordinates, TRAFFIC_MAX_POINTS).filter(isLatLng),
      }))
      .filter((r) => r.routeId && r.coordinates.length >= 2)

    if (payloadRoutes.length === 0) return

    try {
      const res = await fetch("/api/traffic/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes: payloadRoutes }),
      })

      const data = (await res.json()) as TrafficBatchResponse
      if (data?.success && data.trafficByRouteId) {
        setTrafficByRouteId((prev) => ({ ...prev, ...data.trafficByRouteId! }))
      }
    } catch (error) {
      console.error("[useMapData] Failed to fetch traffic:", error)
    }
  }, [])

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [driversRes, routesRes] = await Promise.all([
        fetch("/api/drivers/locations"),
        fetch("/api/dashboard/routes"),
      ])

      const driversData = await driversRes.json()
      const routesData = await routesRes.json()

      if (driversData.success) {
        setDrivers(driversData.drivers || [])
        setStats(driversData.stats || DEFAULT_STATS)
      }

      if (routesData.success) {
        const routesList: RouteData[] = routesData.routes || []
        setRoutes(routesList)
        setBase(routesData.base || null)
        setBaseWarning(routesData.warning || null)

        const totalKm = routesList.reduce((sum, r) => sum + (r.totalDistance || 0), 0)
        setTotalActiveKm(totalKm)

        // не блокируем основной UI — трафик отдельно и редко
        void fetchTrafficBatch(routesList)
      }

      setLastUpdate(new Date())
    } catch (error) {
      console.error("[useMapData] Failed to fetch:", error)
    } finally {
      setIsLoading(false)
    }
  }, [fetchTrafficBatch])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [fetchData])

  return {
    drivers,
    routes,
    base,
    baseWarning,
    stats,
    totalActiveKm,
    isLoading,
    lastUpdate,
    trafficByRouteId,
    refresh: fetchData,
  }
}