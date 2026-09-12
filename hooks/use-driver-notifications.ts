"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

export type NotificationAction =
  | { kind: "openPhoto"; status?: "loading" | "unloading" | "fueling" }
  | { kind: "openChat" }
  | { kind: "openOrder"; orderId: string }
  | { kind: "info" }

export interface DriverNotification {
  id: string
  type: string
  title: string
  message: string
  createdAt: string
  isRead: boolean
  action?: NotificationAction
}

function getKey(driverId: string) {
  return `driver_notifications_${driverId}`
}

export function useDriverNotifications(driverId?: string | null) {
  const [notifications, setNotifications] = useState<DriverNotification[]>([])

  // загрузка
  useEffect(() => {
    if (!driverId || typeof window === "undefined") return

    const load = () => {
      try {
        const raw = window.localStorage.getItem(getKey(driverId))
        if (raw) {
          const parsed = JSON.parse(raw) as unknown
          if (Array.isArray(parsed)) {
            const sorted = [...parsed].sort(
              (a: any, b: any) =>
                new Date(b?.createdAt).getTime() - new Date(a?.createdAt).getTime(),
            )
            setNotifications(sorted as DriverNotification[])
          } else {
            setNotifications([])
          }
        } else {
          setNotifications([])
        }
      } catch (e) {
        console.error(e)
        setNotifications([])
      }
    }

    load()

    window.addEventListener("storage", load)
    return () => window.removeEventListener("storage", load)
  }, [driverId])

  const addNotification = useCallback(
    (data: Omit<DriverNotification, "id" | "createdAt" | "isRead">) => {
      if (!driverId) return

      const newItem: DriverNotification = {
        ...data,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        isRead: false,
      }

      setNotifications((prev) => {
        const next = [newItem, ...prev]
        window.localStorage.setItem(getKey(driverId), JSON.stringify(next))
        return next
      })
    },
    [driverId],
  )

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
        if (driverId) window.localStorage.setItem(getKey(driverId), JSON.stringify(next))
        return next
      })
    },
    [driverId],
  )

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, isRead: true }))
      if (driverId) window.localStorage.setItem(getKey(driverId), JSON.stringify(next))
      return next
    })
  }, [driverId])

  const removeNotification = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.filter((n) => n.id !== id)
        if (driverId) window.localStorage.setItem(getKey(driverId), JSON.stringify(next))
        return next
      })
    },
    [driverId],
  )

  const clearAll = useCallback(() => {
    setNotifications([])
    if (driverId) window.localStorage.removeItem(getKey(driverId))
  }, [driverId])

  const unreadCount = useMemo(
    () => notifications.reduce((acc, n) => acc + (n.isRead ? 0 : 1), 0),
    [notifications],
  )

  return {
    notifications,
    unreadCount,
    addNotification,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
  }
}