// Общие куски экранов владельца: подписи, форматы, плитки и панели.

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

export const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  logist: "Логист",
  driver: "Водитель",
}

export const USER_STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  pending: "Ждёт подтверждения",
  suspended: "Заблокирован",
  inactive: "Выключен",
}

export const ACTION_LABELS: Record<string, string> = {
  login: "Вход",
  register: "Регистрация",
  create: "Создание",
  update: "Изменение",
  delete: "Удаление",
  approve: "Одобрение",
  deactivate: "Блокировка",
  activate: "Разблокировка",
  change_role: "Смена роли",
  invite_create: "Приглашение",
  invite_revoke: "Отзыв приглашения",
}

export const ACTION_OPTIONS = Object.keys(ACTION_LABELS)

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
})

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Moscow",
})

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d)
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value)
}

/** «1 сотрудник», «2 сотрудника», «5 сотрудников» */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

export function Tile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
  delay = 0,
}: {
  icon: LucideIcon
  label: string
  value: number | string
  hint?: string
  tone?: "primary" | "success" | "warning" | "chart-2"
  delay?: number
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/15 text-success"
      : tone === "warning"
        ? "bg-warning/15 text-warning"
        : tone === "chart-2"
          ? "bg-chart-2/15 text-chart-2"
          : "bg-primary/15 text-primary"
  return (
    <div
      className="rounded-xl border border-border bg-card p-4 transition-colors duration-200 hover:border-primary/40"
      style={{ animation: `rise-in 520ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms both` }}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[22px] font-semibold leading-none tabular-nums">{value}</p>
          <p className="mt-1 truncate text-[12.5px] text-muted-foreground">{label}</p>
        </div>
      </div>
      {hint ? <p className="mt-2 text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-border bg-card ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Forbidden({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-[14px] text-destructive">
      {message}
    </div>
  )
}
