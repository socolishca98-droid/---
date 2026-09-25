// hooks/use-fleet.ts
//
// Автопарк (машины, водители, сводка) — один запрос /api/fleet на страницу.
//
// Данные идут через клиентский кеш: переход «Автопарк → Водители → снова
// Автопарк» рисуется сразу из памяти и тихо обновляется в фоне. После
// изменений (добавили машину, удалили водителя) кеш принудительно сбрасывается,
// чтобы в списке не осталось старого состояния.
//
// Важно: все функции возвращаются стабильными (useCallback). Иначе эффект
// страницы вида `useEffect(..., [getAvailableVehicles])` перезапускался бы на
// каждом рендере и зацикливал перерисовку при открытом диалоге.

import { useCallback } from "react"

import { invalidateCache, useCachedJson } from "@/lib/client-cache"

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

interface FleetPayload {
  success?: boolean
  drivers?: unknown[]
  vehicles?: unknown[]
  stats?: FleetStats | null
  error?: string
}

const FLEET_URL = "/api/fleet"

// Пустые массивы-константы: ссылка не меняется между рендерами,
// значит и зависящие от неё колбэки остаются стабильными
const NO_DRIVERS: any[] = []
const NO_VEHICLES: any[] = []

export function useFleet() {
  const { data, isLoading, isRevalidating, error, reload } = useCachedJson<FleetPayload>(FLEET_URL)

  const drivers = (data?.drivers ?? NO_DRIVERS) as any[]
  const vehicles = (data?.vehicles ?? NO_VEHICLES) as any[]
  const stats = (data?.stats ?? null) as FleetStats | null

  /** Обновление после изменения: сбрасываем кеш и перезапрашиваем. */
  const fetchAll = useCallback(async () => {
    invalidateCache(FLEET_URL)
    // Машина ушла в рейс или водитель сменил статус — справочник водителей
    // (его читают чат, фото и страница «Водители») тоже стал неактуален
    invalidateCache("/api/drivers")
    await reload({ force: true })
  }, [reload])

  const addDriver = useCallback(
    async (driverData: any) => {
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
    },
    [fetchAll],
  )

  const deleteDriver = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/drivers/${id}`, { method: "DELETE" })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)
      await fetchAll()
    },
    [fetchAll],
  )

  const addVehicle = useCallback(
    async (vehicleData: any) => {
      const res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vehicleData),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)
      await fetchAll()
      return result.vehicle
    },
    [fetchAll],
  )

  const deleteVehicle = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/vehicles/${id}`, { method: "DELETE" })
      const result = await res.json()
      if (!result.success) throw new Error(result.error)
      await fetchAll()
    },
    [fetchAll],
  )

  const getAvailableVehicles = useCallback(async () => {
    // машина свободна, если за ней не закреплён водитель
    // (связь хранится в Driver.vehicleId; driverId в ответе — производное поле)
    return vehicles.filter((v) => v.status === "available" && !v.driver && !v.driverId)
  }, [vehicles])

  return {
    drivers,
    vehicles,
    stats,
    isLoading,
    isRevalidating,
    error,
    refresh: fetchAll,
    addDriver,
    deleteDriver,
    addVehicle,
    deleteVehicle,
    getAvailableVehicles,
  }
}
