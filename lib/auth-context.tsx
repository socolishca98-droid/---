/**
 * Контекст авторизации сотрудника (admin / logist).
 *
 * Источник правды — серверная сессия (httpOnly-cookie + строка Session в БД),
 * а не localStorage: раньше «вход» просто клал объект пользователя в браузер,
 * из-за чего доступ получал любой, кто откроет консоль.
 *
 * useAuth() возвращает данные текущего пользователя, isLoading и методы
 * login / logout / refresh.
 */
"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { clearPhotoQueue } from "@/lib/offline/photo-queue"
import { classifySessionStatus, retryDelayMs } from "@/lib/auth/refresh-policy"

export interface SessionUser {
  id: string
  name: string
  email: string | null
  /** role водителя в общей таблице User существует, но штабной контекст его не использует */
  role: "admin" | "logist" | "driver"
  mustChangePassword: boolean
  /** Организация пользователя. Приходит с сервера из сессии, не из клиента. */
  organization: { id: string; name: string | null } | null
}

export interface LoginResult {
  ok: boolean
  error?: string
  mustChangePassword?: boolean
}

interface AuthContextType {
  user: SessionUser | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<LoginResult>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Проверка сессии сотрудника.
   *
   * Раньше любой не-2xx (в том числе разовый 429 или 500) обнулял пользователя:
   * логиста выбрасывало из кабинета при живой сессии. Теперь состояние
   * сохраняется, а запрос повторяется с паузой; выход — только по 401/403.
   */
  const refresh = useCallback(async (attempt = 0): Promise<void> => {
    try {
      const res = await fetch("/api/auth/session?kind=staff", { cache: "no-store" })
      const outcome = classifySessionStatus(res.status)

      if (outcome === "unauthorized") {
        setUser(null)
        return
      }

      if (outcome === "transient") {
        throw new Error(`сервер ответил ${res.status}`)
      }

      const data = await res.json()
      if (data?.success && data.session?.user) {
        setUser({
          id: data.session.user.id,
          name: data.session.user.name,
          email: data.session.user.email ?? null,
          role: data.session.user.role,
          mustChangePassword: Boolean(data.session.user.mustChangePassword),
          organization: data.session.organization
            ? {
                id: data.session.organization.id,
                name: data.session.organization.name ?? null,
              }
            : null,
        })
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error("[auth] сессия не проверена, повтор:", error)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(() => {
        void refresh(attempt + 1)
      }, retryDelayMs(attempt))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
        const data = await res.json().catch(() => ({}))

        if (!res.ok || !data?.success) {
          return { ok: false, error: data?.error || "Не удалось войти" }
        }

        setUser({
          id: data.user.id,
          name: data.user.name,
          email: data.user.email ?? null,
          role: data.user.role,
          mustChangePassword: Boolean(data.user.mustChangePassword),
          // ответ входа организацию не содержит — дочитываем из сессии
          organization: null,
        })
        void refresh()
        return { ok: true, mustChangePassword: Boolean(data.user.mustChangePassword) }
      } catch (error) {
        console.error("[auth] ошибка входа:", error)
        return { ok: false, error: "Ошибка соединения. Попробуйте ещё раз" }
      }
    },
    [refresh],
  )

  const logout = useCallback(async () => {
    try {
      // Серверный выход: сессия отзывается в БД, cookie удаляется
      await fetch("/api/auth/logout", { method: "POST" })
      // Неотправленные фото из очереди не должны уходить от имени следующего
      await clearPhotoQueue()
    } catch (error) {
      console.error("[auth] ошибка выхода:", error)
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      login,
      logout,
      refresh,
    }),
    [user, isLoading, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return context
}
