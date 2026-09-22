// hooks/use-driver-session.ts - P1-5 with silent refresh

"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-json"

export interface DriverSession {
  id: string
  name: string
  phone?: string
  vehicleId?: string
  vehiclePlate?: string
  vehicleType?: string
  status?: string
  rating?: number
  ordersCompleted?: number
}

interface UseDriverSessionOptions {
  requireAuth?: boolean
  loginPath?: string
}

interface UseDriverSessionReturn {
  driver: DriverSession | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (driver: DriverSession) => void
  logout: () => void
  updateDriver: (updates: Partial<DriverSession>) => void
  refresh: () => Promise<void>
}

const STORAGE_KEY = "driver_session"
const LOGIN_PATH = "/m/login"

export function useDriverSession(
  options: UseDriverSessionOptions = {}
): UseDriverSessionReturn {
  const { requireAuth = true, loginPath = LOGIN_PATH } = options

  const router = useRouter()
  const [driver, setDriver] = useState<DriverSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadSession = () => {
      try {
        const savedDriver = safeLocalStorageGet<DriverSession | null>(STORAGE_KEY, null)
        if (savedDriver && typeof savedDriver === "object" && savedDriver.id) {
          setDriver(savedDriver)
        } else if (requireAuth) {
          router.replace(loginPath)
        }
      } catch (error) {
        console.error("[useDriverSession] Error loading session:", error)
        if (requireAuth) {
          router.replace(loginPath)
        }
      } finally {
        setIsLoading(false)
      }
    }
    loadSession()
  }, [requireAuth, loginPath, router])

  const login = useCallback((newDriver: DriverSession) => {
    if (!newDriver?.id) {
      console.error("[useDriverSession] Invalid driver data for login")
      return
    }
    const success = safeLocalStorageSet(STORAGE_KEY, newDriver)
    if (success) {
      setDriver(newDriver)
    } else {
      console.error("[useDriverSession] Failed to save session")
    }
  }, [])

  const logout = useCallback(() => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem("driver_id")
        localStorage.removeItem("driver_name")
      }
      setDriver(null)
      router.replace(loginPath)
    } catch (error) {
      console.error("[useDriverSession] Error during logout:", error)
    }
  }, [router, loginPath])

  const updateDriver = useCallback(
    (updates: Partial<DriverSession>) => {
      if (!driver) return
      const updatedDriver = { ...driver, ...updates }
      const success = safeLocalStorageSet(STORAGE_KEY, updatedDriver)
      if (success) {
        setDriver(updatedDriver)
      }
    },
    [driver]
  )

  const tryDriverRefresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/m/refresh", { method: "POST", credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        return data.success === true
      }
      return false
    } catch {
      return false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!driver?.id) return
    try {
      let response = await fetch(`/api/drivers/${driver.id}`, { credentials: "include" })
      if (response.status === 401) {
        const ok = await tryDriverRefresh()
        if (ok) {
          response = await fetch(`/api/drivers/${driver.id}`, { credentials: "include" })
        }
      }
      const data = await response.json()
      if (data.success && data.driver) {
        const refreshedDriver: DriverSession = {
          id: data.driver.id,
          name: data.driver.name,
          phone: data.driver.phone,
          vehicleId: data.driver.vehicleId,
          vehiclePlate: data.driver.vehiclePlate,
          vehicleType: data.driver.vehicleType,
          status: data.driver.status,
          rating: data.driver.rating,
          ordersCompleted: data.driver.ordersCompleted,
        }
        const success = safeLocalStorageSet(STORAGE_KEY, refreshedDriver)
        if (success) {
          setDriver(refreshedDriver)
        }
      }
    } catch (error) {
      console.error("[useDriverSession] Error refreshing driver:", error)
    }
  }, [driver?.id, tryDriverRefresh])

  useEffect(() => {
    if (!driver) return
    const interval = setInterval(async () => {
      await tryDriverRefresh()
    }, 14 * 60 * 1000)
    return () => clearInterval(interval)
  }, [driver, tryDriverRefresh])

  const isAuthenticated = useMemo(() => {
    return driver !== null && typeof driver.id === "string" && driver.id.length > 0
  }, [driver])

  return {
    driver,
    isLoading,
    isAuthenticated,
    login,
    logout,
    updateDriver,
    refresh,
  }
}

export function getDriverId(): string | null {
  if (typeof window === "undefined") return null
  const session = safeLocalStorageGet<DriverSession | null>(STORAGE_KEY, null)
  return session?.id ?? null
}

export function hasDriverSession(): boolean {
  if (typeof window === "undefined") return false
  const session = safeLocalStorageGet<DriverSession | null>(STORAGE_KEY, null)
  return session !== null && typeof session.id === "string"
}
