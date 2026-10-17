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
  const result = await apiSend<{ redirectTo?: string; warning?: string }>(
    "/api/admin/impersonate",
    "POST",
    body,
  )
  if (!result.ok) {
    // Например, доступ к учётной записи закрыт: сессия всё равно не заработала
    // бы, и владелец уехал бы в чужой кабинет чтобы сразу выпасть на вход.
    toast.error(result.error || "Не удалось войти в аккаунт")
    return
  }
  // Вход выполнен, но запись в журнал не сохранилась — сказать об этом вслух.
  if (result.data?.warning) toast.warning(result.data.warning)
  toast.success(`Открываю аккаунт: ${account.name}`)
  const target = (result.data as { redirectTo?: string } | null)?.redirectTo ?? account.fallbackHref ?? "/lm"
  // Полная перезагрузка: cookie сессии меняется, клиентские контексты читают её заново
  window.location.assign(target)
}
