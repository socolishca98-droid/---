// components/driver-mobile/chat-button.tsx
//
// Кнопка чата в приложении водителя со счётчиком непрочитанных (пункт 1.3).
//
// Раньше о новом сообщении логиста водитель узнавал, только если сам открывал
// чат: ни точки, ни уведомления не было. Здесь раз в 30 секунд спрашиваем
// /api/m/chat-unread (пока экран на виду) и показываем цифру.

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { MessageCircle } from "lucide-react"

export function DriverChatButton() {
  const router = useRouter()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch("/api/m/chat-unread", { cache: "no-store" })
        const data = await res.json().catch(() => null)
        if (!cancelled && data?.success) setUnread(Number(data.count) || 0)
      } catch {
        // нет сети — просто не показываем счётчик
      }
    }

    void load()
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return
      void load()
    }, 30000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <button
      type="button"
      onClick={() => router.push("/m/chat")}
      className="relative p-2.5 hover:bg-gray-800 rounded-xl transition-colors"
      aria-label={unread > 0 ? `Чат с диспетчером, новых сообщений: ${unread}` : "Чат с диспетчером"}
    >
      <MessageCircle className="h-5 w-5 text-gray-400" />
      {unread > 0 ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-semibold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </button>
  )
}
