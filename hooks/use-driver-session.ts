// hooks/use-driver-session.ts

"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-json"

// ============================================
// ТИПЫ
// ============================================

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
  /** Редирект на логин если нет сессии (по умолчанию true) */
  requireAuth?: boolean
  /** Путь для редиректа (по умолчанию /m/login) */
  loginPath?: string
}

interface UseDriverSessionReturn {
  /** Данные водителя или null */
  driver: DriverSession | null
  /** Идёт загрузка сессии */
  isLoading: boolean
  /** Авторизован ли пользователь */
  isAuthenticated: boolean
  /** Сохранить сессию водителя */
  login: (driver: DriverSession) => void
  /** Удалить сессию */
  logout: () => void
  /** Обновить данные водителя */
  updateDriver: (updates: Partial<DriverSession>) => void
  /** Перезагрузить данные с сервера */
  refresh: () => Promise<void>
}

// ============================================
// КОНСТАНТЫ
// ============================================

const STORAGE_KEY = "driver_session"
const LOGIN_PATH = "/m/login"

// ============================================
// ХУК
// ============================================

export function useDriverSession(
  options: UseDriverSessionOptions = {}
): UseDriverSessionReturn {
  const { requireAuth = true, loginPath = LOGIN_PATH } = options

  const router = useRouter()
  const [driver, setDriver] = useState<DriverSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Загрузка сессии из localStorage при монтировании
  useEffect(() => {
    const loadSession = () => {
      try {
        // Безопасное чтение из localStorage
        const savedDriver = safeLocalStorageGet<DriverSession | null>(
          STORAGE_KEY,
          null
        )

        // Валидация: должен быть объект с id
        if (savedDriver && typeof savedDriver === "object" && savedDriver.id) {
          setDriver(savedDriver)
        } else if (requireAuth) {
          // Нет валидной сессии - редирект на логин
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

  // Сохранение сессии
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

  // Выход
  const logout = useCallback(() => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY)
        // Очищаем также старые ключи для совместимости
        localStorage.removeItem("driver_id")
        localStorage.removeItem("driver_name")
      }
      setDriver(null)
      router.replace(loginPath)
    } catch (error) {
      console.error("[useDriverSession] Error during logout:", error)
    }
  }, [router, loginPath])

  // Обновление данных водителя
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

  // Перезагрузка данных с сервера
  const refresh = useCallback(async () => {
    if (!driver?.id) return

    try {
      const response = await fetch(`/api/drivers/${driver.id}`)
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
  }, [driver?.id])

  // Мемоизированное значение isAuthenticated
  const isAuthenticated = useMemo(() => {
    return (
      driver !== null && typeof driver.id === "string" && driver.id.length > 0
    )
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

// ============================================
// ДОПОЛНИТЕЛЬНЫЕ УТИЛИТЫ
// ============================================

/**
 * Получить ID водителя без хука (для API-вызовов вне компонентов)
 */
export function getDriverId(): string | null {
  if (typeof window === "undefined") return null

  const session = safeLocalStorageGet<DriverSession | null>(STORAGE_KEY, null)
  return session?.id ?? null
}

/**
 * Проверить наличие сессии (для middleware/guards)
 */
export function hasDriverSession(): boolean {
  if (typeof window === "undefined") return false

  const session = safeLocalStorageGet<DriverSession | null>(STORAGE_KEY, null)
  return session !== null && typeof session.id === "string"
}