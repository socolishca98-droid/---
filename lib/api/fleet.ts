// lib/api/fleet.ts
import { safeJsonParse, safeJsonStringify } from "@/lib/safe-json"

export interface Driver {
  id: string
  name: string
  phone: string
  vehicleId: string | null
  vehicleType: string
  vehiclePlate: string
  currentLocation: string | null
  latitude: number | null
  longitude: number | null
  lastGpsUpdate: Date | null
  status: string
  ordersCompleted: number
  rating: number
  licenseNumber: string | null
  licenseExpiry: Date | null
  medicalExpiry: Date | null
  hiredAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface Vehicle {
  id: string
  plate: string
  type: string
  brand: string | null
  model: string | null
  year: number | null
  capacity: number
  volume: number | null
  length: number | null
  width: number | null
  height: number | null
  features: string[]
  status: string
  driverId: string | null
  lastMaintenanceDate: Date | null
  nextMaintenanceDate: Date | null
  mileage: number | null
  insuranceExpiry: Date | null
  inspectionExpiry: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface FleetStats {
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

export async function fetchFleetData(): Promise<{
  drivers: Driver[]
  vehicles: Vehicle[]
  stats: FleetStats
} | null> {
  try {
    const res = await fetch("/api/fleet", {
      cache: "no-store",
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const data = await res.json()

    if (!data.success) {
      throw new Error(data.error || "Fleet fetch failed")
    }

    return {
      drivers: data.drivers || [],
      vehicles: parseVehicles(data.vehicles || []),
      stats: data.stats || {
        vehicleStats: { total: 0, available: 0, inUse: 0, maintenance: 0 },
        driverStats: { total: 0, available: 0, busy: 0, maintenance: 0, online: 0 },
        orders: { total: 0, active: 0, completedToday: 0 },
      },
    }
  } catch (error) {
    console.error("[fetchFleetData] Error:", error)
    return null
  }
}

export async function fetchDrivers(statusFilter?: string): Promise<Driver[]> {
  try {
    const url = statusFilter
      ? `/api/fleet/drivers?status=${statusFilter}`
      : "/api/fleet/drivers"

    const res = await fetch(url, { cache: "no-store" })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const data = await res.json()

    if (!data.success) {
      throw new Error(data.error || "Drivers fetch failed")
    }

    return data.drivers || []
  } catch (error) {
    console.error("[fetchDrivers] Error:", error)
    return []
  }
}

export async function fetchVehicles(params?: {
  minCapacity?: number
  status?: string
}): Promise<Vehicle[]> {
  try {
    const searchParams = new URLSearchParams()
    if (params?.minCapacity) {
      searchParams.set("minCapacity", params.minCapacity.toString())
    }
    if (params?.status) {
      searchParams.set("status", params.status)
    }

    const url = `/api/fleet/vehicles${searchParams.toString() ? `?${searchParams}` : ""}`

    const res = await fetch(url, { cache: "no-store" })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const data = await res.json()

    if (!data.success) {
      throw new Error(data.error || "Vehicles fetch failed")
    }

    return parseVehicles(data.vehicles || [])
  } catch (error) {
    console.error("[fetchVehicles] Error:", error)
    return []
  }
}

export async function createDriver(data: {
  name: string
  phone: string
  vehicleType?: string
  vehiclePlate?: string
  licenseNumber?: string
  licenseExpiry?: string
  medicalExpiry?: string
}): Promise<{ success: boolean; driver?: Driver; error?: string }> {
  try {
    const res = await fetch("/api/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })

    const result = await res.json()
    return result
  } catch (error: any) {
    console.error("[createDriver] Error:", error)
    return { success: false, error: error.message || "Failed to create driver" }
  }
}

export async function createVehicle(data: {
  plate: string
  type: string
  brand?: string
  model?: string
  year?: number
  capacity: number
  volume?: number
  length?: number
  width?: number
  height?: number
  features?: string[]
}): Promise<{ success: boolean; vehicle?: Vehicle; error?: string }> {
  try {
    // ✅ ИСПРАВЛЕНО: безопасный stringify
    const payload = {
      ...data,
      features: safeJsonStringify(data.features || []),
    }

    const res = await fetch("/api/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    const result = await res.json()

    if (result.success && result.vehicle) {
      return {
        success: true,
        vehicle: parseVehicle(result.vehicle),
      }
    }

    return result
  } catch (error: any) {
    console.error("[createVehicle] Error:", error)
    return { success: false, error: error.message || "Failed to create vehicle" }
  }
}

export async function assignDriver(
  driverId: string,
  vehicleId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch("/api/fleet/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId, vehicleId }),
    })

    return await res.json()
  } catch (error: any) {
    console.error("[assignDriver] Error:", error)
    return { success: false, error: error.message || "Failed to assign driver" }
  }
}

export async function unassignDriver(
  driverId?: string,
  vehicleId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const params = new URLSearchParams()
    if (driverId) params.set("driverId", driverId)
    if (vehicleId) params.set("vehicleId", vehicleId)

    const res = await fetch(`/api/fleet/assign?${params}`, {
      method: "DELETE",
    })

    return await res.json()
  } catch (error: any) {
    console.error("[unassignDriver] Error:", error)
    return { success: false, error: error.message || "Failed to unassign driver" }
  }
}

// ✅ ИСПРАВЛЕНО: парсинг features (строка 182)
function parseVehicle(v: any): Vehicle {
  return {
    ...v,
    features: safeJsonParse<string[]>(v.features, []),
    lastMaintenanceDate: v.lastMaintenanceDate ? new Date(v.lastMaintenanceDate) : null,
    nextMaintenanceDate: v.nextMaintenanceDate ? new Date(v.nextMaintenanceDate) : null,
    insuranceExpiry: v.insuranceExpiry ? new Date(v.insuranceExpiry) : null,
    inspectionExpiry: v.inspectionExpiry ? new Date(v.inspectionExpiry) : null,
    createdAt: new Date(v.createdAt),
    updatedAt: new Date(v.updatedAt),
  }
}

// ✅ ИСПРАВЛЕНО: парсинг массива (строка 197)
function parseVehicles(vehicles: any[]): Vehicle[] {
  return vehicles.map((v: any) => ({
    ...v,
    features: safeJsonParse<string[]>(v.features, []),
    lastMaintenanceDate: v.lastMaintenanceDate ? new Date(v.lastMaintenanceDate) : null,
    nextMaintenanceDate: v.nextMaintenanceDate ? new Date(v.nextMaintenanceDate) : null,
    insuranceExpiry: v.insuranceExpiry ? new Date(v.insuranceExpiry) : null,
    inspectionExpiry: v.inspectionExpiry ? new Date(v.inspectionExpiry) : null,
    createdAt: new Date(v.createdAt),
    updatedAt: new Date(v.updatedAt),
  }))
}

export async function updateVehicle(
  id: string,
  data: Partial<{
    plate: string
    type: string
    brand: string
    model: string
    year: number
    capacity: number
    volume: number
    length: number
    width: number
    height: number
    features: string[]
    status: string
    mileage: number
  }>
): Promise<{ success: boolean; vehicle?: Vehicle; error?: string }> {
  try {
    const payload: any = { ...data }

    // ✅ ИСПРАВЛЕНО: безопасный stringify (строка 269)
    if (data.features) {
      payload.features = safeJsonStringify(data.features)
    }

    const res = await fetch(`/api/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    const result = await res.json()

    if (result.success && result.vehicle) {
      return {
        success: true,
        vehicle: parseVehicle(result.vehicle),
      }
    }

    return result
  } catch (error: any) {
    console.error("[updateVehicle] Error:", error)
    return { success: false, error: error.message || "Failed to update vehicle" }
  }
}

export async function deleteVehicle(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/vehicles/${id}`, {
      method: "DELETE",
    })

    return await res.json()
  } catch (error: any) {
    console.error("[deleteVehicle] Error:", error)
    return { success: false, error: error.message || "Failed to delete vehicle" }
  }
}

export async function updateDriver(
  id: string,
  data: Partial<{
    name: string
    phone: string
    status: string
    vehicleType: string
    vehiclePlate: string
    licenseNumber: string
    licenseExpiry: string
    medicalExpiry: string
  }>
): Promise<{ success: boolean; driver?: Driver; error?: string }> {
  try {
    const res = await fetch(`/api/drivers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })

    return await res.json()
  } catch (error: any) {
    console.error("[updateDriver] Error:", error)
    return { success: false, error: error.message || "Failed to update driver" }
  }
}

export async function deleteDriver(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/drivers/${id}`, {
      method: "DELETE",
    })

    return await res.json()
  } catch (error: any) {
    console.error("[deleteDriver] Error:", error)
    return { success: false, error: error.message || "Failed to delete driver" }
  }
}