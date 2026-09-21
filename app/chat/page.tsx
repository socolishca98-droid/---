// app/chat/page.tsx

"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { ChatList } from "@/components/chat/chat-list"
import { ChatMessages } from "@/components/chat/chat-messages"
import { ChatInput } from "@/components/chat/chat-input"
import type { ChatMessage } from "@/lib/types"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Loader2, MessageSquare, Phone, MapPin, AlertTriangle, RefreshCw } from "lucide-react"

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
      const res = await fetch('/api/drivers')
      const data = await res.json()
      if (data.success) {
        setDrivers(data.drivers)
      }
    } catch (error) {
      console.error('Failed to fetch drivers:', error)
    }
  }, [])

  // Загрузка сообщений
  const fetchMessages = useCallback(async () => {
    try {
      const url = selectedDriverId 
        ? `/api/chat?driverId=${selectedDriverId}`
        : '/api/chat'
      const res = await fetch(url)
      const data = await res.json()
      if (data.success) {
        setMessages(data.messages)
      }
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
        setMessages(prev => [...prev, data.message])
      }
    } catch (error) {
      console.error('Failed to send message:', error)
    } finally {
      setIsSending(false)
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const selectedDriver = drivers.find((d) => d.id === selectedDriverId)
  const driverMessages = selectedDriverId
    ? messages.filter((m) => m.senderId === selectedDriverId || m.recipientId === selectedDriverId)
    : []
  
  // Количество непрочитанных важных
  const importantUnread = messages.filter(m => m.isImportant && !m.isRead).length

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className="transition-all duration-300 ease-in-out"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <main className="p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                Чат с водителями
                {importantUnread > 0 && (
                  <Badge variant="destructive" className="animate-pulse">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {importantUnread} важных
                  </Badge>
                )}
              </h1>
              <p className="text-muted-foreground">Общение и координация в реальном времени</p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchMessages}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Обновить
            </Button>
          </div>

          <div className="grid grid-cols-12 gap-6 h-[calc(100vh-200px)]">
            {/* Driver list */}
            <Card className="col-span-4 flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Водители ({drivers.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
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
            <Card className="col-span-8 flex flex-col">
              {selectedDriver ? (
                <>
                  {/* Chat header */}
                  <div className="border-b border-border p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback>
                            {selectedDriver.name
                              .split(" ")
                              .map((n) => n[0])
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
                          <Phone className="h-4 w-4 mr-2" />
                          Позвонить
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