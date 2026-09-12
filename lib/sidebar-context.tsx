// lib/sidebar-context.tsx
"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safe-json"

interface SidebarContextType {
  isCollapsed: boolean
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined)

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    // ✅ ИСПРАВЛЕНО
    const saved = safeLocalStorageGet<boolean>("sidebarCollapsed", false)
    setIsCollapsed(saved)
  }, [])

  const toggle = () => {
    setIsCollapsed((prev) => {
      const newValue = !prev
      safeLocalStorageSet("sidebarCollapsed", newValue)
      return newValue
    })
  }

  return (
    <SidebarContext.Provider value={{ isCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider")
  }
  return context
}