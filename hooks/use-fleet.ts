// hooks/use-fleet.ts

import { useState, useEffect, useCallback } from "react"

interface FleetStats {
  vehicleStats: {
    total: number
    available: number
    inUse: number
    maintenance: number
  }
  driverStats: {
    total: number
    available: number
    busy: number
    maintenance: number
    online: number
  }
  orders: {
    total: number
    active: number
    completedToday: number
  }
}

interface FleetData {
  drivers: any[]
  vehicles: any[]
  stats: FleetStats | null
}

export function useFleet() {
  const [data, setData] = useState<FleetData>({
    drivers: [],
    vehicles: [],
    stats: null,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/fleet")
      const json = await res.json()
      if (!json.success) {
        throw new Error(json.error || "Failed to load fleet")
      }

      setData({
        drivers: json.drivers || [],
        vehicles: json.vehicles || [],
        stats: json.stats || null,
      })
    } catch (e: any) {
      console.error("useFleet error:", e)
      setError(e.message || "Unknown error")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const addDriver = async (driverData: any) => {
    const res = await fetch("/api/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(driverData),
    })
    const result = await res.json()
    if (!result.success) throw new Error(result.error)
    await fetchAll()
    // result.driver — карточка; result.credentials — временный пароль для входа
    // в приложение водителя (показывается один раз); result.warning — если учётку
    // создать не удалось
    return result
  }

  const deleteDriver = async (id: string) => {
    const res = await fetch(`/api/drivers/${id}`, { method: "DELETE" })
    const result = await res.json()
    if (!result.success) throw new Error(result.error)
    await fetchAll()
  }

  const addVehicle = async (vehicleData: any) => {
    const res = await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vehicleData),
    })
    const result = await res.json()
    if (!result.success) throw new Error(result.error)
    await fetchAll()
    return result.vehicle
  }

  const deleteVehicle = async (id: string) => {
    const res = await fetch(`/api/vehicles/${id}`, { method: "DELETE" })
    const result = await res.json()
    if (!result.success) throw new Error(result.error)
    await fetchAll()
  }

  const getAvailableVehicles = async () => {
    return data.vehicles.filter((v) => v.status === "available" && !v.driverId)
  }

  return {
    drivers: data.drivers,
    vehicles: data.vehicles,
    stats: data.stats,
    isLoading,
    error,
    refresh: fetchAll,
    addDriver,
    deleteDriver,
    addVehicle,
    deleteVehicle,
    getAvailableVehicles,
  }
}