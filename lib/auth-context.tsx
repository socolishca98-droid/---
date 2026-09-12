// lib/auth-context.tsx
"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-json"

export interface User {
  id: string
  name: string
  role: "admin" | "logist" | "driver"
  phone?: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (userData: User) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // ✅ ИСПРАВЛЕНО: безопасное чтение из localStorage
    const savedUser = safeLocalStorageGet<User | null>("user", null)
    if (savedUser) {
      setUser(savedUser)
    }
    setIsLoading(false)
  }, [])

  const login = (userData: User) => {
    setUser(userData)
    // ✅ ИСПРАВЛЕНО: безопасная запись
    safeLocalStorageSet("user", userData)
  }

  const logout = () => {
    setUser(null)
    if (typeof window !== "undefined") {
      localStorage.removeItem("user")
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
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