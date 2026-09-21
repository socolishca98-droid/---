/**
 * Сессия водителя для мобильного контура (/m/*).
 *
 * Источник правды — httpOnly-cookie + строка Session в БД.
 * localStorage больше не используется: раньше страницы читали оттуда объект
 * «driver_session» (а одна — «driverSession», а третья — «driver_id»), то есть
 * существовало три параллельных «сессии», и любую из них можно было подделать
 * в консоли браузера.
 *
 * Хук сохраняет прежний интерфейс (driver, isLoading, isAuthenticated, login,
 * logout, updateDriver, refresh), чтобы страницы не переписывать целиком.
 */
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

// ============================================
// ТИПЫ
// ============================================

export interface DriverSession {
  id: string
  name: string
  phone?: string
  vehicleId?: string | null
  vehiclePlate?: string
  vehicleType?: string
  status?: string
  rating?: number
  ordersCompleted?: number
  latitude?: number | null
  longitude?: number | null
  lastGpsUpdate?: string | null
  licenseNumber?: string | null
  licenseExpiry?: string | null
  medicalExpiry?: string | null
  hiredAt?: string | null
}

interface UseDriverSessionOptions {
  /** Редирект на логин, если сессии нет (по умолчанию true) */
  requireAuth?: boolean
  /** Путь для редиректа (по умолчанию /m/login) */
  loginPath?: string
}

export interface LoginDriverResult {
  ok: boolean
  error?: string
  mustChangePassword?: boolean
}

interface UseDriverSessionReturn {
  driver: DriverSession | null
  isLoading: boolean
  isAuthenticated: boolean
  mustChangePassword: boolean
  login: (phone: string, password: string) => Promise<LoginDriverResult>
  logout: () => Promise<void>
  updateDriver: (updates: Partial<DriverSession>) => void
  refresh: () => Promise<void>
}

const LOGIN_PATH = "/m/login"

// ============================================
// ХУК
// ============================================

export function useDriverSession(
  options: UseDriverSessionOptions = {},
): UseDriverSessionReturn {
  const { requireAuth = true, loginPath = LOGIN_PATH } = options

  const router = useRouter()
  const [driver, setDriver] = useState<DriverSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [mustChangePassword, setMustChangePassword] = useState(false)

  const redirectToLogin = useCallback(() => {
    if (!requireAuth) return
    router.replace(loginPath)
  }, [requireAuth, loginPath, router])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session?kind=driver", { cache: "no-store" })
      if (!res.ok) {
        setDriver(null)
        redirectToLogin()
        return
      }
      const data = await res.json()
      const sessionDriver = data?.session?.driver as DriverSession | undefined
      if (!sessionDriver?.id) {
        setDriver(null)
        redirectToLogin()
        return
      }
      setDriver(sessionDriver)
      setMustChangePassword(Boolean(data.session.user?.mustChangePassword))
    } catch (error) {
      console.error("[useDriverSession] ошибка загрузки сессии:", error)
      setDriver(null)
      redirectToLogin()
    } finally {
      setIsLoading(false)
    }
  }, [redirectToLogin])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (phone: string, password: string): Promise<LoginDriverResult> => {
      try {
        const res = await fetch("/api/m/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, password }),
        })
        const data = await res.json().catch(() => ({}))

        if (!res.ok || !data?.success) {
          return { ok: false, error: data?.error || "Не удалось войти" }
        }

        setDriver(data.driver as DriverSession)
        setMustChangePassword(Boolean(data.mustChangePassword))
        setIsLoading(false)
        return { ok: true, mustChangePassword: Boolean(data.mustChangePassword) }
      } catch (error) {
        console.error("[useDriverSession] ошибка входа:", error)
        return { ok: false, error: "Ошибка соединения. Попробуйте ещё раз" }
      }
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      // Серверный выход: отзыв сессии в БД + удаление cookie
      await fetch("/api/auth/logout", { method: "POST" })
    } catch (error) {
      console.error("[useDriverSession] ошибка выхода:", error)
    } finally {
      setDriver(null)
      setMustChangePassword(false)
      router.replace(loginPath)
    }
  }, [router, loginPath])

  /** Локальное обновление данных (например, после выбора машины).
   *  Серверные данные подтягиваются через refresh(). */
  const updateDriver = useCallback((updates: Partial<DriverSession>) => {
    setDriver((prev) => (prev ? { ...prev, ...updates } : prev))
  }, [])

  const isAuthenticated = useMemo(() => Boolean(driver?.id), [driver])

  return {
    driver,
    isLoading,
    isAuthenticated,
    mustChangePassword,
    login,
    logout,
    updateDriver,
    refresh,
  }
}
