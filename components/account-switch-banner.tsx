// components/account-switch-banner.tsx
//
// Полоса «Вы вошли как …» с кнопкой «Вернуться к себе».
//
// Показывается только владельцу платформы, когда он смотрит чужой аккаунт:
// без неё легко забыть, что ты в чужом кабинете, и сделать там лишнее.
// Видна и в мобильной панели, и в компьютерной версии — один компонент.

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Undo2, UserCog } from "lucide-react"
import { toast } from "sonner"

import { apiSend, useJsonApi } from "@/hooks/use-json-api"

interface SessionResponse {
  session?: { user?: { name?: string; role?: string } }
  impersonation?: { name: string | null; email: string | null } | null
  isOwner?: boolean
}

export function AccountSwitchBanner({ className = "" }: { className?: string }) {
  const router = useRouter()
  const { data } = useJsonApi<SessionResponse>("/api/auth/session")
  const [busy, setBusy] = useState(false)

  const owner = data?.impersonation ?? null
  if (!owner) return null

  const who = data?.session?.user?.name ?? "чужой аккаунт"

  async function returnToOwner() {
    setBusy(true)
    const result = await apiSend<{ redirectTo?: string }>("/api/admin/return", "POST", {})
    setBusy(false)
    if (!result.ok) {
      toast.error(result.error || "Не удалось вернуться")
      return
    }
    toast.success("Вернулись к своему аккаунту")
    router.replace((result.data as { redirectTo?: string } | null)?.redirectTo ?? "/owner")
    router.refresh()
  }

  return (
    <div
      className={`flex items-center gap-2 border-b border-primary/30 bg-primary/15 px-3 py-2 text-[12.5px] text-foreground ${className}`}
    >
      <UserCog className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate">
        Вы вошли как <span className="font-semibold">{who}</span>
      </span>
      <button
        type="button"
        onClick={() => void returnToOwner()}
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
        Вернуться
      </button>
    </div>
  )
}
