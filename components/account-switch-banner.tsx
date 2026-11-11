// components/account-switch-banner.tsx
//
// Полоса «Вы вошли как …» с кнопкой «Вернуться к себе».
//
// Показывается только владельцу платформы, когда он смотрит чужой аккаунт:
// без неё легко забыть, что ты в чужом кабинете, и сделать там лишнее.
// Видна и в мобильной панели, и в компьютерной версии — один компонент.

"use client"

import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Loader2, Undo2, UserCog } from "lucide-react"
import { toast } from "sonner"

import { apiSend, useJsonApi } from "@/hooks/use-json-api"

interface SessionResponse {
  session?: { user?: { name?: string; role?: string; email?: string } }
  impersonation?: { name: string | null; email: string | null } | null
  isOwner?: boolean
}

export function AccountSwitchBanner({
  className = "",
  sessionKind = "staff",
}: {
  className?: string
  /** В каком контуре висит баннер: в /m показываем водителя, а не штабную cookie */
  sessionKind?: "staff" | "driver"
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { data } = useJsonApi<SessionResponse>(`/api/auth/session?kind=${sessionKind}`)
  const [busy, setBusy] = useState(false)

  // и36: на экране входа полоса не показывается. Её данные живут в клиентском
  // состоянии и могут остаться от прошлой сцены (живой кабинет, кэш страницы)
  // — тогда над формой висит «Вы вошли как …», а форма просит войти: экран
  // врёт человеку. Путь назад со входа — своя кнопка (server-side, и33):
  // она знает, жива ли сессия владельца, и не врёт.
  if (pathname === "/m/login") return null

  const owner = data?.impersonation ?? null
  if (!owner) return null
  // и33: владелец в собственной сессии (например, открыл панель, пока
  // действует вход в чужой водительский аккаунт) — полоса «Вы вошли как
  // [сам себя]» только путает. API от имени владельца отдаёт только имя
  // и почту, поэтому сравниваем по email.
  const sessionEmail = data?.session?.user?.email?.toLowerCase()
  if (sessionEmail && owner.email && sessionEmail === owner.email.toLowerCase()) return null

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
