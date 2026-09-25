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
  const isMountedRef = useRef(true)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const fetchTrafficBatch = useCallback(async (routesList: RouteData[], signal?: AbortSignal) => {
    const now = Date.now()
    if (now - lastTrafficFetchAtRef.current < TRAFFIC_CLIENT_MIN_INTERVAL_MS) return
    lastTrafficFetchAtRef.current = now

    const payloadRoutes = routesList
      .filter((r: any) => Array.isArray(r.coordinates) && r.coordinates.length >= 2)
      .map((r: any) => ({
        routeId: r.id,
        coordinates: downsampleCoordinates(r.coordinates, TRAFFIC_MAX_POINTS).filter(isLatLng),
      }))
      .filter((r: any) => r.routeId && r.coordinates.length >= 2)

    if (payloadRoutes.length === 0) return

    try {
      const res = await fetch("/api/traffic/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes: payloadRoutes }),
        signal: signal || AbortSignal.timeout(10000),
      })

      if (!res.ok) return

      const data = (await res.json().catch(() => null)) as TrafficBatchResponse | null
      if (isMountedRef.current && data?.success && data.trafficByRouteId) {
        setTrafficByRouteId((prev) => ({ ...prev, ...data.trafficByRouteId! }))
      }
    } catch (error: any) {
      if (error?.name === "AbortError") return
      console.warn("[useMapData] Traffic batch update notice:", error?.message || error)
    }
  }, [])

  const fetchData = useCallback(async () => {
    if (!isMountedRef.current) return
    setIsLoading(true)

    // Прерываем предыдущий активный запрос при новом вызове
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    // Таймаут безопасности 12 секунд
    const timeoutId = setTimeout(() => {
      try {
        controller.abort()
      } catch {
        // ignore
      }
    }, 12000)

    try {
      const [driversSettled, routesSettled] = await Promise.allSettled([
        fetch("/api/drivers/locations", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        }),
        fetch("/api/dashboard/routes", {
          signal: controller.signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        }),
      ])

      clearTimeout(timeoutId)

      if (!isMountedRef.current) return

      // Обработка данных водителей
      if (driversSettled.status === "fulfilled" && driversSettled.value?.success) {
        const dData = driversSettled.value
        setDrivers(dData.drivers || [])
        setStats(dData.stats || DEFAULT_STATS)
      } else if (driversSettled.status === "rejected") {
        const reason = driversSettled.reason
        if (reason?.name !== "AbortError") {
          console.warn("[useMapData] Drivers sync notice:", reason?.message || reason)
        }
      }

      // Обработка маршрутов
      if (routesSettled.status === "fulfilled" && routesSettled.value?.success) {
        const rData = routesSettled.value
        const routesList: RouteData[] = rData.routes || []
        setRoutes(routesList)
        setBase(rData.base || null)
        setBaseWarning(rData.warning || null)

        const totalKm = routesList.reduce((sum: any, r: any) => sum + (r.totalDistance || 0), 0)
        setTotalActiveKm(totalKm)

        // не блокируем основной UI — трафик отдельно
        void fetchTrafficBatch(routesList, controller.signal)
      } else if (routesSettled.status === "rejected") {
        const reason = routesSettled.reason
        if (reason?.name !== "AbortError") {
          console.warn("[useMapData] Routes sync notice:", reason?.message || reason)
        }
      }

      setLastUpdate(new Date())
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        console.warn("[useMapData] Background fetch note:", error?.message || error)
      }
    } finally {
      clearTimeout(timeoutId)
      if (isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [fetchTrafficBatch])

  useEffect(() => {
    fetchData()
    const interval = setInterval(() => {
      // опрашиваем только если страница видима
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return
      }
      fetchData()
    }, 15000)
    return () => {
      clearInterval(interval)
    }
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