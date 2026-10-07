// app/lm/audit/page.tsx — журнал действий организации.
//
// Вопрос «кто это сделал?» чаще всего возникает, когда админ далеко от
// компьютера. Экран отвечает на него с телефона: кто, что, над кем и когда.
//
// API: GET /api/admin/audit?limit=&offset=&action=

"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { History, Loader2, ShieldCheck } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { ActionButton, Card, EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useStaffSession } from "@/hooks/use-staff-session"
import { formatDateTime, formatRelative } from "@/lib/logist-mobile/format"

const PAGE_SIZE = 30

// Подписи — по тем действиям, что реально пишет lib/audit.ts и его вызовы.
// Незнакомое действие показываем как есть: пусть лучше будет «unlock», чем
// пустая плашка.
const ACTION_LABELS: Record<string, string> = {
  login: "Вход",
  register: "Регистрация",
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
  approve: "Одобрение сотрудника",
  reject: "Отклонение заявки",
  activate: "Активация доступа",
  deactivate: "Деактивация доступа",
  suspend: "Блокировка доступа",
  restore: "Возврат доступа",
  unlock: "Разблокировка",
  change_role: "Смена роли",
  reset_password: "Сброс пароля",
  invite_create: "Создание приглашения",
  invite_revoke: "Отзыв приглашения",
  order_take_from_base: "Заказ взят в работу",
  order_return_to_base: "Заказ возвращён в базу",
}

const TARGET_TYPE_LABELS: Record<string, string> = {
  user: "сотрудник",
  order: "заказ",
  route: "рейс",
  client: "клиент",
  vehicle: "машина",
  driver: "водитель",
  organization: "организация",
  invite: "приглашение",
  invite_code: "код приглашения",
  ati_connection: "подключение ATI",
}

const TONE_BY_ACTION: Record<string, string> = {
  delete: "bg-red-500/15 text-red-200",
  reject: "bg-red-500/15 text-red-200",
  suspend: "bg-red-500/15 text-red-200",
  deactivate: "bg-red-500/15 text-red-200",
  login: "bg-sky-500/15 text-sky-200",
  approve: "bg-emerald-500/15 text-emerald-200",
  restore: "bg-emerald-500/15 text-emerald-200",
  activate: "bg-emerald-500/15 text-emerald-200",
}

interface AuditRow {
  id: string
  actorEmail: string | null
  action: string
  targetType: string
  targetEmail: string | null
  metadata: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

/** Пара значимых деталей из metadata — без служебного шума. */
function details(metadata: Record<string, unknown> | null): string {
  if (!metadata) return ""
  const parts: string[] = []
  const role = metadata.role
  if (typeof role === "string") parts.push(`роль: ${role}`)
  const reason = metadata.reason
  if (typeof reason === "string" && reason) parts.push(`причина: ${reason}`)
  const organizationName = metadata.organizationName
  if (typeof organizationName === "string" && parts.length === 0) parts.push(organizationName)
  return parts.join(" · ")
}

export default function MobileAuditPage() {
  const { user } = useStaffSession()
  const isAdmin = user?.role === "admin"

  const [action, setAction] = useState("all")
  const [rows, setRows] = useState<AuditRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        if (action !== "all") params.set("action", action)

        const response = await fetch(`/api/admin/audit?${params.toString()}`, { cache: "no-store" })
        const data = await response.json().catch(() => null)
        if (!response.ok || !data?.success) {
          setError(data?.error || "Не удалось загрузить журнал")
          return
        }
        const batch = (data.logs ?? []) as AuditRow[]
        setRows((prev) => (append ? [...prev, ...batch] : batch))
        setHasMore(batch.length === PAGE_SIZE)
      } catch {
        setError("Сервер недоступен")
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [action],
  )

  useEffect(() => {
    if (isAdmin) void load(0, false)
  }, [isAdmin, load])

  if (user && !isAdmin) {
    return (
      <>
        <LogistHeader title="Журнал действий" subtitle="Раздел администратора" userName={user.name} />
        <div className="px-4 pt-4">
          <EmptyState
            icon={<ShieldCheck className="h-6 w-6" />}
            title="Только для администратора"
            description="Журнал входов и изменений видит администратор организации."
            action={
              <Link
                href="/lm"
                className="inline-flex min-h-[44px] items-center rounded-xl bg-white/8 px-4 text-[14px] font-medium text-white"
              >
                На главную
              </Link>
            }
          />
        </div>
      </>
    )
  }

  return (
    <>
      <LogistHeader title="Журнал действий" subtitle="Кто что менял в организации" userName={user?.name} />

      <div className="sticky top-[57px] z-20 border-b border-white/8 bg-[#0b0b0e]/95 px-4 pb-3 pt-3 backdrop-blur">
        {/* Действий много: на телефоне удобнее системный список, чем лента чипов */}
        <label className="block">
          <span className="sr-only">Действие</span>
          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="h-11 w-full appearance-none rounded-xl border border-white/8 bg-white/[0.04] px-3.5 text-[15px] text-white focus:border-orange-500/50 focus:outline-none"
          >
            <option value="all" className="bg-[#15151a]">
              Все действия
            </option>
            {Object.entries(ACTION_LABELS).map(([id, label]) => (
              <option key={id} value={id} className="bg-[#15151a]">
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-2.5 px-4 pt-3.5">
        {error ? (
          <ErrorState message={error} onRetry={() => void load(0, false)} />
        ) : loading ? (
          <ListSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="Записей нет"
            description="Здесь появятся входы, одобрения сотрудников и изменения настроек."
          />
        ) : (
          rows.map((row) => {
            const tone = TONE_BY_ACTION[row.action] ?? "bg-white/8 text-zinc-300"
            const extra = details(row.metadata)
            return (
              <Card key={row.id}>
                <div className="flex items-start justify-between gap-3">
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${tone}`}>
                    {ACTION_LABELS[row.action] ?? row.action}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-zinc-500">{formatRelative(row.createdAt)}</span>
                </div>

                <p className="mt-2 truncate text-[14px] font-medium text-white">
                  {row.actorEmail ?? "система"}
                </p>

                <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
                  {TARGET_TYPE_LABELS[row.targetType] ?? row.targetType}
                  {row.targetEmail ? `: ${row.targetEmail}` : ""}
                  {extra ? ` · ${extra}` : ""}
                </p>

                <p className="mt-1 text-[11.5px] text-zinc-600">
                  {formatDateTime(row.createdAt)}
                  {row.ip ? ` · IP ${row.ip}` : ""}
                </p>
              </Card>
            )
          })
        )}

        {!loading && !error && hasMore ? (
          <ActionButton full disabled={loadingMore} onClick={() => void load(rows.length, true)}>
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Показать ещё
          </ActionButton>
        ) : null}
      </div>
    </>
  )
}
