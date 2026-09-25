"use client"

/**
 * /users — сотрудники и доступ.
 *
 * Заявки на присоединение одобряет любой сотрудник организации — и логист, и
 * администратор (решение пользователя от 2026-09-24).
 *
 * Остальное — только администратор организации:
 *  • закрыть доступ уволенному сотруднику (active → suspended, с указанием причины;
 *    все его сессии немедленно отзываются, запись в базе остаётся),
 *  • восстановить доступ (suspended → active),
 *  • сбросить пароль (пользователь обязан сменить его при следующем входе),
 *  • сменить роль (admin / logist),
 *  • снять блокировку после серии неудачных попыток входа.
 *
 * Это единственное место, где принимают решения по людям: заявки одобряются и
 * отклоняются здесь (на странице «Организация» остались инвайт-коды и карточка
 * компании со счётчиком заявок и ссылкой сюда).
 *
 * «Отклонить» у заявки — это reject: запись удаляется, а использование
 * инвайт-кода возвращается, чтобы код не «сгорал» из-за отклонённого человека.
 * Роль будущего сотрудника задаётся администратором при создании кода и при
 * одобрении не выбирается.
 */

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PageLayout } from "@/components/page-layout"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { fetchJsonCached, invalidateCache } from "@/lib/client-cache"
import { DataTable, type DataTableColumn } from "@/components/ui/data-table"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  ShieldOff,
  ShieldCheck,
  UserCog,
  Users,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

interface UserRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: "admin" | "logist" | "driver"
  status: "pending" | "active" | "suspended"
  mustChangePassword: boolean
  createdAt: string
  approvedAt: string | null
  suspendedAt: string | null
  suspendReason: string | null
  lastLoginAt: string | null
  activeSessions: number
  isLocked: boolean
  driverId: string | null
  driver: { id: string; name: string; vehiclePlate: string | null } | null
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  logist: "Логист",
  driver: "Водитель",
}

