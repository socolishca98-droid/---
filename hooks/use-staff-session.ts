// hooks/use-staff-session.ts
//
// Сессия сотрудника (admin/logist) для мобильного контура /lm/*.
//
// Полный аналог hooks/use-driver-session.ts, но работает с штабной сессией:
// источник правды — httpOnly-cookie + строка Session в БД, локального
// хранилища нет (подделать из консоли браузера нечего).
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { classifySessionStatus, retryDelayMs } from "@/lib/auth/refresh-policy"

export interface StaffUser {
  id: string
  name: string
  email: string | null
  phone?: string | null
  role: string
  mustChangePassword: boolean
}

export interface StaffOrganization {
  id: string
  name: string
}

interface UseStaffSessionOptions {
  /** Редирект на вход, если сессии нет (по умолчанию true) */
  requireAuth?: boolean
}

interface UseStaffSessionReturn {
  user: StaffUser | null
  organization: StaffOrganization | null
  isLoading: boolean
  isAuthenticated: boolean
  mustChangePassword: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const LOGIN_PATH = "/login?next=/lm"

export function useStaffSession(options: UseStaffSessionOptions = {}): UseStaffSessionReturn {
  const { requireAuth = true } = options
  const router = useRouter()

  const [user, setUser] = useState<StaffUser | null>(null)
  const [organization, setOrganization] = useState<StaffOrganization | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/auth/session?kind=staff", { cache: "no-store" })
      const outcome = classifySessionStatus(res.status)

      if (outcome === "unauthorized") {
        setUser(null)
        setOrganization(null)
        if (requireAuth) router.replace(LOGIN_PATH)
        return
      }

      const data = await res.json()
      const sessionUser = data?.session?.user as StaffUser | undefined
      if (!sessionUser?.id) {
        setUser(null)
        setOrganization(null)
        if (requireAuth) router.replace(LOGIN_PATH)
        return
      }

      setUser(sessionUser)
      setOrganization((data?.session?.organization as StaffOrganization | undefined) ?? null)
    } catch (error) {
      // Обрыв сети на телефоне — не повод разлогинивать: пробуем ещё раз
      console.error("[useStaffSession] сессия не проверена, повтор:", error)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(() => void refresh(), retryDelayMs(0))
    } finally {
      setIsLoading(false)
    }
  }, [requireAuth, router])

  useEffect(() => {
    void refresh()
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch (error) {
      console.error("[useStaffSession] ошибка выхода:", error)
    } finally {
      setUser(null)
      setOrganization(null)
      router.replace("/login")
    }
  }, [router])

  const isAuthenticated = useMemo(() => Boolean(user?.id), [user])

  return {
    user,
    organization,
    isLoading,
    isAuthenticated,
    mustChangePassword: Boolean(user?.mustChangePassword),
    refresh,
    logout,
  }
}
