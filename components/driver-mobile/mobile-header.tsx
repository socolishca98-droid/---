"use client"

import { useDriverSession } from "@/hooks/use-driver-session"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Truck, Bell, LogOut, Wifi, WifiOff, Cloud } from "lucide-react"
import { useEffect, useState } from "react"
import { getPhotoQueue } from "@/lib/offline/photo-queue"

interface MobileHeaderProps {
  notificationCount?: number
}

export function MobileHeader({ notificationCount = 0 }: MobileHeaderProps) {
  // Шапка мобильного контура: сессия водителя, а не штабного пользователя
  const { driver, logout } = useDriverSession({ requireAuth: false })
  const [isOnline, setIsOnline] = useState(true)
  const [pendingUploads, setPendingUploads] = useState(0)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine)
      const handleOnline = () => setIsOnline(true)
      const handleOffline = () => setIsOnline(false)
      window.addEventListener("online", handleOnline)
      window.addEventListener("offline", handleOffline)
      return () => {
        window.removeEventListener("online", handleOnline)
        window.removeEventListener("offline", handleOffline)
      }
    }
  }, [])

  useEffect(() => {
    // Настоящая очередь: фото, которые не ушли из-за связи, лежат в IndexedDB
    // и уходят сами. Показываем их число — водитель видит, что чек не потерян.
    const queue = getPhotoQueue()
    if (!queue) return

    let unsubscribe: (() => void) | undefined
    let cancelled = false

    queue.pendingCount().then((count) => {
      if (!cancelled) setPendingUploads(count)
    })

    const unsubscribeUploaded = queue.onUploaded(async () => {
      const count = await queue.pendingCount()
      setPendingUploads(count)
    })

    unsubscribe = queue.subscribe((items) => setPendingUploads(items.length))

    return () => {
      cancelled = true
      unsubscribe?.()
      unsubscribeUploaded()
    }
  }, [])

  const handleLogout = async () => {
    // Серверный выход: отзыв сессии в БД + удаление cookie + редирект на /m/login
    await logout()
  }

  return (
    <header className="sticky top-0 z-50 bg-background border-b border-border">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Truck className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sm">{driver?.name || "Водитель"}</p>
            <div className="flex items-center gap-2">
              {isOnline ? (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Wifi className="h-3 w-3" />
                  Онлайн
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <WifiOff className="h-3 w-3" />
                  Офлайн
                </span>
              )}
              {pendingUploads > 0 && (
                <span
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                  title="Фото ждут связи и загрузятся сами"
                >
                  <Cloud className="h-3 w-3" />
                  {pendingUploads}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="relative h-10 w-10">
            <Bell className="h-5 w-5" />
            {notificationCount > 0 && (
              <Badge className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-xs bg-primary">
                {notificationCount}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={handleLogout}
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {!isOnline && (
        <div className="bg-amber-500/10 border-t border-amber-500/20 px-3 py-2">
          <p className="text-xs text-amber-600 text-center">
            Нет подключения. Фото сохранятся и отправятся автоматически.
          </p>
        </div>
      )}
    </header>
  )
}