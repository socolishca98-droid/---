// app/dashboard/page.tsx

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import dynamic from "next/dynamic"

const DashboardMap = dynamic(
  () => import("@/components/dashboard/map/DashboardMap"),
  {
    ssr: false,
    loading: () => (
      // Карта грузится отдельным куском: пока её нет, показываем тёмный контур
      // с мягкой пульсацией — так переход с других страниц не «мигает» белым
      <div className="h-full w-full bg-[#0a0a0a] p-6">
        <div className="flex h-full flex-col gap-4">
          <div className="flex gap-3">
            <div className="skeleton-shimmer h-9 w-56 rounded-lg opacity-30" />
            <div className="skeleton-shimmer h-9 w-32 rounded-lg opacity-20" />
          </div>
          <div className="skeleton-shimmer flex-1 rounded-2xl opacity-15" />
          <div className="flex gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="skeleton-shimmer h-20 flex-1 rounded-xl opacity-20" />
            ))}
          </div>
        </div>
      </div>
    ),
  },
)

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/")
    }
  }, [user, authLoading, router])

  if (authLoading || !user) {
    return (
      // Тот же тёмный контур, что и у карты: экран не светлеет при входе
      <div className="min-h-screen w-screen bg-[#09090b] p-6">
        <div className="skeleton-shimmer h-full min-h-[70vh] rounded-2xl opacity-15" />
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#09090b]">
      <Sidebar />
      <div
        className="flex-1 h-full flex flex-col transition-all duration-300 ease-in-out"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <div className="flex-1 relative">
          <DashboardMap />
        </div>
      </div>
    </div>
  )
}