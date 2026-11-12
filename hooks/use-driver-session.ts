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
import { toast } from "sonner"

import { clearPhotoQueue } from "@/lib/offline/photo-queue"
import { classifySessionResponse, retryDelayMs } from "@/lib/auth/refresh-policy"
import { DRIVER_KICK_REASON_KEY } from "@/lib/auth/constants"

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

/**
 * Идущая прямо сейчас проверка сессии водителя.
 *
 * На одном экране хук вызывают несколько компонентов, и до этого кэша они
 * успевали сделать 4–6 одинаковых запросов, каждый со своим «загрузка».
 */
let inFlightDriverSession: Promise<{ driver: any; mustChange: boolean } | null> | null = null

/** и39: сообщение о пароле хостинга показывается один раз за жизнь страницы. */
let protectionWarned = false

/** Сбросить кэш — после выхода водителя. */
export function resetDriverSessionCache(): void {
  cachedDriverSession = null
  inFlightDriverSession = null
}

/** Один запрос проверки сессии на всех, кому он нужен в эту секунду. */
/**
 * Почему последняя проверка сессии провалилась (reason из 401, и31).
 * Показывается на экране входа — человек (и владелец платформы при
 * разборе инцидента) видит причину, а не «просто выкинуло».
 */
let lastSessionFailReason: string | null = null

function loadDriverSession(): Promise<{ driver: any; mustChange: boolean } | null> {
  if (inFlightDriverSession) return inFlightDriverSession

  const request = (async () => {
    const res = await fetch("/api/auth/session?kind=driver", { cache: "no-store" })
    const outcome = classifySessionResponse(res)
    // Разовая ошибка сервера или лимит запросов — не повод выбрасывать
    // водителя на экран входа: наверху refresh повторит попытку с паузой
    if (outcome === "transient") {
      // и39: хостинг (Vercel Deployment Protection) перехватил запрос и
      // просит пароль защиты деплоя — системный диалог рисует браузер, до
      // приложения он не доходит. Если промолчать, это выглядит как
      // «выкинуло без причины». Называем виновника вслух — один раз.
      if (res.status === 401 && res.headers.get("www-authenticate") != null && !protectionWarned) {
        protectionWarned = true
        toast.error(
          "Сайт требует пароль хостинга (Vercel Protection) — это настройка хостинга, а не сбой входа. Отключите: Vercel → проект → Settings → Deployment Protection → Disable",
          { duration: 15000 },
        )
      }
      throw new Error(`сервер ответил ${res.status}`)
    }
    if (outcome !== "ok") {
      const failure = (await res.json().catch(() => null)) as { reason?: string } | null
      lastSessionFailReason = failure?.reason ?? null
      return null
    }

    const data = await res.json()
    const sessionDriver = data?.session?.driver as DriverSession | undefined
    if (!sessionDriver?.id) {
      // и35: этот уход на вход раньше был единственным без причины —
      // 200-й ответ без данных водителя тоже объясняем на экране входа
      lastSessionFailReason = "session_without_driver"
      return null
    }

    return { driver: sessionDriver, mustChange: Boolean(data.session.user?.mustChangePassword) }
  })().finally(() => {
    inFlightDriverSession = null
  })

  inFlightDriverSession = request
  return request
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
    // Причину смерти сессии несём на экран входа: там она превращается
    // в понятную надпись, а не исчезает вместе с редиректом.
    // Причину НЕ обнуляем после первого редиректа: на /m хук используют
    // несколько компонентов, и второй редирект (без причины) затирал
    // параметр первого — надпись так и не появлялась.
    // и36: дублируем в sessionStorage — кнопка «назад» и кэш страницы
    // возвращают URL без параметров, а заметка переживать это должна.
    if (lastSessionFailReason) {
      try {
        sessionStorage.setItem(DRIVER_KICK_REASON_KEY, lastSessionFailReason)
      } catch {}
    }
    const suffix = lastSessionFailReason
      ? `?reason=${encodeURIComponent(lastSessionFailReason)}`
      : ""
    router.replace(`${loginPath}${suffix}`)
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
        const session = await loadDriverSession()

        if (!session) {
          cachedDriverSession = null
          setDriver(null)
          setMustChangePassword(false)
          redirectToLogin()
          return
        }

        cachedDriverSession = { at: Date.now(), driver: session.driver, mustChange: session.mustChange }
        setDriver(session.driver)
        setMustChangePassword(session.mustChange)
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
      inFlightDriverSession = null
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
