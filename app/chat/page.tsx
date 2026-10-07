// app/chat/page.tsx

"use client"

import { useState, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { ChatList } from "@/components/chat/chat-list"
import { ChatMessages } from "@/components/chat/chat-messages"
import { ChatInput } from "@/components/chat/chat-input"
import type { ChatMessage } from "@/lib/types"
import { fetchJsonCached, invalidateCache, peekCache } from "@/lib/client-cache"
import { FeedSkeleton } from "@/components/ui/skeletons"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MessageSquare, Phone, MapPin, AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react"
import { TruckLoader } from "@/components/ui/truck-loader"

interface Driver {
  id: string
  name: string
  phone: string
  status: string
  currentLocation?: string
  vehiclePlate?: string
}

export default function ChatPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()
  
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)

  // Загрузка водителей
  const fetchDrivers = useCallback(async () => {
    try {
      // Справочник водителей общий для чата и автопарка — берём из кеша
      const data = await fetchJsonCached<{ success?: boolean; drivers?: Driver[] }>(
        '/api/drivers',
      )
      if (data.success) {
        setDrivers(data.drivers ?? [])
      }
    } catch (error) {
      console.error('Failed to fetch drivers:', error)
    }
  }, [])

  // Загрузка сообщений
  const fetchMessages = useCallback(async () => {
    const url = selectedDriverId
      ? `/api/chat?driverId=${selectedDriverId}`
      : '/api/chat'

    // Переписка «живая»: данные всё равно перечитываем с сервера, но если
    // диалог уже открывали — показываем его сразу, без пустого экрана
    const known = peekCache<{ messages?: ChatMessage[] }>(url)
    if (known?.data.messages) {
      setMessages(known.data.messages)
      setIsLoading(false)
    }

    try {
      const data = await fetchJsonCached<{ success?: boolean; messages?: ChatMessage[] }>(
        url,
        { ttlMs: 2000 },
      )
      if (data.success) setMessages(data.messages ?? [])
    } catch (error) {
      console.error('Failed to fetch messages:', error)
    } finally {
      setIsLoading(false)
    }
  }, [selectedDriverId])

  // Начальная загрузка
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/")
      return
    }
    if (!authLoading && user?.role === "driver") {
      router.push("/m")
      return
    }
    
    fetchDrivers()
    fetchMessages()
  }, [authLoading, user, router, fetchDrivers, fetchMessages])

  // Обновляем сообщения при смене водителя
  useEffect(() => {
    if (selectedDriverId) {
      fetchMessages()
    }
  }, [selectedDriverId, fetchMessages])

  // Автообновление сообщений каждые 5 сек
  useEffect(() => {
    const interval = setInterval(fetchMessages, 5000)
    return () => clearInterval(interval)
  }, [fetchMessages])

  // Отправка сообщения
  const handleSendMessage = async (content: string, type: "text" | "photo" | "location" | "alert" = "text") => {
    if (!selectedDriverId || !user) return
    
    setIsSending(true)
    
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: user.id,
          senderRole: 'logist',
          senderName: user.name,
          recipientId: selectedDriverId,
          content,
          type
        })
      })
      
      const data = await res.json()
      if (data.success) {
        // В кеше лента без только что отправленного сообщения
        invalidateCache("/api/chat")
        setMessages(prev => [...prev, data.message])
      }
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setIsSending(false)
    }
  }

  if (authLoading || !user) {
    // Подложка прозрачная: живой фон приложения виден и во время загрузки
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <TruckLoader className="text-primary" />
      </div>
    )
  }

  const selectedDriver = drivers.find((d: any) => d.id === selectedDriverId)
  const driverMessages = selectedDriverId
    ? messages.filter((m: any) => m.senderId === selectedDriverId || m.recipientId === selectedDriverId)
    : []
  
  // Количество непрочитанных важных
  const importantUnread = messages.filter(m => m.isImportant && !m.isRead).length

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className={cn("transition-all duration-300 ease-in-out", isCollapsed ? "lg:pl-20" : "lg:pl-64")}>
        <Header />
        <main className="p-4 lg:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 lg:mb-6">
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold lg:text-2xl">
                Чат с водителями
                {importantUnread > 0 && (
                  <Badge variant="destructive" className="animate-pulse">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {importantUnread} важных
                  </Badge>
                )}
              </h1>
              <p className="text-xs text-muted-foreground lg:text-sm">Общение и координация в реальном времени</p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchMessages}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Обновить
            </Button>
          </div>

          <div className="grid h-[calc(100dvh-190px)] grid-cols-1 gap-4 lg:h-[calc(100vh-200px)] lg:grid-cols-12 lg:gap-6">
            {/* Driver list */}
            <Card className={cn("flex-col lg:col-span-4", selectedDriverId && "hidden lg:flex")}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Водители ({drivers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <FeedSkeleton rows={5} />
                ) : (
                  <ChatList
                    drivers={drivers}
                    messages={messages}
                    selectedDriverId={selectedDriverId}
                    onSelectDriver={setSelectedDriverId}
                  />
                )}
              </CardContent>
            </Card>

            {/* Chat area */}
            <Card className={cn("flex-col lg:col-span-8", !selectedDriverId && "hidden lg:flex")}>
              {selectedDriver ? (
                <>
                  {/* Chat header */}
                  <div className="border-b border-border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        {/* Возврат к списку водителей — только на телефоне */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="lg:hidden"
                          aria-label="К списку водителей"
                          onClick={() => setSelectedDriverId(null)}
                        >
                          <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <Avatar className="h-10 w-10">
                          <AvatarFallback>
                            {selectedDriver.name
                              .split(" ")
                              .map((n: any) => n[0])
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{selectedDriver.name}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {selectedDriver.currentLocation || "Неизвестно"}
                            </span>
                            {selectedDriver.vehiclePlate && (
                              <Badge variant="secondary" className="text-xs">
                                {selectedDriver.vehiclePlate}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <a href={`tel:${selectedDriver.phone}`}>
                          <Phone className="h-4 w-4 sm:mr-2" />
                          <span className="hidden sm:inline">Позвонить</span>
                        </a>
                      </Button>
                    </div>
                  </div>

                  {/* Messages */}
                  <ChatMessages messages={driverMessages} currentUserId={user.id} />

                  {/* Input */}
                  <ChatInput onSend={handleSendMessage} disabled={isSending} />
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Выберите водителя для начала переписки</p>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </main>
      </div>
    </div>
  )
}