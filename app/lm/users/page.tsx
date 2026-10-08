// app/lm/users/page.tsx — сотрудники и доступ: заявки, блокировки, пароли.
//
// Раньше этот раздел существовал только в полной версии: админ с телефона
// попадал в широкую таблицу, где кнопки «Одобрить» и «Сбросить пароль»
// уезжали за край экрана. Здесь те же действия лежат в карточке сотрудника
// и доступны в один тап.
//
// API: GET /api/auth/users, PATCH /api/auth/users/{id} с действиями
// approve / reject / suspend / restore / setRole / resetPassword. Доступен
// обеим штабным ролям: админ и логист — один профиль.

"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  BadgeCheck,
  Ban,
  Copy,
  KeyRound,
  Loader2,
  Phone,
  RotateCcw,
  Search,
  Undo2,
  UserRound,
  Users,
  X,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { ActionButton, Card, EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useStaffSession } from "@/hooks/use-staff-session"
import { formatDateShort, formatRelative, telHref } from "@/lib/logist-mobile/format"

const PAGE_SIZE = 25

const STATUS_FILTERS: Array<{ id: string; label: string }> = [
  { id: "pending", label: "Ожидают" },
  { id: "active", label: "Активные" },
  { id: "suspended", label: "Доступ закрыт" },
  { id: "all", label: "Все" },
]

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  logist: "Логист",
  driver: "Водитель",
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "Ждёт одобрения", className: "bg-warning/15 text-warning" },
  active: { label: "Активен", className: "bg-success/15 text-success" },
  suspended: { label: "Доступ закрыт", className: "bg-destructive/15 text-destructive" },
}

interface StaffRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: string
  status: string
  mustChangePassword: boolean
  createdAt: string
  suspendedAt: string | null
  suspendReason: string | null
  lastLoginAt: string | null
  driverId: string | null
  inviteCode: { code: string } | null
  activeSessions: number
}

interface UsersResponse {
  success: boolean
  users: StaffRow[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  pendingCount: number
  error?: string
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  )
}

