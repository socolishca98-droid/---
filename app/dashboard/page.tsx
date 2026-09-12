// app/dashboard/page.tsx

"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Loader2 } from "lucide-react"
import dynamic from "next/dynamic"

const DashboardMap = dynamic(
  () => import("@/components/dashboard/map/DashboardMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    ),
  },
)

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/")
    }
  }, [user, authLoading, router])

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#09090b]">
      <Sidebar />
      <div className="flex-1 pl-64 h-full flex flex-col">
        <Header />
        <div className="flex-1 relative">
          <DashboardMap />
        </div>
      </div>
    </div>
  )
}