"use client"

// hooks/use-driver-notifications.ts
//
// Уведомления водителя. Источник правды — таблица Notification на сервере
// (GET /api/m/notifications): назначение рейса, догрузы, СОС, фото. Раньше хук
// читал только localStorage браузера, поэтому уведомления, которые уже
// создавались в базе, водитель не видел.
//
// localStorage остаётся кэшем: если сети нет, водитель видит последние
// полученные уведомления, а не пустой экран.

import { useCallback, useEffect, useMemo, useState } from "react"

export type NotificationAction =
  | { kind: "openPhoto"; status?: "loading" | "unloading" | "fueling" }
  | { kind: "openChat" }
  | { kind: "openOrder"; orderId: string }
  | { kind: "openRoute"; routeId: string }
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

/** Строка из GET /api/m/notifications. */
interface ServerNotification {
  id: string
  type: string
  title: string
  message: string
  priority?: string
  isRead: boolean
  orderId?: string | null
  routeId?: string | null
  photoId?: string | null
  sosId?: string | null
  createdAt: string
}

const POLL_INTERVAL_MS = 60_000

function getKey(driverId: string) {
  return `driver_notifications_${driverId}`
}

/** Тип уведомления на сервере → раздел интерфейса (иконка и цвет). */
function displayType(serverType: string): string {
  const type = (serverType || "").toLowerCase()
  if (type.startsWith("photo")) return "photo"
  if (type.startsWith("chat")) return "chat"
  if (type.startsWith("route")) return "route"
  if (type.startsWith("sos")) return "sos"
  return "info"
}

/** Куда ведёт нажатие: по серверным полям, без выдумывания. */
function actionFor(row: ServerNotification): NotificationAction {
  if (row.photoId) return { kind: "openPhoto" }
  if (row.orderId) return { kind: "openOrder", orderId: row.orderId }
  if (row.routeId) return { kind: "openRoute", routeId: row.routeId }
  return { kind: "info" }
}

function toDriverNotification(row: ServerNotification): DriverNotification {
  return {
    id: row.id,
    type: displayType(row.type),
    title: row.title,
    message: row.message,
    createdAt: row.createdAt,
    isRead: Boolean(row.isRead),
    action: actionFor(row),
  }
}

export function useDriverNotifications(driverId?: string | null) {
  const [notifications, setNotifications] = useState<DriverNotification[]>([])

  const readCache = useCallback((): DriverNotification[] => {
    if (!driverId || typeof window === "undefined") return []
    try {
      const raw = window.localStorage.getItem(getKey(driverId))
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? (parsed as DriverNotification[]) : []
    } catch (error) {
      console.error(error)
      return []
    }
  }, [driverId])

  const writeCache = useCallback(
    (items: DriverNotification[]) => {
      if (!driverId || typeof window === "undefined") return
      try {
        window.localStorage.setItem(getKey(driverId), JSON.stringify(items))
      } catch (error) {
        console.error(error)
      }
    },
    [driverId],
  )

  const sortDesc = (items: DriverNotification[]) =>
    [...items].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )

  /** Забрать уведомления с сервера; при неудаче остаёмся на кэше. */
  const refresh = useCallback(async () => {
    if (!driverId) return

    try {
      const res = await fetch("/api/m/notifications", { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = (await res.json()) as { success?: boolean; notifications?: ServerNotification[] }
      if (!data?.success || !Array.isArray(data.notifications)) {
        throw new Error("Некорректный ответ сервера")
      }

      const items = sortDesc(data.notifications.map(toDriverNotification))
      setNotifications(items)
      writeCache(items)
    } catch (error) {
      // сети нет или сессия истекла — показываем последнее, что знаем
      console.error("[notifications] обновление не удалось:", error)
      setNotifications(sortDesc(readCache()))
    }
  }, [driverId, readCache, writeCache])

  // загрузка + периодическое обновление
  useEffect(() => {
    if (!driverId || typeof window === "undefined") return

    setNotifications(sortDesc(readCache()))
    void refresh()

    const timer = setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)

    const onStorage = () => setNotifications(sortDesc(readCache()))
    window.addEventListener("storage", onStorage)

    return () => {
      clearInterval(timer)
      window.removeEventListener("storage", onStorage)
    }
  }, [driverId, readCache, refresh])

  /** Локальное уведомление (действие самого водителя — например, «рейс начат»). */
  const addNotification = useCallback(
    (data: Omit<DriverNotification, "id" | "createdAt" | "isRead">) => {
      if (!driverId) return

      const newItem: DriverNotification = {
        ...data,
        id: candidatesId(),
        createdAt: new Date().toISOString(),
        isRead: false,
      }

      setNotifications((prev) => {
        const next = sortDesc([newItem, ...prev])
        writeCache(next)
        return next
      })
    },
    [driverId, writeCache],
  )

  const sendAction = useCallback(
    async (payload: { action: string; id?: string }) => {
      try {
        await fetch("/api/m/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      } catch (error) {
        console.error("[notifications] не удалось сохранить на сервере:", error)
      }
    },
    [],
  )

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
        writeCache(next)
        return next
      })
      void sendAction({ action: "read", id })
    },
    [sendAction, writeCache],
  )

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, isRead: true }))
      writeCache(next)
      return next
    })
    void sendAction({ action: "readAll" })
  }, [sendAction, writeCache])

  const removeNotification = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.filter((n) => n.id !== id)
        writeCache(next)
        return next
      })
      void sendAction({ action: "remove", id })
    },
    [sendAction, writeCache],
  )

  const clearAll = useCallback(() => {
    setNotifications([])
    if (driverId) window.localStorage.removeItem(getKey(driverId))
    void sendAction({ action: "clear" })
  }, [driverId, sendAction])

  const unreadCount = useMemo(
    () => notifications.reduce((acc, n) => acc + (n.isRead ? 0 : 1), 0),
    [notifications],
  )

  return {
    notifications,
    unreadCount,
    refresh,
    addNotification,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
  }
}

/** id для локально созданного уведомления. */
function candidatesId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}