export default function MobileUsersPage() {
  const { user } = useStaffSession()
  // Админ и логист — один профиль: действия над сотрудниками доступны обоим
  const canManage = !!user && user.role !== "driver"

  const [status, setStatus] = useState("pending")
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [rows, setRows] = useState<StaffRow[]>([])
  const [pagination, setPagination] = useState<UsersResponse["pagination"] | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<{ userId: string; password: string } | null>(null)
  const [suspendFor, setSuspendFor] = useState<string | null>(null)
  const [suspendReason, setSuspendReason] = useState("")
  const [roleFor, setRoleFor] = useState<string | null>(null)

  // Поиск не должен стучать в API на каждую букву
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 350)
    return () => clearTimeout(timer)
  }, [query])

  const load = useCallback(
    async (page: number, append: boolean) => {
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          status,
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (debounced) params.set("q", debounced)

        const response = await fetch(`/api/auth/users?${params.toString()}`, { cache: "no-store" })
        const data = (await response.json().catch(() => null)) as UsersResponse | null
        if (!response.ok || !data?.success) {
          setError(data?.error || "Не удалось загрузить сотрудников")
          return
        }
        setRows((prev) => (append ? [...prev, ...data.users] : data.users))
        setPagination(data.pagination)
        setPendingCount(data.pendingCount ?? 0)
      } catch {
        setError("Сервер недоступен")
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [status, debounced],
  )

  useEffect(() => {
    if (user) void load(1, false)
  }, [user, load])

  const runAction = useCallback(
    async (target: StaffRow, action: string, extra: Record<string, unknown> = {}) => {
      setBusyId(target.id)
      try {
        const response = await fetch(`/api/auth/users/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...extra }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data?.success) {
          toast.error(data?.error || "Действие не выполнено")
          return null
        }
        toast.success(data.message || "Готово")
        return data as { temporaryPassword?: string }
      } catch {
        toast.error("Ошибка соединения")
        return null
      } finally {
        setBusyId(null)
      }
    },
    [],
  )

  const total = pagination?.total ?? rows.length
  const loadedAll = !pagination || pagination.page >= pagination.totalPages

  const subtitle = useMemo(() => {
    if (pendingCount > 0) return `${pendingCount} ждёт одобрения · всего ${total}`
    return `Всего ${total}`
  }, [pendingCount, total])

  return (
    <>
      <LogistHeader title="Сотрудники" subtitle={subtitle} userName={user?.name} />

      <div className="sticky top-[calc(57px+env(safe-area-inset-top))] z-20 border-b border-border surface-glass px-4 pb-2.5 pt-3 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            inputMode="search"
            placeholder="Имя, телефон, почта"
            className="h-11 w-full rounded-xl border border-border bg-secondary pl-9 pr-9 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStatus(item.id)}
              className={`rounded-md border px-3 py-1.5 text-[13px] font-medium ${
                status === item.id
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card shadow-sm text-muted-foreground"
              }`}
            >
              {item.label}
              {item.id === "pending" && pendingCount > 0 ? ` · ${pendingCount}` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5 px-4 pt-3.5">
        {error ? (
          <ErrorState message={error} onRetry={() => void load(1, false)} />
        ) : loading ? (
          <ListSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title={status === "pending" ? "Заявок нет" : "Никого не найдено"}
            description={
              status === "pending"
                ? "Новые сотрудники появятся здесь после регистрации по коду приглашения."
                : undefined
            }
          />
        ) : (
          rows.map((row) => {
            const meta = STATUS_META[row.status] ?? STATUS_META.active
            const busy = busyId === row.id
            const shown = tempPassword?.userId === row.id ? tempPassword.password : null

            return (
              <Card key={row.id} className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-[13px] font-semibold text-foreground">
                    {initials(row.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-foreground">{row.name}</p>
                    <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                      {ROLE_LABELS[row.role] ?? row.role}
                      {row.email ? ` · ${row.email}` : row.phone ? ` · ${row.phone}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${meta.className}`}>
                        {meta.label}
                      </span>
                      {row.activeSessions > 0 ? (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                          {row.activeSessions} сессий
                        </span>
                      ) : null}
                      {row.driverId ? (
                        <Link
                          href="/lm/drivers"
                          className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground"
                        >
                          карточка водителя
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="space-y-1 text-[12.5px] text-muted-foreground">
                  {row.lastLoginAt ? <p>Последний вход: {formatRelative(row.lastLoginAt)}</p> : null}
                  {row.status === "pending" ? (
                    <p>
                      Заявка от {formatDateShort(row.createdAt)}
                      {row.inviteCode?.code ? ` · код ${row.inviteCode.code}` : ""}
                    </p>
                  ) : null}
                  {row.status === "suspended" ? (
                    <p className="text-destructive/80">
                      Заблокирован {formatDateShort(row.suspendedAt)}
                      {row.suspendReason ? ` · ${row.suspendReason}` : ""}
                    </p>
                  ) : null}
                </div>

                {shown ? (
                  <div className="rounded-xl border border-success/25 bg-success/[0.08] p-3">
                    <p className="text-[12px] text-success">
                      Временный пароль — передайте сотруднику, он сменит его при входе:
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 select-all rounded-lg bg-black/30 px-3 py-2 text-[15px] font-semibold tracking-wide text-foreground">
                        {shown}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(shown)
                          toast.success("Пароль скопирован")
                        }}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground active:opacity-70"
                        aria-label="Скопировать пароль"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : null}

                {roleFor === row.id ? (
                  <div className="rounded-xl border border-border bg-card shadow-sm p-3">
                    <p className="text-[12.5px] text-muted-foreground">Новая роль</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {[
                        { id: "logist", label: "Логист" },
                        { id: "admin", label: "Администратор" },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          disabled={busy || option.id === row.role}
                          onClick={async () => {
                            const done = await runAction(row, "setRole", { role: option.id })
                            setRoleFor(null)
                            if (done) void load(1, false)
                          }}
                          className={`min-h-[44px] rounded-xl text-[14px] font-medium disabled:opacity-40 ${
                            option.id === row.role
                              ? "bg-primary/20 text-primary"
                              : "bg-secondary text-foreground active:opacity-70"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {suspendFor === row.id ? (
                  <div className="rounded-xl border border-border bg-card shadow-sm p-3">
                    <input
                      value={suspendReason}
                      onChange={(event) => setSuspendReason(event.target.value)}
                      placeholder="Причина блокировки (необязательно)"
                      className="h-11 w-full rounded-xl border border-border bg-secondary px-3 text-[14.5px] text-foreground placeholder:text-muted-foreground/80 focus:border-primary/50 focus:outline-none"
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSuspendFor(null)
                          setSuspendReason("")
                        }}
                        className="min-h-[44px] rounded-xl bg-secondary text-[14px] font-medium text-foreground active:opacity-70"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          const done = await runAction(row, "suspend", {
                            reason: suspendReason.trim() || undefined,
                          })
                          setSuspendFor(null)
                          setSuspendReason("")
                          if (done) void load(1, false)
                        }}
                        className="min-h-[44px] rounded-xl bg-destructive/20 text-[14px] font-medium text-destructive active:opacity-70 disabled:opacity-40"
                      >
                        Заблокировать
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  {row.status === "pending" ? (
                    <>
                      <ActionButton
                        tone="primary"
                        disabled={busy}
                        onClick={async () => {
                          const done = await runAction(row, "approve")
                          if (done) void load(1, false)
                        }}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                        Одобрить
                      </ActionButton>
                      <ActionButton
                        tone="danger"
                        disabled={busy}
                        onClick={async () => {
                          const done = await runAction(row, "reject")
                          if (done) void load(1, false)
                        }}
                      >
                        <X className="h-4 w-4" /> Отклонить
                      </ActionButton>
                    </>
                  ) : null}

                  {/* Блокировки, пароли и роли: админ и логист — один профиль */}
                  {canManage && row.status === "suspended" ? (
                    <>
                      <ActionButton
                        tone="primary"
                        disabled={busy}
                        onClick={async () => {
                          const done = await runAction(row, "restore")
                          if (done) void load(1, false)
                        }}
                      >
                        <Undo2 className="h-4 w-4" /> Вернуть доступ
                      </ActionButton>
                      <ActionButton
                        disabled={busy}
                        onClick={async () => {
                          const done = await runAction(row, "resetPassword")
                          if (done?.temporaryPassword) {
                            setTempPassword({ userId: row.id, password: done.temporaryPassword })
                          }
                          void load(1, false)
                        }}
                      >
                        <KeyRound className="h-4 w-4" /> Новый пароль
                      </ActionButton>
                    </>
                  ) : null}

                  {canManage && row.status === "active" ? (
                    <>
                      <ActionButton
                        disabled={busy}
                        onClick={async () => {
                          const done = await runAction(row, "resetPassword")
                          if (done?.temporaryPassword) {
                            setTempPassword({ userId: row.id, password: done.temporaryPassword })
                          }
                          void load(1, false)
                        }}
                      >
                        <KeyRound className="h-4 w-4" /> Сбросить пароль
                      </ActionButton>
                      {row.role === "driver" && telHref(row.phone) ? (
                        <a
                          href={telHref(row.phone) ?? undefined}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-secondary px-4 text-[14px] font-medium text-foreground active:opacity-70"
                        >
                          <Phone className="h-4 w-4" /> Позвонить
                        </a>
                      ) : (
                        <ActionButton disabled={busy} onClick={() => setRoleFor(row.id)}>
                          <UserRound className="h-4 w-4" /> Сменить роль
                        </ActionButton>
                      )}
                    </>
                  ) : null}
                </div>

                {canManage && row.status === "active" && row.role !== "driver" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSuspendFor(row.id)
                      setSuspendReason("")
                    }}
                    className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl bg-secondary text-[13px] font-medium text-destructive active:opacity-70"
                  >
                    <Ban className="h-3.5 w-3.5" /> Закрыть доступ
                  </button>
                ) : null}
              </Card>
            )
          })
        )}

        {!loading && !error && rows.length > 0 && !loadedAll ? (
          <ActionButton
            full
            disabled={loadingMore}
            onClick={() => void load((pagination?.page ?? 1) + 1, true)}
          >
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Показать ещё
          </ActionButton>
        ) : null}

        <Card className="mt-1 flex items-start gap-3">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Заявки появляются после регистрации по коду приглашения. Код создаётся в разделе
            «Организация».

          </p>
        </Card>
      </div>
    </>
  )
}
