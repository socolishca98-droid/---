// app/lm/map/page.tsx — карта на весь экран.
//
// Экран занимает всё место между шапкой и нижней навигацией: сначала карта,
// остальное — поверх неё. Высота считается через dvh, чтобы адресная строка
// мобильного браузера не «съедала» низ карты.
//
// Карта подключается только на клиенте (ssr: false): Leaflet работает с
// window при загрузке модуля и на сервере упал бы при предрендере.

"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { useStaffSession } from "@/hooks/use-staff-session"

const DriversMap = dynamic(
  () => import("@/components/logist-mobile/drivers-map").then((module) => module.DriversMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    ),
  },
)

export default function LogistMapPage() {
  const { user } = useStaffSession()

  return (
    <>
      <LogistHeader title="Карта" subtitle="Где сейчас машины" userName={user?.name} />

      {/* 57px — шапка, 72px + safe-area — нижняя навигация */}
      <div className="h-[calc(100dvh-57px-72px-env(safe-area-inset-bottom))] min-h-[420px]">
        <DriversMap />
      </div>
    </>
  )
}
