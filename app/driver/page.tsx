"use client"

import { useState } from "react"
import { DriverHeader } from "@/components/driver/driver-header"
import { TaskCard } from "@/components/driver/task-card"
import { QuickPhotoUpload } from "@/components/driver/quick-photo-upload"
import { DriverStats } from "@/components/driver/driver-stats"
import { mockOrders } from "@/lib/mock-data"
import type { Order } from "@/lib/types"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Package, Camera, History } from "lucide-react"

export default function DriverPage() {
  const [orders, setOrders] = useState<Order[]>(
    mockOrders
      .filter((o) => o.assignedDriverId === "1" || o.status === "confirmed")
      .slice(0, 3),
  )

  const activeOrders = orders.filter((o) => o.status !== "delivered")
  const completedOrders = orders.filter((o) => o.status === "delivered")

  const handleAccept = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, status: "in_transit" as const } : o,
      ),
    )
  }

  const handleComplete = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, status: "delivered" as const } : o,
      ),
    )
  }

  const handlePhotoUpload = (files: File[], category: string) => {
    console.log("Uploaded:", files.length, "files to", category)
  }

  const driverStats = {
    ordersToday: 2,
    ordersTotal: 156,
    rating: 4.8,
    distance: 12.4,
  }

  return (
    <div className="min-h-screen bg-background">
      <DriverHeader driverName="РђР»РµРєСЃР°РЅРґСЂ РџРµС‚СЂРѕРІ" notificationCount={2} />

      <main className="p-4 pb-20 space-y-4">
        <DriverStats stats={driverStats} />

        <Tabs defaultValue="tasks" className="space-y-4">
          <TabsList className="w-full bg-secondary">
            <TabsTrigger value="tasks" className="flex-1 gap-1">
              <Package className="h-4 w-4" />
              Р—Р°РґР°РЅРёСЏ
            </TabsTrigger>
            <TabsTrigger value="photo" className="flex-1 gap-1">
              <Camera className="h-4 w-4" />
              Р¤РѕС‚Рѕ
            </TabsTrigger>
            <TabsTrigger value="history" className="flex-1 gap-1">
              <History className="h-4 w-4" />
              РСЃС‚РѕСЂРёСЏ
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tasks" className="space-y-4 mt-4">
            {activeOrders.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">РќРµС‚ Р°РєС‚РёРІРЅС‹С… Р·Р°РґР°РЅРёР№</p>
              </div>
            ) : (
              activeOrders.map((order) => (
                <TaskCard
                  key={order.id}
                  order={order}
                  onAccept={() => handleAccept(order.id)}
                  onComplete={() => handleComplete(order.id)}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="photo" className="mt-4">
            <QuickPhotoUpload onUpload={handlePhotoUpload} />
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            {completedOrders.length === 0 ? (
              <div className="text-center py-12">
                <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">РСЃС‚РѕСЂРёСЏ РїСѓСЃС‚Р°</p>
              </div>
            ) : (
              completedOrders.map((order) => <TaskCard key={order.id} order={order} />)
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}