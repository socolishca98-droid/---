// components/chat/chat-list.tsx

"use client"

import type { ChatMessage } from "@/lib/types"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { AlertTriangle, ImageIcon, MapPin, Flame } from "lucide-react"

interface Driver {
  id: string
  name: string
  phone: string
  status: string
  currentLocation?: string
}

interface ChatListProps {
  drivers: Driver[]
  messages: ChatMessage[]
  selectedDriverId: string | null
  onSelectDriver: (driverId: string) => void
}

export function ChatList({ drivers, messages, selectedDriverId, onSelectDriver }: ChatListProps) {
  // Get last message and unread count for each driver
  const getDriverChatInfo = (driverId: string) => {
    const driverMessages = messages.filter((m: any) => m.senderId === driverId || m.recipientId === driverId
    )
    const lastMessage = driverMessages[driverMessages.length - 1]
    const unreadCount = driverMessages.filter((m: any) => m.senderId === driverId && !m.isRead
    ).length
    const hasImportant = driverMessages.some((m: any) => m.senderId === driverId && !m.isRead && m.isImportant
    )
    return { lastMessage, unreadCount, hasImportant }
  }

  // Сортируем: важные сверху, потом по времени
  const sortedDrivers = [...drivers].sort((a, b) => {
    const infoA = getDriverChatInfo(a.id)
    const infoB = getDriverChatInfo(b.id)
    
    // Важные сообщения в приоритете
    if (infoA.hasImportant && !infoB.hasImportant) return -1
    if (!infoA.hasImportant && infoB.hasImportant) return 1
    
    // Потом по времени последнего сообщения
    const timeA = infoA.lastMessage?.createdAt || new Date(0)
    const timeB = infoB.lastMessage?.createdAt || new Date(0)
    return new Date(timeB).getTime() - new Date(timeA).getTime()
  })

  return (
    <div className="space-y-1">
      {sortedDrivers.map((driver: any) => {
        const { lastMessage, unreadCount, hasImportant } = getDriverChatInfo(driver.id)
        const initials = driver.name
          .split(" ")
          .map((n: any) => n[0])
          .join("")
        const isSelected = selectedDriverId === driver.id

        return (
          <button
            key={driver.id}
            onClick={() => onSelectDriver(driver.id)}
            className={cn(
              "w-full p-3 rounded-lg flex items-center gap-3 transition-all text-left",
              isSelected 
                ? "bg-primary/10 border border-primary/50" 
                : "hover:bg-secondary",
              hasImportant && !isSelected && "bg-amber-500/10 border border-amber-500/30 animate-pulse"
            )}
          >
            <div className="relative">
              <Avatar className="h-10 w-10">
                <AvatarFallback className={cn(
                  "text-sm",
                  hasImportant ? "bg-amber-500/20 text-amber-500" : "bg-secondary"
                )}>
                  {initials}
                </AvatarFallback>
              </Avatar>
              {/* Status indicator */}
              <div
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                  driver.status === "available" && "bg-green-500",
                  driver.status === "busy" && "bg-blue-500",
                  driver.status === "offline" && "bg-zinc-400",
                )}
              />
              {/* Important indicator */}
              {hasImportant && (
                <div className="absolute -top-1 -right-1 h-4 w-4 bg-amber-500 rounded-full flex items-center justify-center">
                  <Flame className="h-2.5 w-2.5 text-white" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className={cn(
                  "font-medium text-sm truncate",
                  hasImportant && "text-amber-500"
                )}>
                  {driver.name}
                </span>
                {lastMessage && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(lastMessage.createdAt).toLocaleTimeString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <p className={cn(
                  "text-xs truncate flex items-center gap-1",
                  hasImportant ? "text-amber-500 font-medium" : "text-muted-foreground"
                )}>
                  {lastMessage?.isImportant && <Flame className="h-3 w-3 text-amber-500" />}
                  {lastMessage?.type === "photo" && <ImageIcon className="h-3 w-3" />}
                  {lastMessage?.type === "location" && <MapPin className="h-3 w-3" />}
                  {lastMessage?.content || "Нет сообщений"}
                </p>
                {unreadCount > 0 && (
                  <Badge className={cn(
                    "h-5 min-w-5 px-1.5 text-xs",
                    hasImportant ? "bg-amber-500 animate-bounce" : "bg-primary"
                  )}>
                    {unreadCount}
                  </Badge>
                )}
              </div>
            </div>
          </button>
        )
      })}
      
      {drivers.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Нет водителей
        </div>
      )}
    </div>
  )
}