// lib/auth-context.tsx
"use client"

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react"
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => {
    if (typeof window !== "undefined") {
      return safeLocalStorageGet<User | null>("user", null)
    }
    return null
  })
  const [isLoading, setIsLoading] = useState(true)

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
      const res = await fetch("/api/auth/me")
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.user) {
          setUser(data.user)
          return
        }
      }
    } catch {
      // Игнорируем сетевые ошибки при первой загрузке
    }
  }, [setUser])

  useEffect(() => {
    // При монтировании проверяем серверную сессию
    refreshUser().finally(() => {
      setIsLoading(false)
    })
  }, [refreshUser])

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch (e) {
      console.error("Logout error:", e)
    } finally {
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
