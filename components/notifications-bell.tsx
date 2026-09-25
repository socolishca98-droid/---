"use client"

// components/notifications-bell.tsx
//
// Колокольчик уведомлений для штабных страниц: SOS от водителя, новое фото,
// просроченный платёж, догруз, завершённый рейс. Данные — GET /api/notifications,
// отметки о прочтении — POST туда же.
//
// Опрашиваем раз в минуту: чаще незачем, а сервер не должен думать, что у него
// постоянная нагрузка. При возврате на вкладку обновляем сразу.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  Bell,
  BellOff,
  Camera,
  CheckCheck,
  MessageCircle,
  Navigation,
  Trash2,
  Truck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface StaffNotification {
  id: string
  type: string
  title: string
  message: string | null
  priority?: string | null
  isRead: boolean
  createdAt: string
  orderId?: string | null
  routeId?: string | null
  photoId?: string | null
  sosId?: string | null
  driverId?: string | null
}

const POLL_MS = 60_000

function iconFor(type: string) {
  if (type.startsWith("sos")) return AlertTriangle
  if (type === "new_photo") return Camera
  if (type.startsWith("load_")) return Truck
  if (type.includes("chat") || type.includes("message")) return MessageCircle
  if (type.startsWith("route")) return Navigation
  return Bell
}

/** Куда вести по клику: у каждого типа уведомления свой экран. */
function linkFor(n: StaffNotification): string {
  if (n.sosId || n.type.startsWith("sos")) return "/drivers"
  if (n.photoId || n.type === "new_photo") return "/photos"
  if (n.routeId) return "/routes"
  if (n.orderId) return "/orders"
  if (n.type.includes("payment")) return "/payments"
  return "/dashboard"
}

function timeAgo(iso: string): string {
  const date = new Date(iso)
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000)
  if (diffMin < 1) return "только что"
  if (diffMin < 60) return `${diffMin} мин назад`
  const hours = Math.round(diffMin / 60)
  if (hours < 24) return `${hours} ч назад`
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
}

export function NotificationsBell() {
  const [items, setItems] = useState<StaffNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    if (!loadedOnce.current) setIsLoading(true)
    try {
      const res = await fetch("/api/notifications?limit=30", { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (data?.success) {
        setItems(Array.isArray(data.notifications) ? data.notifications : [])
        setUnread(Number(data.unread) || 0)
        loadedOnce.current = true
      }
    } catch {
      // молча: колокольчик не должен мешать работе страницы
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = setInterval(() => void load(), POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load])

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
    setUnread((prev) => Math.max(0, prev - 1))
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id }),
    }).catch(() => {})
  }

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
    setUnread(0)
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "readAll" }),
    }).catch(() => {})
  }

  const clearRead = async () => {
    setItems((prev) => prev.filter((n) => !n.isRead))
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    }).catch(() => {})
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Уведомления: ${unread} новых` : "Уведомления"}
          title="Уведомления"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
          <span className="text-sm font-medium">Уведомления</span>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => void markAllRead()}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Прочитать
              </Button>
            )}
            {items.some((n) => n.isRead) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground"
                onClick={() => void clearRead()}
                title="Убрать прочитанные"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea className="max-h-80">
          {isLoading && items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Загружаем…</p>
          )}

          {!isLoading && items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-3 py-8 text-muted-foreground">
              <BellOff className="h-6 w-6" />
              <span className="text-sm">Пока ничего не произошло</span>
            </div>
          )}

          {items.map((n) => {
            const Icon = iconFor(n.type)
            const isPriority = n.priority === "high"
            return (
              <Link
                key={n.id}
                href={linkFor(n)}
                onClick={() => {
                  if (!n.isRead) void markRead(n.id)
                  setIsOpen(false)
                }}
                className={cn(
                  "flex gap-3 border-b border-border/40 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-accent/60",
                  !n.isRead && "bg-accent/30",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    isPriority ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn("truncate text-sm", !n.isRead && "font-medium")}>
                      {n.title}
                    </span>
                    {!n.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                  </span>
                  {n.message && (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                      {n.message}
                    </span>
                  )}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {timeAgo(n.createdAt)}
                  </span>
                </span>
              </Link>
            )
          })}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
