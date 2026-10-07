// app/lm/notifications/page.tsx — уведомления штаба.
//
// Список того, что система считает важным: SOS от водителя, подходящая
// выгрузка, просроченный платёж. Тап по уведомлению открывает связанный заказ
// или рейс и заодно отмечает уведомление прочитанным.

"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, Bell, CheckCheck, Trash2 } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { ActionButton, EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import type { MobileNotification } from "@/lib/logist-mobile/types"
import { formatRelative } from "@/lib/logist-mobile/format"

const TYPE_ICONS: Record<string, string> = {
  sos: "🚨",
  sos_status: "🚨",
  delivery_soon: "⏰",
  payment_overdue: "💰",
  photo: "📷",
  new_load: "📦",
  route_assigned: "🚚",
}

export default function LogistNotificationsPage() {
  const router = useRouter()
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<{
    notifications: MobileNotification[]
    unread: number
  }>(user ? "/api/notifications" : null)

  const notifications = data?.notifications ?? []
  const unread = data?.unread ?? 0

  async function open(item: MobileNotification) {
    if (!item.isRead) {
      await apiSend("/api/notifications", "POST", { action: "read", id: item.id })
      reload()
    }
    if (item.orderId) {
      router.push(`/lm/orders/${item.orderId}`)
      return
    }
    if (item.routeId) {
      router.push(`/lm/routes/${item.routeId}`)
    }
  }

  async function markAll() {
    const result = await apiSend("/api/notifications", "POST", { action: "readAll" })
    if (!result.ok) {
      toast.error(result.error || "Не удалось отметить")
      return
    }
    toast.success("Все уведомления прочитаны")
    reload()
  }

  async function clearAll() {
    if (!window.confirm("Очистить список уведомлений?")) return
    const result = await apiSend("/api/notifications", "POST", { action: "clear" })
    if (!result.ok) {
      toast.error(result.error || "Не удалось очистить")
      return
    }
    reload()
  }

  return (
    <>
      <LogistHeader
        title="Уведомления"
        subtitle={unread > 0 ? `${unread} новых` : "всё прочитано"}
        userName={user?.name}
      />

      <div className="px-4 pt-4">
        {notifications.length > 0 ? (
          <div className="mb-3 flex gap-2.5">
            <ActionButton onClick={() => void markAll()} disabled={unread === 0}>
              <CheckCheck className="h-4 w-4" /> Прочитать все
            </ActionButton>
            <ActionButton tone="danger" onClick={() => void clearAll()}>
              <Trash2 className="h-4 w-4" /> Очистить
            </ActionButton>
          </div>
        ) : null}

        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading ? (
          <ListSkeleton rows={5} />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={<Bell className="h-6 w-6" />}
            title="Уведомлений нет"
            description="Здесь появятся сигналы от водителей, напоминания о выгрузке и платежах"
          />
        ) : (
          <div className="space-y-2.5">
            {notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void open(item)}
                className={`block w-full rounded-2xl border p-4 text-left active:bg-white/[0.06] ${
                  item.isRead
                    ? "border-white/8 bg-white/[0.02]"
                    : "border-orange-500/25 bg-orange-500/[0.07]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-[18px] leading-none">
                    {TYPE_ICONS[item.type] ?? (item.priority === "high" ? "⚠️" : "🔔")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={`text-[14.5px] font-medium ${item.isRead ? "text-zinc-300" : "text-white"}`}>
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-zinc-500">{formatRelative(item.createdAt)}</span>
                    </span>
                    {item.message ? (
                      <span className="mt-1 block text-[13px] leading-relaxed text-zinc-400">{item.message}</span>
                    ) : null}
                    {item.priority === "high" && !item.isRead ? (
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" /> важное
                      </span>
                    ) : null}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
