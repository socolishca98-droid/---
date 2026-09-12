"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { MobileHeader } from "@/components/driver-mobile/mobile-header"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import { ChatButton } from "@/components/driver-mobile/chat-button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { mockOrders, mockChatMessages } from "@/lib/mock-data"
import { Loader2, MapPin, Calendar, CheckCircle } from "lucide-react"

export default function DriverHistoryPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/")
    }
  }, [user, isLoading, router])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // Mock completed orders for history
  const completedOrders = [
    { ...mockOrders[0], status: "delivered" as const, completedAt: new Date(Date.now() - 86400000 * 1) },
    { ...mockOrders[2], status: "delivered" as const, completedAt: new Date(Date.now() - 86400000 * 3) },
    { ...mockOrders[4], status: "delivered" as const, completedAt: new Date(Date.now() - 86400000 * 5) },
  ]

  const unreadMessages = mockChatMessages.filter((m) => !m.isRead).length

  return (
    <div className="min-h-screen bg-background pb-20">
      <MobileHeader />

      <main className="p-4 space-y-4">
        <h1 className="text-xl font-bold">История рейсов</h1>

        {completedOrders.map((order, index) => (
          <Card key={index}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-medium">{order.cargoType}</p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Calendar className="h-3 w-3" />
                    {order.completedAt?.toLocaleDateString("ru-RU")}
                  </div>
                </div>
                <Badge variant="secondary" className="text-green-600">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Выполнен
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{order.routeFrom}</span>
                <span className="text-muted-foreground">→</span>
                <span>{order.routeTo}</span>
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                <span className="text-sm text-muted-foreground">{order.distance} км</span>
                <span className="font-bold text-primary">{order.price?.toLocaleString("ru-RU")} ₽</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </main>

      <ChatButton unreadCount={unreadMessages} />
      <BottomNav />
    </div>
  )
}
