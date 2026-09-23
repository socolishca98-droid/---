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
  useMemo,
  useState,
  type ReactNode,
} from "react"

export interface SessionUser {
  id: string
  name: string
  email: string | null
  /** role водителя в общей таблице User существует, но штабной контекст его не использует */
  role: "admin" | "logist" | "driver"
  mustChangePassword: boolean
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

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session?kind=staff", { cache: "no-store" })
      if (!res.ok) {
        setUser(null)
        return
      }
      const data = await res.json()
      if (data?.success && data.session?.user) {
        setUser({
          id: data.session.user.id,
          name: data.session.user.name,
          email: data.session.user.email ?? null,
          role: data.session.user.role,
          mustChangePassword: Boolean(data.session.user.mustChangePassword),
        })
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error("[auth] не удалось получить сессию:", error)
      setUser(null)
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
        })
        return { ok: true, mustChangePassword: Boolean(data.user.mustChangePassword) }
      } catch (error) {
        console.error("[auth] ошибка входа:", error)
        return { ok: false, error: "Ошибка соединения. Попробуйте ещё раз" }
      }
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      // Серверный выход: сессия отзывается в БД, cookie удаляется
      await fetch("/api/auth/logout", { method: "POST" })
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
