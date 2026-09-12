"use client"

import { useRouter } from "next/navigation"
import { Bell, BellDot } from "lucide-react"
import { useDriverNotifications } from "@/hooks/use-driver-notifications"

interface Props {
  driverId: string
}

export function DriverNotificationsBell({ driverId }: Props) {
  const router = useRouter()
  const { unreadCount } = useDriverNotifications(driverId)

  const hasUnread = unreadCount > 0

  return (
    <button
      type="button"
      onClick={() => router.push("/m/notifications")}
      className="relative p-2.5 hover:bg-gray-800 rounded-xl transition-colors"
      aria-label="Уведомления"
    >
      {hasUnread ? (
        <BellDot className="h-5 w-5 text-orange-400" />
      ) : (
        <Bell className="h-5 w-5 text-gray-400" />
      )}
      {hasUnread && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] px-1 h-[18px] rounded-full bg-orange-500 text-[10px] font-bold text-white flex items-center justify-center shadow-lg">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  )
}