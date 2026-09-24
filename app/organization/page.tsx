"use client"

/**
 * /organization — панель администратора организации.
 *
 * Что здесь делает админ своей компании:
 *   1. видит карточку организации (название, дата создания, состав);
 *   2. создаёт и отзывает инвайт-коды — единственный способ присоединиться
 *      к компании (по названию присоединиться нельзя);
 *   3. видит счётчик заявок и переходит к ним.
 *
 * Решения по заявкам (одобрить/отклонить) и все действия с доступом сотрудников
 * живут в одном месте — на странице «Сотрудники» (/users), чтобы не держать два
 * одинаковых экрана. Одобряет и отклоняет заявки и логист, и администратор.
 *
 * Организация всегда приходит с сервера из сессии: на экране нет и не может
 * быть переключателя «выбрать компанию».
 */

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { PageLayout } from "@/components/page-layout"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  AlertCircle,
  Ban,
  Building2,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Truck,
  UserCheck,
  Users,
} from "lucide-react"

interface OrganizationInfo {
  id: string
  name: string
  createdAt: string
}

interface Summary {
  members: number
  pending: number
  drivers: number
  vehicles: number
  activeInvites: number
}

interface InviteView {
  id: string
  code: string
  role: string
  expiresAt: string | null
  maxUses: number | null
  usedCount: number
  usesLeft: number | null
  revokedAt: string | null
  createdAt: string
  status: "active" | "expired" | "revoked" | "exhausted"
  registeredUsers: number
}

const EXPIRY_OPTIONS = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
  { value: "none", label: "Бессрочно" },
]

const INVITE_STATUS_META: Record<
  InviteView["status"],
  { label: string; className: string }
> = {
  active: { label: "действует", className: "border-emerald-500/40 text-emerald-500" },
  expired: { label: "истёк", className: "border-muted-foreground/40 text-muted-foreground" },
  revoked: { label: "отозван", className: "border-destructive/40 text-destructive" },
  exhausted: { label: "исчерпан", className: "border-amber-500/40 text-amber-500" },
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" })
}

