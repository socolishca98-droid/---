// Вход в любой аккаунт от имени владельца (тот же механизм, что был на /owner).
// Сервер выпускает сессию сам: пароли сотрудников и водителей не нужны.

import { toast } from "sonner"

import { apiSend } from "@/hooks/use-json-api"

export interface EnterAccountResult {
  ok: boolean
  /** Человекочитаемая причина неудачи — для постоянного блока на странице */
  error?: string
}

export async function enterAccount(account: {
  kind: "staff" | "driver"
  id: string
  name: string
  fallbackHref?: string
}): Promise<EnterAccountResult> {
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
    return { ok: false, error: result.error || "Не удалось войти в аккаунт" }
  }
  // Вход выполнен, но запись в журнал не сохранилась — сказать об этом вслух.
  if (result.data?.warning) toast.warning(result.data.warning)

  // и31: до перехода проверяем, что выданная сессия действительно действует.
  // Раньше молчаливый редирект уносил владельца в чужой кабинет, где его
  // встречал экран входа — «нажимаю на профиль, и меня выкидывает». Теперь
  // причина показывается здесь, на месте.
  const check = await fetch(`/api/auth/session?kind=${account.kind === "driver" ? "driver" : "staff"}`, {
    cache: "no-store",
  })
  // Пароль хостинга (Vercel Deployment Protection) перехватил запрос:
  // скажем прямо, что это настройка хостинга, а не сломанный вход
  if (check.status === 401 && check.headers.get("www-authenticate")) {
    const hostingError =
      "сайт требует пароль хостинга (Vercel Protection) — введите его при открытии сайта и повторите, либо отключите: Vercel → проект → Settings → Deployment Protection → Disable"
    toast.error(hostingError, { duration: 12000 })
    return { ok: false, error: hostingError }
  }
  if (!check.ok) {
    const failure = (await check.json().catch(() => ({}))) as { error?: string; reason?: string }
    console.warn("[enter-account] сессия цели не действует:", failure?.reason ?? check.status)
    toast.error(failure?.error || "Аккаунт открылся, но его сессия не действует")
    return {
      ok: false,
      error: `${failure?.error || "аккаунт открылся, но его сессия не действует"}${failure?.reason ? ` (причина: ${failure.reason})` : ""}`,
    }
  }

  toast.success(`Открываю аккаунт: ${account.name}`)
  const target = (result.data as { redirectTo?: string } | null)?.redirectTo ?? account.fallbackHref ?? "/lm"
  // и42: кабинет открывается В НОВОЙ ВКЛАДКЕ. Телефон умеет показывать
  // «замороженный» снимок старой страницы вместо свежей — новая вкладка
  // создаётся с нуля и заморозиться не может. Если браузер запретил
  // открытие (редко) — обычный переход в этой вкладке.
  const opened = window.open(target, "_blank")
  if (!opened) {
    // Полная перезагрузка: cookie сессии меняется, клиентские контексты читают её заново
    window.location.assign(target)
  }
  return { ok: true }
}
