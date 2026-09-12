// components/driver-mobile/chat-button.tsx

"use client"

import { MessageSquare } from "lucide-react"
import Link from "next/link"

interface ChatButtonProps {
  unreadCount?: number
}

export function ChatButton({ unreadCount = 0 }: ChatButtonProps) {
  return (
    <Link 
      href="/m/chat"
      className="fixed bottom-24 left-4 z-[100] w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-2xl flex items-center justify-center transition-all"
    >
      <MessageSquare className="h-5 w-5 text-white" />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1.5 bg-red-500 rounded-full text-xs font-bold text-white flex items-center justify-center animate-pulse">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </Link>
  )
}