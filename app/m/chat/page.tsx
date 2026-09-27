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

  // Контакты СВОЕГО автопарка: раньше кнопка звонка вела на зашитый в разметку
  // номер +79001234567, а под шапкой всегда горело выдуманное «Онлайн». Берём
  // настоящие данные из настроек автопарка (GET /api/m/me → fleet), а если
  // телефона нет — кнопка звонка неактивна и честно об этом говорит.
  const [fleet, setFleet] = useState<{
    parkName: string | null
    phone: string | null
  } | null>(null)

  // Срочное сообщение — свой диалог, а не системный prompt(): в мобильных
  // webview браузерные окна ввода часто заблокированы
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertText, setAlertText] = useState("")

  // Загрузка сообщений
  const fetchMessages = useCallback(async () => {
    if (!driver?.id) return

    try {
      const res = await fetch(`/api/chat?driverId=${driver.id}`)
      const data = await res.json()

      if (data.success) {
        setMessages(data.messages)
      }
    } catch (error) {
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

  useEffect(() => {
    if (!driver?.id) return
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch("/api/m/me", { cache: "no-store" })
        const data = await res.json().catch(() => null)
        if (!cancelled && data?.success && data.fleet) {
          setFleet({
            parkName: data.fleet.parkName ?? null,
            phone: data.fleet.phone ?? null,
          })
        }
      } catch {
        // не удалось прочитать контакты — просто не показываем кнопку звонка
      }
    })()

    return () => {
      cancelled = true
    }
  }, [driver?.id])

  // Автообновление
  useEffect(() => {
    if (!driver?.id) return
    const interval = setInterval(fetchMessages, 5000)
    return () => clearInterval(interval)
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

  // Срочное сообщение: открываем свой диалог, отправляем как type: "alert"
  const handleSendAlert = () => {
    setAlertText("")
    setAlertOpen(true)
  }

  const submitAlert = async () => {
    const text = alertText.trim()
    if (!text) return
    setAlertOpen(false)
    await sendMessage(text, "alert")
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
                <p className="font-semibold">{fleet?.parkName || "Диспетчерская"}</p>
                {/* Статус присутствия не отслеживается — выдумывать «Онлайн» не нужно */}
                <p className="text-xs text-gray-500">
                  {fleet?.phone || "Телефон автопарка не указан"}
                </p>
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
            {fleet?.phone ? (
              <a
                href={`tel:${fleet.phone}`}
                className="p-2.5 hover:bg-gray-800 rounded-xl transition-colors"
                title={`Позвонить в автопарк: ${fleet.phone}`}
              >
                <Phone className="h-5 w-5 text-emerald-400" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="p-2.5 rounded-xl opacity-40 cursor-not-allowed"
                title="Телефон не задан в настройках автопарка"
              >
                <Phone className="h-5 w-5 text-gray-500" />
              </button>
            )}
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

      {/* Срочное сообщение: свой диалог вместо системного prompt() */}
      {alertOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Срочное сообщение диспетчеру"
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setAlertOpen(false)}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-2xl border border-red-500/30 bg-[#151518] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-2 font-semibold text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Срочное сообщение
            </div>
            <p className="text-xs text-gray-400">
              Диспетчер увидит его как важное в чате и в уведомлениях
            </p>
            <textarea
              autoFocus
              value={alertText}
              onChange={(event) => setAlertText(event.target.value)}
              rows={3}
              placeholder="Что случилось? Где вы находитесь?"
              className="w-full resize-none rounded-xl border border-gray-800 bg-[#0f0f12] px-4 py-3 text-white placeholder-gray-500 focus:border-red-500/50 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAlertOpen(false)}
                className="flex-1 rounded-xl bg-gray-800 py-3 text-gray-300 transition-colors hover:bg-gray-700"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={submitAlert}
                disabled={!alertText.trim()}
                className="flex-1 rounded-xl bg-red-500 py-3 font-medium text-white transition-colors hover:bg-red-600 disabled:bg-gray-700 disabled:text-gray-500"
              >
                Отправить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="sticky bottom-0 bg-[#09090b] border-t border-gray-800 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
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