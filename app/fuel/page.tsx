"use client"

// app/fuel/page.tsx
//
// Топливная ведомость: чеки водителей, расход по машинам «факт против
// оценки», цена литра. Отчёты считают деньги вообще — эта страница только
// про топливо, без дублирования других разделов.

import { useEffect } from "react"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { FuelView } from "@/components/fuel/fuel-view"
import { TruckLoader } from "@/components/ui/truck-loader"

export default function FuelPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/")
    }
    if (!isLoading && user?.role === "driver") {
      router.push("/m")
    }
  }, [user, isLoading, router])

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <TruckLoader className="text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className={cn("transition-all duration-300 ease-in-out", isCollapsed ? "lg:pl-20" : "lg:pl-64")}>
        <Header />
        <main className="space-y-4 lg:space-y-6 p-4 lg:p-6">
          <div>
            <h1 className="text-2xl font-bold">Топливная ведомость</h1>
            <p className="text-muted-foreground">
              Чеки водителей, расход против паспортной нормы и цена литра — по данным организации
            </p>
          </div>

          <FuelView />
        </main>
      </div>
    </div>
  )
}
