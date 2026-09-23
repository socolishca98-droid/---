"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  Camera,
  MessageCircle,
  Navigation,
  Info,
  Trash2,
  CheckCheck,
  Bell,
  BellOff,
} from "lucide-react"
import { useDriverNotifications } from "@/hooks/use-driver-notifications"
import { toast } from "sonner"

interface DriverSession {
  id: string
  name: string
}

export default function DriverNotificationsPage() {
  const router = useRouter()
  const [driver, setDriver] = useState<DriverSession | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem("driver_session")
    if (!saved) {
      router.push("/m/login")
      return
    }

    try {
      const parsed = JSON.parse(saved) as DriverSession
      if (!parsed?.id) throw new Error("Invalid session")
      setDriver(parsed)
    } catch {
      localStorage.removeItem("driver_session")
      router.push("/m/login")
    }
  }, [router])

  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
  } = useDriverNotifications(driver?.id)

  const hasNotifications = notifications.length > 0

  const sortedNotifications = useMemo(
    () =>
      [...notifications].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [notifications]
  )

  const handleNotificationPress = (id: string) => {
    const n = notifications.find((x: any) => x.id === id)
    if (!n) return

    markAsRead(id)

    const action = n.action
    if (!action) return

    if (action.kind === "openPhoto") {
      router.push(`/m/photo${action.status ? `?context=${action.status}` : ""}`)
    } else if (action.kind === "openChat") {
      router.push("/m/chat")
    } else if (action.kind === "openOrder" && action.orderId) {
      router.push(`/m/orders/${action.orderId}`)
    }
  }

  const handleClearAll = () => {
    if (confirm("Удалить все уведомления?")) {
      clearAll()
      toast.success("Уведомления очищены")
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""

    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Только что"
    if (diffMins < 60) return `${diffMins} мин назад`
    if (diffHours < 24) return `${diffHours} ч назад`
    if (diffDays < 7) return `${diffDays} дн назад`

    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    })
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "photo":
        return <Camera className="h-5 w-5 text-orange-400" />
      case "chat":
        return <MessageCircle className="h-5 w-5 text-blue-400" />
      case "route":
        return <Navigation className="h-5 w-5 text-emerald-400" />
      default:
        return <Info className="h-5 w-5 text-gray-400" />
    }
  }

  const getNotificationColor = (type: string) => {
    switch (type) {
      case "photo":
        return "bg-orange-500/10 border-orange-500/20"
      case "chat":
        return "bg-blue-500/10 border-blue-500/20"
      case "route":
        return "bg-emerald-500/10 border-emerald-500/20"
      default:
        return "bg-gray-500/10 border-gray-500/20"
    }
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-8">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="h-5 w-5 text-gray-400" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold">Уведомления</h1>
            <p className="text-xs text-gray-500">
              {unreadCount > 0
                ? `${unreadCount} непрочитанных`
                : "Все прочитаны"}
            </p>
          </div>
        </div>

        {/* Действия */}
        {hasNotifications && (
          <div className="px-4 pb-3 flex items-center gap-2">
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[#151518] border border-gray-800 hover:border-gray-700 text-gray-300 transition-colors"
            >
              <CheckCheck className="h-4 w-4" />
              Прочитать все
            </button>
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 text-red-400 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Очистить
            </button>
          </div>
        )}
      </header>

      <main className="p-4">
        {!hasNotifications ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 rounded-2xl bg-gray-800/50 flex items-center justify-center mb-4">
              <BellOff className="h-10 w-10 text-gray-600" />
            </div>
            <p className="text-gray-400 font-medium mb-1">Нет уведомлений</p>
            <p className="text-gray-600 text-sm text-center max-w-xs">
              Здесь будут появляться напоминания о фото, сообщения и обновления
              по рейсам
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedNotifications.map((n: any) => {
              const isUnread = !n.isRead

              return (
                <button
                  key={n.id}
                  onClick={() => handleNotificationPress(n.id)}
                  className={`w-full text-left rounded-2xl p-4 border transition-all active:scale-[0.99] ${
                    isUnread
                      ? getNotificationColor(n.type)
                      : "bg-[#151518] border-gray-800 hover:border-gray-700"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Иконка */}
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        isUnread ? "bg-white/5" : "bg-gray-800"
                      }`}
                    >
                      {getNotificationIcon(n.type)}
                    </div>

                    {/* Контент */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p
                          className={`font-semibold truncate ${
                            isUnread ? "text-white" : "text-gray-300"
                          }`}
                        >
                          {n.title}
                        </p>
                        <span className="text-[11px] text-gray-500 flex-shrink-0">
                          {formatTime(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 line-clamp-2">
                        {n.message}
                      </p>
                    </div>

                    {/* Индикатор непрочитанного */}
                    {isUnread && (
                      <div className="w-2.5 h-2.5 rounded-full bg-orange-500 flex-shrink-0 mt-2" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}