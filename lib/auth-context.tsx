// lib/auth-context.tsx - P1-5 with silent refresh
"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react"
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-json"

export interface User {
  id: string
  name: string
  email?: string
  role: "admin" | "logist" | "driver"
  phone?: string
  status?: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  setUser: (userData: User | null) => void
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    })
    if (res.ok) {
      const data = await res.json()
      return data.success === true
    }
    return false
  } catch {
    return false
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => {
    if (typeof window !== "undefined") {
      return safeLocalStorageGet<User | null>("user", null)
    }
    return null
  })
  const [isLoading, setIsLoading] = useState(true)
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const setUser = useCallback((userData: User | null) => {
    setUserState(userData)
    if (userData) {
      safeLocalStorageSet("user", userData)
    } else if (typeof window !== "undefined") {
      localStorage.removeItem("user")
    }
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.user) {
          setUser(data.user)
          return
        }
      }
      // If /me returns 401, try silent refresh
      if (res.status === 401) {
        const refreshed = await tryRefresh()
        if (refreshed) {
          // Retry /me after refresh
          const retryRes = await fetch("/api/auth/me", { credentials: "include" })
          if (retryRes.ok) {
            const retryData = await retryRes.json()
            if (retryData.success && retryData.user) {
              setUser(retryData.user)
              return
            }
          }
        }
      }
      // If still not ok, clear user
      setUser(null)
    } catch {
      // Network error - keep existing user from localStorage
    }
  }, [setUser])

  useEffect(() => {
    refreshUser().finally(() => {
      setIsLoading(false)
    })
  }, [refreshUser])

  // P1-5: silent refresh every 14 min
  useEffect(() => {
    if (!user) return

    const scheduleRefresh = () => {
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current)
      refreshIntervalRef.current = setInterval(async () => {
        const ok = await tryRefresh()
        if (!ok) {
          // If refresh fails, try to fetch user again, if fails logout
          await refreshUser()
        }
      }, 14 * 60 * 1000) // 14 min
    }

    scheduleRefresh()

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
        refreshIntervalRef.current = null
      }
    }
  }, [user, refreshUser])

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    } catch (e) {
      console.error("Logout error:", e)
    } finally {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current)
        refreshIntervalRef.current = null
      }
      setUser(null)
      if (typeof window !== "undefined") {
        window.location.href = "/login"
      }
    }
  }, [setUser])

  return (
    <AuthContext.Provider value={{ user, isLoading, setUser, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return context
}
