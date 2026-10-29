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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { clearPhotoQueue } from "@/lib/offline/photo-queue"
import { classifySessionStatus, retryDelayMs } from "@/lib/auth/refresh-policy"

// ============================================
// ТИПЫ
// ============================================

/**
 * Последний известный ответ проверки сессии водителя — на время жизни вкладки.
 *
 * Проверка идёт в базу (1.4 с на тёплом сервере, до 8 с на холодном), и каждый
 * экран /m/* ждал её с пустым местом. Кэш на 60 секунд показывает экран сразу;
 * сервер всё равно проверяет сессию на каждом запросе, поэтому права не
 * расширяются — кэш влияет только на то, что видно до ответа.
 */
const SESSION_TTL_MS = 60_000
let cachedDriverSession: { at: number; driver: any; mustChange: boolean } | null = null

/** Сбросить кэш — после выхода водителя. */
export function resetDriverSessionCache(): void {
  cachedDriverSession = null
}

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
  refresh: (attempt?: number) => Promise<void>
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

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Проверка сессии.
   *
   * Разовый 429/500 или обрыв сети больше не выбрасывает водителя на экран
   * входа: состояние сохраняется, запрос повторяется с паузой. Выход — только
   * когда сервер прямо сказал, что сессии нет (401/403).
   */
  const refresh = useCallback(
    async (attempt = 0): Promise<void> => {
      try {
        // Свежий кэш — показываем сразу, сеть не ждём
        if (cachedDriverSession && Date.now() - cachedDriverSession.at < SESSION_TTL_MS) {
          setDriver(cachedDriverSession.driver)
          setMustChangePassword(cachedDriverSession.mustChange)
          setIsLoading(false)
          return
        }
        const res = await fetch("/api/auth/session?kind=driver", { cache: "no-store" })
        const outcome = classifySessionStatus(res.status)

        if (outcome === "unauthorized") {
          cachedDriverSession = null
          setDriver(null)
          setMustChangePassword(false)
          redirectToLogin()
          return
        }

        if (outcome === "transient") {
          throw new Error(`сервер ответил ${res.status}`)
        }

        const data = await res.json()
        const sessionDriver = data?.session?.driver as DriverSession | undefined
        if (!sessionDriver?.id) {
          setDriver(null)
          setMustChangePassword(false)
          redirectToLogin()
          return
        }

        cachedDriverSession = {
          at: Date.now(),
          driver: sessionDriver,
          mustChange: Boolean(data.session.user?.mustChangePassword),
        }
        setDriver(sessionDriver)
        setMustChangePassword(Boolean(data.session.user?.mustChangePassword))
      } catch (error) {
        // Временная ошибка: сессию не трогаем, пробуем ещё раз
        console.error("[useDriverSession] сессия не проверена, повтор:", error)
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(() => {
          void refresh(attempt + 1)
        }, retryDelayMs(attempt))
      } finally {
        setIsLoading(false)
      }
    },
    [redirectToLogin],
  )

  useEffect(() => {
    void refresh()
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
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
      // Неотправленные фото не должны уходить от имени следующего пользователя
      await clearPhotoQueue()
    } catch (error) {
      console.error("[useDriverSession] ошибка выхода:", error)
    } finally {
      cachedDriverSession = null
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
