"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useDriverSession } from "@/hooks/use-driver-session"
import {
  ChevronLeft,
  Phone,
  Send,
  Loader2,
  AlertTriangle,
  Headphones,
} from "lucide-react"
import { toast } from "sonner"

interface ChatMessage {
  id: string
  senderId: string
  senderRole: string
  senderName: string
  content: string
  type: string
  isImportant?: boolean
  createdAt: string
}

interface Driver {
  id: string
  name: string
}

export default function DriverChatPage() {
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Сессия — серверная (httpOnly-cookie): читать «driver_session» из
  // localStorage бессмысленно, такой записи после задачи 1 не существует
  const { driver } = useDriverSession()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)

  // Счётчик сбоев подряд: по нему замедляем опрос, чтобы не долбить упавший сервер
  const failuresRef = useRef(0)
  // 401/403 — сессии водителя больше нет: опрос прекращаем, пусть ею занимается
  // хук сессии, а страница не спамит заведомо неудачными запросами
  const sessionLostRef = useRef(false)

  // Загрузка сообщений
  const fetchMessages = useCallback(async () => {
    if (!driver?.id) return

    try {
      const res = await fetch(`/api/chat?driverId=${driver.id}`)
      if (res.status === 401 || res.status === 403) {
        sessionLostRef.current = true
        return
      }
      const data = await res.json()

      if (data.success) {
        setMessages(data.messages)
      }
      failuresRef.current = 0
    } catch (error) {
      failuresRef.current += 1
      console.error("Failed to fetch messages:", error)
    } finally {
      setIsLoading(false)
    }
  }, [driver?.id])

  useEffect(() => {
    if (driver?.id) {
      fetchMessages()
    }
  }, [driver?.id, fetchMessages])

  // Автообновление: пока всё в порядке — раз в 5 секунд. После трёх сбоев
  // подряд уходим на 30 секунд: иначе при лежачем сервере вкладка молотит
  // запросами каждые 5 секунд и выглядит зависшей.
  useEffect(() => {
    if (!driver?.id) return

    let timer: number | undefined
    let cancelled = false

    const tick = async () => {
      if (sessionLostRef.current) return
      await fetchMessages()
      if (cancelled || sessionLostRef.current) return
      const delay = failuresRef.current >= 3 ? 30_000 : 5_000
      timer = window.setTimeout(tick, delay)
    }

    void tick()

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [driver?.id, fetchMessages])

  // Скролл вниз
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Отправка сообщения
  const handleSend = async () => {
    if (!newMessage.trim() || !driver?.id || isSending) return

    setIsSending(true)
    const content = newMessage.trim()
    setNewMessage("")

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: driver.id,
          senderRole: "driver",
          senderName: driver.name,
          content,
          type: "text",
        }),
      })

      const data = await res.json()
      if (data.success) {
        setMessages((prev) => [...prev, data.message])
      } else {
        setNewMessage(content)
        toast.error("Не удалось отправить сообщение")
      }
    } catch (error) {
      console.error("Failed to send message:", error)
      setNewMessage(content)
      toast.error("Ошибка отправки")
    } finally {
      setIsSending(false)
      inputRef.current?.focus()
    }
  }

  // Срочное сообщение
  const handleSendAlert = () => {
    const alertText = prompt("Срочное сообщение диспетчеру:")
    if (alertText?.trim()) {
      sendMessage(alertText.trim(), "alert")
    }
  }

  const sendMessage = async (content: string, type: string = "text") => {
    if (!driver?.id) return

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: driver.id,
          senderRole: "driver",
          senderName: driver.name,
          content,
          type,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setMessages((prev) => [...prev, data.message])
        if (type === "alert") {
          toast.success("Срочное сообщение отправлено")
        }
      }
    } catch (error) {
      console.error("Failed to send message:", error)
      toast.error("Ошибка отправки")
    }
  }

  const formatTime = (date: string) => {
    return new Date(date).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const formatDate = (date: string) => {
    const d = new Date(date)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (d.toDateString() === today.toDateString()) {
      return "Сегодня"
    } else if (d.toDateString() === yesterday.toDateString()) {
      return "Вчера"
    } else {
      return d.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
      })
    }
  }

  // Группировка сообщений по дате
  const groupedMessages = messages.reduce((acc: any, msg: any) => {
    const dateKey = new Date(msg.createdAt).toDateString()
    if (!acc[dateKey]) {
      acc[dateKey] = []
    }
    acc[dateKey].push(msg)
    return acc
  }, {} as Record<string, ChatMessage[]>)

  if (!driver) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 -ml-2 rounded-xl hover:bg-gray-800 transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <Headphones className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-semibold">Диспетчерская</p>
                <p className="text-xs text-emerald-400">Онлайн</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleSendAlert}
              className="p-2.5 hover:bg-red-500/20 rounded-xl transition-colors"
              title="Срочное сообщение"
            >
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </button>
            <a
              href="tel:+79001234567"
              className="p-2.5 hover:bg-gray-800 rounded-xl transition-colors"
            >
              <Phone className="h-5 w-5 text-emerald-400" />
            </a>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-gray-800/50 flex items-center justify-center mb-4">
              <Headphones className="h-8 w-8 text-gray-600" />
            </div>
            <p className="text-gray-400 font-medium mb-1">Нет сообщений</p>
            <p className="text-gray-600 text-sm text-center">
              Напишите диспетчеру, если нужна помощь
            </p>
          </div>
        ) : (
          Object.entries(groupedMessages as any).map(([dateKey, msgs]: any) => (
            <div key={dateKey}>
              {/* Разделитель даты */}
              <div className="flex items-center justify-center my-4">
                <span className="px-3 py-1 rounded-full bg-gray-800/50 text-xs text-gray-500">
                  {formatDate((msgs as any)[0].createdAt)}
                </span>
              </div>

              {/* Сообщения */}
              <div className="space-y-3">
                {(msgs as any).map((msg: any) => {
                  const isOwn = msg.senderId === driver.id
                  const isImportant = msg.isImportant || msg.type === "alert"

                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          isOwn
                            ? "bg-orange-500 text-white rounded-br-md"
                            : isImportant
                            ? "bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/30 rounded-bl-md"
                            : "bg-[#1a1a1f] border border-gray-800 rounded-bl-md"
                        }`}
                      >
                        {/* Важное сообщение */}
                        {isImportant && !isOwn && (
                          <div className="flex items-center gap-1.5 text-red-400 text-xs mb-2 font-medium">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            ВАЖНО
                          </div>
                        )}

                        {/* Имя отправителя */}
                        {!isOwn && (
                          <p className="text-xs text-gray-400 mb-1">
                            {msg.senderName}
                          </p>
                        )}

                        {/* Текст */}
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>

                        {/* Время */}
                        <p
                          className={`text-[10px] mt-1.5 text-right ${
                            isOwn ? "text-orange-100/70" : "text-gray-500"
                          }`}
                        >
                          {formatTime(msg.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="sticky bottom-0 bg-[#09090b] border-t border-gray-800 p-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <textarea
              ref={inputRef}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Сообщение..."
              rows={1}
              className="w-full px-4 py-3 bg-[#151518] border border-gray-800 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 resize-none max-h-32 transition-colors"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!newMessage.trim() || isSending}
            className="p-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl transition-colors flex-shrink-0"
          >
            {isSending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}