function formatDateTime(value: string | null): string {
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

export default function OrganizationPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [organization, setOrganization] = useState<OrganizationInfo | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [invites, setInvites] = useState<InviteView[]>([])

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  // форма нового кода
  const [role, setRole] = useState<"logist" | "admin">("logist")
  const [expiry, setExpiry] = useState("30")
  const [maxUses, setMaxUses] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  const [busyInviteId, setBusyInviteId] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState("")

  const load = useCallback(async () => {
    setIsLoading(true)
    setLoadError("")
    try {
      // Список заявок здесь не грузим: решения по людям принимаются на странице
      // «Сотрудники» (/users), а количество ожидающих приходит в summary.pending.
      const orgRes = await fetch("/api/organization", { cache: "no-store" })
      const orgData = await orgRes.json().catch(() => ({}))

      if (!orgRes.ok || !orgData?.success) {
        setLoadError(orgData?.error || "Не удалось загрузить данные организации")
        return
      }

      setOrganization(orgData.organization)
      setSummary(orgData.summary)

      if (isAdmin) {
        const invitesRes = await fetch("/api/organization/invites", { cache: "no-store" })
        const invitesData = await invitesRes.json().catch(() => ({}))
        setInvites(invitesRes.ok && invitesData?.success ? invitesData.invites || [] : [])
      }
    } catch {
      setLoadError("Ошибка соединения. Обновите страницу")
    } finally {
      setIsLoading(false)
    }
  }, [isAdmin])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreateInvite = async () => {
    setError("")
    setNotice("")
    setIsCreating(true)
    try {
      const parsedMaxUses = maxUses.trim() === "" ? null : Number(maxUses.trim())
      const res = await fetch("/api/organization/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          expiresInDays: expiry === "none" ? null : Number(expiry),
          maxUses: parsedMaxUses,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setError(data?.error || "Не удалось создать код приглашения")
        return
      }
      setInvites((prev) => [data.invite, ...prev])
      setNotice(`Код ${data.invite.code} создан. Скопируйте его или ссылку и передайте сотруднику`)
      setMaxUses("")
      await load()
    } catch {
      setError("Ошибка соединения")
    } finally {
      setIsCreating(false)
    }
  }

  const handleRevoke = async (invite: InviteView) => {
    setError("")
    setNotice("")
    setBusyInviteId(invite.id)
    try {
      const res = await fetch(`/api/organization/invites/${invite.id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.success) {
        setError(data?.error || "Не удалось отозвать код")
        return
      }
      setInvites((prev) =>
        prev.map((row) =>
          row.id === invite.id
            ? { ...row, status: "revoked", revokedAt: new Date().toISOString() }
            : row,
        ),
      )
      setNotice(`Код ${invite.code} отозван`)
    } catch {
      setError("Ошибка соединения")
    } finally {
      setBusyInviteId(null)
    }
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedCode(label)
      setTimeout(() => setCopiedCode(""), 2000)
    } catch {
      setError("Не удалось скопировать — выделите текст вручную")
    }
  }

  const inviteLink = (code: string) =>
    `${typeof window === "undefined" ? "" : window.location.origin}/register?invite=${code.replace(/-/g, "")}`

  return (
    <PageLayout
      title="Организация"
      description="Инвайт-коды вашей компании и заявки на присоединение"
      actions={
        summary && summary.pending > 0 ? (
          <Badge variant="outline" className="border-amber-500/40 text-amber-500 gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Заявок в ожидании: {summary.pending}
          </Badge>
        ) : undefined
      }
    >
      {loadError && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 text-sm text-emerald-500 bg-emerald-500/10 p-3 rounded-lg">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Карточка организации ─────────────────────────────────────── */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-primary" />
            {isLoading && !organization ? "Загружаем..." : organization?.name || "—"}
          </CardTitle>
          <CardDescription>
            Организация создана {formatDate(organization?.createdAt ?? null)}. Все данные —
            заказы, водители, машины, рейсы — видны только сотрудникам этой организации.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Сотрудников", value: summary?.members, icon: Users },
              { label: "Заявок", value: summary?.pending, icon: UserCheck },
              { label: "Водителей", value: summary?.drivers, icon: Truck },
              { label: "Машин", value: summary?.vehicles, icon: Truck },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-border/50 bg-muted/20 p-3 flex items-center gap-3"
              >
                <item.icon className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-xl font-semibold">
                    {item.value === undefined ? "—" : item.value}
                  </div>
                  <div className="text-xs text-muted-foreground">{item.label}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {!isAdmin && (
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                Инвайт-коды создаёт и отзывает администратор организации. Заявки на
                присоединение вы можете одобрять и отклонять — на странице «Сотрудники».
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Инвайт-коды ─────────────────────────────────────────────── */}
      {isAdmin && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-5 w-5 text-primary" />
              Коды приглашения
            </CardTitle>
            <CardDescription>
              Сотрудник вводит код при регистрации и попадает в вашу организацию со статусом
              «ожидает одобрения». Роль и организация берутся из кода, а не из формы.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="space-y-2">
                <Label htmlFor="invite-role">Роль сотрудника</Label>
                <Select value={role} onValueChange={(value) => setRole(value as "logist" | "admin")}>
                  <SelectTrigger id="invite-role" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="logist">Логист</SelectItem>
                    <SelectItem value="admin">Администратор</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-expiry">Срок действия</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger id="invite-expiry" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-max-uses">
                  Лимит использований <span className="text-muted-foreground">(пусто = без лимита)</span>
                </Label>
                <Input
                  id="invite-max-uses"
                  type="number"
                  min={1}
                  max={1000}
                  placeholder="10"
                  className="h-9"
                  value={maxUses}
                  onChange={(event) => setMaxUses(event.target.value)}
                />
              </div>

              <Button
                onClick={() => void handleCreateInvite()}
                disabled={isCreating}
                className="h-9"
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <KeyRound className="h-4 w-4 mr-2" />
                    Создать код
                  </>
                )}
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Код</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Действует до</TableHead>
                  <TableHead>Использован</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                      Кодов пока нет — создайте первый
                    </TableCell>
                  </TableRow>
                ) : (
                  invites.map((invite) => {
                    const status = INVITE_STATUS_META[invite.status]
                    return (
                      <TableRow key={invite.id}>
                        <TableCell>
                          <div className="font-mono text-sm tracking-wider">{invite.code}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <button
                              type="button"
                              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                              onClick={() => void copyToClipboard(invite.code, invite.id)}
                            >
                              <Copy className="h-3 w-3" />
                              {copiedCode === invite.id ? "скопировано" : "код"}
                            </button>
                            <button
                              type="button"
                              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                              onClick={() => void copyToClipboard(inviteLink(invite.code), `${invite.id}-link`)}
                            >
                              <Copy className="h-3 w-3" />
                              {copiedCode === `${invite.id}-link` ? "скопировано" : "ссылка"}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {invite.role === "admin" ? "Администратор" : "Логист"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={status.className}>
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {invite.expiresAt ? formatDateTime(invite.expiresAt) : "бессрочно"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {invite.usedCount}
                          {invite.maxUses === null ? "" : ` / ${invite.maxUses}`}
                          {invite.registeredUsers > 0 && (
                            <div className="text-xs">зарегистрировалось: {invite.registeredUsers}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {invite.status === "active" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={busyInviteId === invite.id}
                              onClick={() => void handleRevoke(invite)}
                            >
                              {busyInviteId === invite.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Ban className="h-4 w-4 mr-1.5" />
                                  Отозвать
                                </>
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Заявки на присоединение ─────────────────────────────────── */}
      {/* Решения по заявкам принимаются на странице «Сотрудники» (/users) — там
          один список людей и все действия по ним. Здесь только счётчик и переход,
          чтобы не держать два одинаковых экрана (решение от 2026-09-24). */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserCheck className="h-5 w-5 text-primary" />
            Заявки на присоединение
          </CardTitle>
          <CardDescription>
            Заявки одобряют и отклоняют на странице «Сотрудники» — это может сделать и
            логист, и администратор организации. Одобряйте только тех, кого знаете: после
            одобрения человек увидит все данные организации. Отклонённая заявка удаляется,
            а использование кода возвращается.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="text-sm text-muted-foreground">
            Ожидают решения:{" "}
            <span className="text-foreground font-semibold">
              {isLoading ? "…" : (summary?.pending ?? 0)}
            </span>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/users">
              <UserCheck className="h-4 w-4 mr-1.5" />
              Перейти к заявкам
            </Link>
          </Button>
        </CardContent>
      </Card>
    </PageLayout>
  )
}
