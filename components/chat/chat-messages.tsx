// components/chat/chat-messages.tsx

"use client"

import { useRef, useEffect } from "react"
import type { ChatMessage } from "@/lib/types"
import { cn } from "@/lib/utils"
import { AlertTriangle, Check, CheckCheck, Flame } from "lucide-react"

interface ChatMessagesProps {
  messages: ChatMessage[]
  currentUserId: string
}

export function ChatMessages({ messages, currentUserId }: ChatMessagesProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const formatDate = (date: Date) => {
    const today = new Date()
    const msgDate = new Date(date)

    if (msgDate.toDateString() === today.toDateString()) {
      return "Сегодня"
    }

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (msgDate.toDateString() === yesterday.toDateString()) {
      return "Вчера"
    }

    return msgDate.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
  }

  // Group messages by date
  const groupedMessages: { date: string; messages: ChatMessage[] }[] = []
  let currentDate = ""

  messages.forEach((msg) => {
    const date = formatDate(msg.createdAt)
    if (date !== currentDate) {
      currentDate = date
      groupedMessages.push({ date, messages: [msg] })
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg)
    }
  })

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
      {groupedMessages.map((group, gi) => (
        <div key={gi}>
          {/* Date separator */}
          <div className="flex items-center justify-center mb-4">
            <span className="px-3 py-1 rounded-full bg-secondary text-xs text-muted-foreground">
              {group.date}
            </span>
          </div>

          {/* Messages */}
          <div className="space-y-2">
            {group.messages.map((msg) => {
              const isOwn = msg.senderId === currentUserId || msg.senderRole === "logist"
              const isImportant = msg.isImportant || msg.type === "alert"

              return (
                <div key={msg.id} className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-4 py-2 relative",
                      isOwn 
                        ? "bg-primary text-primary-foreground rounded-br-md" 
                        : "bg-secondary rounded-bl-md",
                      // Важные сообщения - яркая подсветка
                      isImportant && !isOwn && "bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-2 border-amber-500/50 shadow-lg shadow-amber-500/20",
                      isImportant && isOwn && "bg-gradient-to-r from-red-600 to-orange-500"
                    )}
                  >
                    {/* Важный индикатор */}
                    {isImportant && (
                      <div className={cn(
                        "flex items-center gap-1.5 text-xs mb-1.5 font-semibold",
                        isOwn ? "text-white/90" : "text-amber-500"
                      )}>
                        <Flame className="h-3.5 w-3.5 animate-pulse" />
                        <span>ВАЖНО</span>
                        {msg.importantReason && (
                          <span className="opacity-70">• {msg.importantReason}</span>
                        )}
                      </div>
                    )}

                    {/* Sender name for incoming */}
                    {!isOwn && !isImportant && (
                      <p className="text-xs font-medium mb-1 opacity-70">{msg.senderName}</p>
                    )}
                    
                    {/* Sender name for important incoming */}
                    {!isOwn && isImportant && (
                      <p className="text-xs font-bold mb-1 text-amber-400">{msg.senderName}</p>
                    )}

                    {/* Photo attachment */}
                    {msg.type === "photo" && msg.attachmentUrl && (
                      <div className="mb-2 rounded-lg overflow-hidden">
                        <img 
                          src={msg.attachmentUrl || "/placeholder.svg"} 
                          alt="Фото" 
                          className="max-w-full h-auto" 
                        />
                      </div>
                    )}

                    {/* Message content */}
                    <p className={cn(
                      "text-sm",
                      isImportant && !isOwn && "font-medium text-foreground"
                    )}>
                      {msg.content}
                    </p>

                    {/* Time and status */}
                    <div
                      className={cn(
                        "flex items-center justify-end gap-1 mt-1",
                        isOwn ? "text-primary-foreground/70" : "text-muted-foreground",
                        isImportant && !isOwn && "text-amber-500/70"
                      )}
                    >
                      <span className="text-[10px]">{formatTime(msg.createdAt)}</span>
                      {isOwn && (msg.isRead ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {messages.length === 0 && (
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground text-sm">Начните переписку</p>
        </div>
      )}
    </div>
  )
}