"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { MobileHeader } from "@/components/driver-mobile/mobile-header"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import { ChatButton } from "@/components/driver-mobile/chat-button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, MapPin, Calendar, CheckCircle, Package } from "lucide-react"

export default function DriverHistoryPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const [completedOrders, setCompletedOrders] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [unreadMessages, setUnreadMessages] = useState(0)

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/")
    }
  }, [user, isLoading, router])

  useEffect(() => {
    if (!user) return

    const fetchData = async () => {
      setLoadingData(true)
      try {
        const driverParam = user.id ? `&driverId=${user.id}` : ""
        const res = await fetch(`/api/orders?status=delivered${driverParam}`)
        if (res.ok) {
          const data = await res.json()
          if (data.success && Array.isArray(data.orders)) {
            setCompletedOrders(data.orders)
          }
        }
      } catch (err) {
        console.error("Failed to load history orders:", err)
      } finally {
        setLoadingData(false)
      }
    }

    void fetchData()
  }, [user])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <MobileHeader />

      <main className="p-4 space-y-4">
        <h1 className="text-xl font-bold">История рейсов</h1>

        {loadingData ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : completedOrders.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground space-y-2">
              <Package className="h-10 w-10 mx-auto text-muted-foreground/50" />
              <p className="font-medium text-foreground">Нет завершенных рейсов</p>
              <p className="text-sm">Когда вы доставите груз и завершите рейс, он появится в этом списке.</p>
            </CardContent>
          </Card>
        ) : (
          completedOrders.map((order: any) => (
            <Card key={order.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-medium">{order.cargo || "Груз"}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                      <Calendar className="h-3 w-3" />
                      {order.updatedAt
                        ? new Date(order.updatedAt).toLocaleDateString("ru-RU")
                        : new Date(order.createdAt).toLocaleDateString("ru-RU")}
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-green-600 bg-green-500/10 border-green-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Выполнен
                  </Badge>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{order.routeFrom}</span>
                  <span className="text-muted-foreground">→</span>
                  <span>{order.routeTo}</span>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <span className="text-sm text-muted-foreground">{order.distance || 0} км</span>
                  <span className="font-bold text-primary">
                    {order.price ? `${order.price.toLocaleString("ru-RU")} ₽` : "По договору"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </main>

      <ChatButton unreadCount={unreadMessages} />
      <BottomNav />
    </div>
  )
}