const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  pending: { label: "Ожидает одобрения", className: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  active: { label: "Доступ открыт", className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
  suspended: { label: "Доступ закрыт", className: "bg-destructive/15 text-destructive border-destructive/30" },
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function UsersPage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()

  const [users, setUsers] = useState<UserRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [statusFilter, setStatusFilter] = useState<"pending" | "active" | "suspended" | "all">(
    "pending",
  )
  const [query, setQuery] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  // Диалог отклонения заявки (reject: заявка удаляется, использование кода возвращается)
  const [rejectTarget, setRejectTarget] = useState<UserRow | null>(null)

  // Диалог закрытия доступа
  const [suspendTarget, setSuspendTarget] = useState<UserRow | null>(null)
  const [suspendReason, setSuspendReason] = useState("")

  // Диалог сброса пароля
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)

  const isAdmin = user?.role === "admin"

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login")
  }, [user, authLoading, router])

  const fetchUsers = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        page: String(page),
        pageSize: "25",
      })
      if (query.trim()) params.set("q", query.trim())

      // Через кеш: пагинация, фильтры и поиск листаются туда-обратно, и каждый
      // шаг не должен тянуть таблицу заново
      const data = await fetchJsonCached<any>(`/api/auth/users?${params.toString()}`)

      setUsers(data.users || [])
      setPagination(data.pagination || null)
      setPendingCount(data.pendingCount || 0)
    } catch (error) {
      console.error("[/users] ошибка загрузки:", error)
      toast.error("Ошибка соединения")
    } finally {
      setIsLoading(false)
    }
  }, [statusFilter, page, query])

  useEffect(() => {
    if (user) void fetchUsers()
  }, [user, fetchUsers])

  const runAction = async (
    target: UserRow,
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ ok: boolean; message?: string; temporaryPassword?: string }> => {
    setBusyUserId(target.id)
    try {
      const res = await fetch(`/api/auth/users/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Действие не выполнено")
        return { ok: false, message: data?.error }
      }

      // Список и счётчик заявок изменились: кеш страницы больше не актуален,
      // иначе повторный запрос вернул бы старую строку со статусом
      invalidateCache("/api/auth/users")
      toast.success(data.message || "Готово")
      return { ok: true, message: data.message, temporaryPassword: data.temporaryPassword }
    } catch (error) {
      console.error(`[/users] действие ${action} не выполнено:`, error)
      toast.error("Ошибка соединения")
      return { ok: false }
    } finally {
      setBusyUserId(null)
    }
  }

  const handleApprove = async (target: UserRow) => {
    const result = await runAction(target, "approve")
    if (result.ok) void fetchUsers()
  }

  const handleReject = async () => {
    if (!rejectTarget) return
    const result = await runAction(rejectTarget, "reject")
    if (result.ok) {
      setRejectTarget(null)
      void fetchUsers()
    }
  }

  const handleRestore = async (target: UserRow) => {
    const result = await runAction(target, "restore")
    if (result.ok) void fetchUsers()
  }

  const handleSuspend = async () => {
    if (!suspendTarget) return
    const result = await runAction(suspendTarget, "suspend", {
      reason: suspendReason.trim() || undefined,
    })
    if (result.ok) {
      setSuspendTarget(null)
      setSuspendReason("")
      void fetchUsers()
    }
  }

  const handleResetPassword = async () => {
    if (!resetTarget) return
    const result = await runAction(resetTarget, "resetPassword")
    if (result.ok) {
      setTemporaryPassword(result.temporaryPassword || null)
      void fetchUsers()
    }
  }

  const handleRoleChange = async (target: UserRow, role: string) => {
    const result = await runAction(target, "setRole", { role })
    if (result.ok) void fetchUsers()
  }

  const handleUnlock = async (target: UserRow) => {
    const result = await runAction(target, "unlock")
    if (result.ok) void fetchUsers()
  }

  // Столбцы таблицы сотрудников — рисует единый DataTable
  const userColumns: DataTableColumn<UserRow>[] = [
    {
      key: "person",
      label: "Сотрудник",
      align: undefined,
      cell: (row) => {
        const status = STATUS_META[row.status] || STATUS_META.pending
        const busy = busyUserId === row.id
        const isSelf = row.id === user?.id
        return (
          <>
            <div className="font-medium">{row.name}</div>
            <div className="text-xs text-muted-foreground">
              {row.email || row.phone || "—"}
              {row.driver?.vehiclePlate ? ` · ${row.driver.vehiclePlate}` : ""}
            </div>
            {row.isLocked && (
              <Badge variant="outline" className="mt-1 border-destructive/40 text-destructive text-[10px]">
                вход заблокирован
              </Badge>
            )}
            {row.mustChangePassword && (
              <Badge variant="outline" className="mt-1 ml-1 border-amber-500/40 text-amber-500 text-[10px]">
                сменит пароль при входе
              </Badge>
            )}
          </>
        )
      },
    },
    {
      key: "role",
      label: "Роль",
      align: undefined,
      cell: (row) => {
        const status = STATUS_META[row.status] || STATUS_META.pending
        const busy = busyUserId === row.id
        const isSelf = row.id === user?.id
        return (
          <>
            {isAdmin && !row.driverId && row.status !== "pending" ? (
              <Select
                value={row.role}
                onValueChange={(value) => void handleRoleChange(row, value)}
                disabled={busy || isSelf || !isAdmin}
              >
                <SelectTrigger className="w-40 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Администратор</SelectItem>
                  <SelectItem value="logist">Логист</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm">
                {ROLE_LABELS[row.role] || row.role}
                {row.status === "pending" && (
                  <span className="text-xs text-muted-foreground"> · из кода</span>
                )}
              </span>
            )}
          </>
        )
      },
    },
    {
      key: "status",
      label: "Статус",
      align: undefined,
      cell: (row) => {
        const status = STATUS_META[row.status] || STATUS_META.pending
        const busy = busyUserId === row.id
        const isSelf = row.id === user?.id
        return (
          <>
            <Badge variant="outline" className={status.className}>
              {status.label}
            </Badge>
            {row.status === "suspended" && row.suspendReason && (
              <div className="text-xs text-muted-foreground mt-1 max-w-[220px]">
                {row.suspendReason}
              </div>
            )}
          </>
        )
      },
    },
    {
      key: "login",
      label: "Последний вход",
      align: undefined,
      cellClassName: "text-sm text-muted-foreground",
      cell: (row) => {
        const status = STATUS_META[row.status] || STATUS_META.pending
        const busy = busyUserId === row.id
        const isSelf = row.id === user?.id
        return (
          <>
            {formatDate(row.lastLoginAt)}
          </>
        )
      },
    },
    {
      key: "sessions",
      label: "Сессии",
      align: "center",
      cellClassName: "text-center text-center text-sm",
      cell: (row) => {
        const status = STATUS_META[row.status] || STATUS_META.pending
        const busy = busyUserId === row.id
        const isSelf = row.id === user?.id
        return (
          <>
            {row.activeSessions}
          </>
        )
      },
    },
    {
      key: "actions",
      label: "Действия",
      align: "right",
      cellClassName: "text-right",
      cell: (row) => {
        const status = STATUS_META[row.status] || STATUS_META.pending
        const busy = busyUserId === row.id
        const isSelf = row.id === user?.id
        return (
          <>
            <div className="flex items-center justify-end gap-2 flex-wrap">
              {row.status === "pending" && (
                <>
                  {/* Одобрить заявку может и логист, и администратор
                      организации (решение пользователя 2026-09-24). */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-500"
                    disabled={busy}
                    onClick={() => void handleApprove(row)}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    )}
                    Одобрить
                  </Button>
                  {/* Отклонить заявку может и логист, и администратор:
                      reject удаляет заявку и возвращает использование кода. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => setRejectTarget(row)}
                  >
                    <XCircle className="h-4 w-4 mr-1.5" />
                    Отклонить
                  </Button>
                </>
              )}
              {row.status === "active" && !isSelf && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busy || !isAdmin}
                  onClick={() => {
                    setSuspendReason("")
                    setSuspendTarget(row)
                  }}
                >
                  <ShieldOff className="h-4 w-4 mr-1.5" />
                  Закрыть доступ
                </Button>
              )}
              {row.status === "suspended" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !isAdmin}
                  onClick={() => void handleRestore(row)}
                >
                  <ShieldCheck className="h-4 w-4 mr-1.5" />
                  Восстановить
                </Button>
              )}
              {row.isLocked && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !isAdmin}
                  onClick={() => void handleUnlock(row)}
                >
                  Снять блокировку
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !isAdmin}
                onClick={() => {
                  setTemporaryPassword(null)
                  setResetTarget(row)
                }}
              >
                <KeyRound className="h-4 w-4 mr-1.5" />
                Сбросить пароль
              </Button>
            </div>
          </>
        )
      },
    },
  ]
  return (
    <PageLayout
      title="Сотрудники и доступ"
      description="Одобрение заявок, закрытие и восстановление доступа, сброс паролей"
      actions={
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-500 gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Заявок в ожидании: {pendingCount}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void fetchUsers()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Обновить
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value as typeof statusFilter)
              setPage(1)
            }}
          >
            <TabsList>
              <TabsTrigger value="pending">Ожидают</TabsTrigger>
              <TabsTrigger value="active">Активные</TabsTrigger>
              <TabsTrigger value="suspended">Доступ закрыт</TabsTrigger>
              <TabsTrigger value="all">Все</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск по имени, email или телефону"
                className="pl-9 w-full sm:w-72"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setPage(1)
                    setQuery(searchInput)
                  }
                }}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setPage(1)
                setQuery(searchInput)
              }}
            >
              Найти
            </Button>
          </div>
        </div>

        <DataTable
          columns={userColumns}
          rows={users}
          rowKey={(row) => row.id}
          density="compact"
          isLoading={isLoading}
          skeletonRows={5}
          empty={
            <p className="py-12 text-center text-sm text-muted-foreground">Никого не найдено</p>
          }
        />

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Всего: {pagination.total} · страница {pagination.page} из {pagination.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages || isLoading}
                onClick={() => setPage((prev) => prev + 1)}
              >
                Вперёд
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Диалог отклонения заявки */}
      <Dialog open={Boolean(rejectTarget)} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              Отклонить заявку
            </DialogTitle>
            <DialogDescription>
              Заявка «{rejectTarget?.name ?? ""}» будет удалена, а использование кода
              приглашения вернётся — код не «сгорит» из-за отклонённого человека. Если
              сотрудник уже работал и нужно сохранить историю, вместо этого закройте ему
              доступ («Закрыть доступ» в списке сотрудников).
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleReject()}
              disabled={busyUserId === rejectTarget?.id}
            >
              {busyUserId === rejectTarget?.id && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Отклонить заявку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог закрытия доступа */}
      <Dialog open={Boolean(suspendTarget)} onOpenChange={(open) => !open && setSuspendTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldOff className="h-5 w-5 text-destructive" />
              Закрыть доступ
            </DialogTitle>
            <DialogDescription>
              {suspendTarget?.name} не сможет войти в систему, все активные сессии будут
              завершены. Запись останется в базе — доступ можно восстановить в любой момент.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="suspend-reason">Причина</Label>
            <Textarea
              id="suspend-reason"
              placeholder="Например: уволен 21.09.2026"
              value={suspendReason}
              onChange={(event) => setSuspendReason(event.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendTarget(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleSuspend()}
              disabled={busyUserId === suspendTarget?.id || !isAdmin}
            >
              {busyUserId === suspendTarget?.id && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Закрыть доступ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог сброса пароля */}
      <Dialog open={Boolean(resetTarget)} onOpenChange={(open) => !open && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Сброс пароля
            </DialogTitle>
            <DialogDescription>
              {temporaryPassword
                ? "Передайте пароль пользователю — при входе система потребует его сменить. Пароль показывается один раз."
                : `Для «${resetTarget?.name ?? ""}» будет создан временный пароль, все его сессии будут завершены.`}
            </DialogDescription>
          </DialogHeader>

          {temporaryPassword && (
            <div className="rounded-lg border border-border bg-secondary/50 p-4">
              <div className="text-xs text-muted-foreground mb-1">Временный пароль</div>
              <div className="font-mono text-lg break-all">{temporaryPassword}</div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              {temporaryPassword ? "Закрыть" : "Отмена"}
            </Button>
            {!temporaryPassword && (
              <Button
                onClick={() => void handleResetPassword()}
                disabled={busyUserId === resetTarget?.id || !isAdmin}
              >
                {busyUserId === resetTarget?.id && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                <UserCog className="h-4 w-4 mr-2" />
                Сбросить пароль
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  )
}
