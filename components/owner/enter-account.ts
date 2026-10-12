// Вход в любой аккаунт от имени владельца (тот же механизм, что был на /owner).
// Сервер выпускает сессию сам: пароли сотрудников и водителей не нужны.

import { toast } from "sonner"

import { apiSend } from "@/hooks/use-json-api"

export async function enterAccount(account: {
  kind: "staff" | "driver"
  id: string
  name: string
  fallbackHref?: string
}): Promise<void> {
  const body = account.kind === "driver" ? { driverId: account.id } : { userId: account.id }
  const result = await apiSend<{ redirectTo?: string }>("/api/admin/impersonate", "POST", body)
  if (!result.ok) {
    toast.error(result.error || "Не удалось войти в аккаунт")
    return
  }
  toast.success(`Открываю аккаунт: ${account.name}`)
  const target = (result.data as { redirectTo?: string } | null)?.redirectTo ?? account.fallbackHref ?? "/lm"
  // Полная перезагрузка: cookie сессии меняется, клиентские контексты читают её заново
  window.location.assign(target)
}
