// app/lm/organization/page.tsx — организация и коды приглашений.
//
// Админ с телефона должен уметь выдать доступ новому логисту, не открывая
// компьютер: создать код, скопировать его или ссылку и отозвать, если код
// ушёл не туда. Всё это умещается в две карточки.
//
// Здесь же — подключение ATI.SU: свой токен организации можно вставить
// с телефона, не открывая компьютер.
//
// API: GET /api/organization, GET|POST /api/organization/invites,
// DELETE /api/organization/invites/{id}, GET|POST|DELETE /api/ati/connection,
// POST /api/ati/connection/check.

"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  Building2,
  Car,
  Check,
  History,
  Copy,
  Link2,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  Truck,
  UserPlus,
  Users,
  X,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { ActionButton, Card, EmptyState, ErrorState, LinkRow, ListSkeleton } from "@/components/logist-mobile/ui"
import { useStaffSession } from "@/hooks/use-staff-session"
import { formatDateShort, plural } from "@/lib/logist-mobile/format"

const EXPIRY_OPTIONS = [
  { id: "30", label: "30 дней" },
  { id: "90", label: "90 дней" },
  { id: "none", label: "Бессрочно" },
]

interface OrgResponse {
  success: boolean
  organization: { id: string; name: string; createdAt: string }
  summary: { members: number; pending: number; drivers: number; vehicles: number; activeInvites: number }
  me: { id: string; role: string; isAdmin: boolean }
  error?: string
}

interface AtiStatus {
  success: boolean
  connected: boolean
  oauthAvailable: boolean
  connection: {
    kind: string
    status: string
    firmId: number | null
    firmName: string | null
    expiresAt: string | null
    lastCheckAt: string | null
    lastError: string | null
  } | null
}

interface InviteRow {
  id: string
  code: string
  role: string
  expiresAt: string | null
  maxUses: number | null
  usedCount: number | null
  usesLeft: number | null
  revokedAt: string | null
  createdAt: string
  status: string
  registeredUsers: number
}

interface InvitesResponse {
  success: boolean
  invites: InviteRow[]
  error?: string
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  logist: "Логист",
}

function inviteLink(code: string): string {
  if (typeof window === "undefined") return ""
  return `${window.location.origin}/register?invite=${code.replace(/-/g, "")}`
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} скопирован`)
  } catch {
    toast.error("Браузер не дал скопировать — выделите вручную")
  }
}

export default function MobileOrganizationPage() {
  const { user } = useStaffSession()

  const [org, setOrg] = useState<OrgResponse | null>(null)
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [role, setRole] = useState("logist")
  const [expiry, setExpiry] = useState("30")
  const [creating, setCreating] = useState(false)
  const [freshCode, setFreshCode] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Подключение ATI.SU: токен организации, проверка и отключение
  const [ati, setAti] = useState<AtiStatus | null>(null)
  const [token, setToken] = useState("")
  const [atiBusy, setAtiBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [orgRes, invitesRes] = await Promise.all([
        fetch("/api/organization", { cache: "no-store" }),
        // Коды приглашений доступны обеим штабным ролям
        fetch("/api/organization/invites", { cache: "no-store" }),
      ])
      const orgData = (await orgRes.json().catch(() => null)) as OrgResponse | null
      if (!orgRes.ok || !orgData?.success) {
        setError(orgData?.error || "Не удалось загрузить организацию")
        return
      }
      setOrg(orgData)

      const invitesData = (await invitesRes.json().catch(() => null)) as InvitesResponse | null
      setInvites(invitesData?.invites ?? [])

      const atiRes = await fetch("/api/ati/connection", { cache: "no-store" })
      const atiData = (await atiRes.json().catch(() => null)) as AtiStatus | null
      setAti(atiData)
    } catch {
      setError("Сервер недоступен")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const createInvite = async () => {
    setCreating(true)
    try {
      const response = await fetch("/api/organization/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          expiresInDays: expiry === "none" ? null : Number(expiry),
          maxUses: null,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        toast.error(data?.error || "Не удалось создать код")
        return
      }
      setFreshCode(data.invite.code)
      setInvites((prev) => [data.invite, ...prev])
      setFormOpen(false)
      toast.success(`Код ${data.invite.code} создан`)
    } catch {
      toast.error("Ошибка соединения")
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (invite: InviteRow) => {
    setBusyId(invite.id)
    try {
      const response = await fetch(`/api/organization/invites/${invite.id}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        toast.error(data?.error || "Не удалось отозвать код")
        return
      }
      setInvites((prev) =>
        prev.map((row) =>
          row.id === invite.id ? { ...row, status: "revoked", revokedAt: new Date().toISOString() } : row,
        ),
      )
      if (freshCode === invite.code) setFreshCode(null)
      toast.success("Код отозван")
    } catch {
      toast.error("Ошибка соединения")
    } finally {
      setBusyId(null)
    }
  }

  const activeInvites = invites.filter((invite) => invite.status === "active")
  const connection = ati?.connection ?? null

  const reloadAti = async () => {
    const response = await fetch("/api/ati/connection", { cache: "no-store" })
    setAti((await response.json().catch(() => null)) as AtiStatus | null)
  }

  const saveToken = async () => {
    if (!token.trim()) {
      toast.error("Вставьте access_token ATI.SU")
      return
    }
    setAtiBusy(true)
    try {
      const response = await fetch("/api/ati/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        toast.error(data?.error || "Не удалось сохранить токен")
        return
      }
      toast.success("Токен сохранён")
      setToken("")
      await reloadAti()
    } catch {
      toast.error("Ошибка соединения")
    } finally {
      setAtiBusy(false)
    }
  }

  const checkConnection = async () => {
    setAtiBusy(true)
    try {
      const response = await fetch("/api/ati/connection/check", { method: "POST" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        toast.error(data?.error || "ATI.SU не ответил")
        await reloadAti()
        return
      }
      toast.success(`Подключено: ${data.firmName || "аккаунт ATI.SU"}`)
      await reloadAti()
    } catch {
      toast.error("Ошибка соединения")
    } finally {
      setAtiBusy(false)
    }
  }

  const disconnectAti = async () => {
    setAtiBusy(true)
    try {
      const response = await fetch("/api/ati/connection", { method: "DELETE" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        toast.error(data?.error || "Не удалось отключить")
        return
      }
      toast.success("ATI.SU отключён")
      await reloadAti()
    } catch {
      toast.error("Ошибка соединения")
    } finally {
      setAtiBusy(false)
    }
  }

  return (
    <>
      <LogistHeader
        title="Организация"
        subtitle={org?.organization.name ?? "Компания и доступы"}
        userName={user?.name}
      />

      <div className="space-y-3 px-4 pt-4">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : loading ? (
          <ListSkeleton rows={3} />
        ) : (
          <>
            <Card>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-300">
                  <Building2 className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold leading-snug text-white">
                    {org?.organization.name}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-zinc-500">
                    Ваша роль: {ROLE_LABELS[org?.me.role ?? ""] ?? org?.me.role}
                  </p>
                </div>
              </div>

              <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                <SummaryTile icon={<Users className="h-4 w-4" />} label="Сотрудники" value={org?.summary.members ?? 0} />
                <SummaryTile
                  icon={<UserPlus className="h-4 w-4" />}
                  label="Ждут одобрения"
                  value={org?.summary.pending ?? 0}
                  href="/lm/users"
                  tone={(org?.summary.pending ?? 0) > 0 ? "warn" : "default"}
                  hint={(org?.summary.pending ?? 0) > 0 ? "открыть заявки" : undefined}
                />
                <SummaryTile icon={<Truck className="h-4 w-4" />} label="Водители" value={org?.summary.drivers ?? 0} href="/lm/drivers" />
                <SummaryTile icon={<Car className="h-4 w-4" />} label="Машины" value={org?.summary.vehicles ?? 0} href="/lm/fleet" />
              </div>

              {(org?.summary.pending ?? 0) > 0 ? (
                <p className="mt-3 rounded-xl bg-amber-500/[0.12] px-3 py-2 text-[12.5px] text-amber-200">
                  {org?.summary.pending}{" "}
                  {plural(org?.summary.pending ?? 0, ["заявка ждёт", "заявки ждут", "заявок ждут"])} одобрения —
                  откройте «Сотрудников», чтобы одобрить.
                </p>
              ) : null}
            </Card>

            {freshCode ? (
              <Card className="border-emerald-500/25 bg-emerald-500/[0.07]">
                <p className="text-[13px] text-emerald-100">
                  Новый код приглашения — передайте его сотруднику:
                </p>
                <p className="mt-2 select-all text-center text-[24px] font-semibold tracking-[0.12em] text-white">
                  {freshCode}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <ActionButton onClick={() => void copyText(freshCode, "Код")}>
                    <Copy className="h-4 w-4" /> Код
                  </ActionButton>
                  <ActionButton onClick={() => void copyText(inviteLink(freshCode), "Ссылка-приглашение")}>
                    <Link2 className="h-4 w-4" /> Ссылку
                  </ActionButton>
                </div>
                <p className="mt-2 text-[12px] text-emerald-200/80">
                  Ссылка открывает регистрацию с уже подставленным кодом.
                </p>
              </Card>
            ) : null}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[12px] uppercase tracking-wide text-zinc-500">Коды приглашений</p>
                <button
                  type="button"
                  onClick={() => setFormOpen((value) => !value)}
                  className="flex items-center gap-1.5 text-[13px] font-medium text-orange-400"
                >
                  {formOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  {formOpen ? "Отмена" : "Создать"}
                </button>
              </div>

              {formOpen ? (
                <Card className="mb-3 space-y-3">
                  <div>
                    <p className="mb-1.5 text-[13px] text-zinc-400">Кого приглашаем</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: "logist", label: "Логист" },
                        { id: "admin", label: "Администратор" },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setRole(option.id)}
                          className={`min-h-[44px] rounded-xl text-[14px] font-medium ${
                            role === option.id
                              ? "bg-orange-500/20 text-orange-200"
                              : "bg-white/8 text-white active:bg-white/12"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-[13px] text-zinc-400">Срок действия кода</p>
                    <div className="grid grid-cols-3 gap-2">
                      {EXPIRY_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setExpiry(option.id)}
                          className={`min-h-[44px] rounded-xl text-[13.5px] font-medium ${
                            expiry === option.id
                              ? "bg-orange-500/20 text-orange-200"
                              : "bg-white/8 text-white active:bg-white/12"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <ActionButton tone="primary" full disabled={creating} onClick={() => void createInvite()}>
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Создать код
                  </ActionButton>
                </Card>
              ) : null}

              {invites.length === 0 ? (
                <EmptyState
                  icon={<UserPlus className="h-6 w-6" />}
                  title="Кодов пока нет"
                  description="Создайте код — по нему сотрудник зарегистрируется и попадёт в компанию."
                />
              ) : (
                <div className="space-y-2.5">
                  {invites.map((invite) => {
                    const revoked = invite.status !== "active"
                    return (
                      <Card key={invite.id} className={revoked ? "opacity-60" : ""}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="select-all text-[16px] font-semibold tracking-[0.08em] text-white">
                              {invite.code}
                            </p>
                            <p className="mt-0.5 text-[12.5px] text-zinc-400">
                              {ROLE_LABELS[invite.role] ?? invite.role}
                              {invite.expiresAt
                                ? ` · до ${new Date(invite.expiresAt).toLocaleDateString("ru-RU")}`
                                : " · бессрочный"}
                            </p>
                            <p className="mt-0.5 text-[12px] text-zinc-500">
                              {revoked
                                ? "Отозван"
                                : invite.maxUses
                                  ? `Использован ${invite.usedCount ?? 0} из ${invite.maxUses}`
                                  : `Использований: ${invite.usedCount ?? 0}${
                                      invite.registeredUsers !== (invite.usedCount ?? 0)
                                        ? ` · регистраций ${invite.registeredUsers}`
                                        : ""
                                    }`}
                            </p>
                          </div>
                          {revoked ? (
                            <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[11.5px] text-zinc-500">
                              не действует
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11.5px] text-emerald-200">
                              активен
                            </span>
                          )}
                        </div>

                        {!revoked ? (
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <ActionButton onClick={() => void copyText(invite.code, "Код")}>
                              <Copy className="h-4 w-4" /> Код
                            </ActionButton>
                            <ActionButton onClick={() => void copyText(inviteLink(invite.code), "Ссылка")}>
                              <Check className="h-4 w-4" /> Ссылка
                            </ActionButton>
                            <ActionButton
                              tone="danger"
                              disabled={busyId === invite.id}
                              onClick={() => void revoke(invite)}
                            >
                              {busyId === invite.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                              Отозвать
                            </ActionButton>
                          </div>
                        ) : null}
                      </Card>
                    )
                  })}
                </div>
              )}

              {activeInvites.length === 0 && invites.length > 0 ? (
                <p className="mt-2 px-1 text-[12px] text-zinc-500">
                  Активных кодов нет — создайте новый, чтобы пригласить сотрудника.
                </p>
              ) : null}
            </div>

            {/* Подключение ATI.SU — свой аккаунт организации */}
            <div>
              <p className="mb-2 px-1 text-[12px] uppercase tracking-wide text-zinc-500">ATI.SU</p>
              <Card className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14.5px] font-medium text-white">
                      {connection ? connection.firmName || "Аккаунт подключён" : "Не подключено"}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-zinc-500">
                      {connection
                        ? `статус: ${connection.status === "active" ? "активен" : connection.status}${
                            connection.lastCheckAt
                              ? ` · проверен ${formatDateShort(connection.lastCheckAt)}`
                              : ""
                          }`
                        : "Без токена работают только демо-данные: поиск грузов и контакты перевозчиков требуют аккаунта ATI.SU"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
                      connection?.status === "active"
                        ? "bg-emerald-500/15 text-emerald-200"
                        : connection
                          ? "bg-amber-500/15 text-amber-200"
                          : "bg-white/8 text-zinc-400"
                    }`}
                  >
                    {connection?.status === "active" ? "работает" : connection ? "проверить" : "выключено"}
                  </span>
                </div>

                {connection?.lastError ? (
                  <p className="rounded-xl bg-red-500/[0.08] px-3 py-2 text-[12.5px] text-red-200">
                    {connection.lastError}
                  </p>
                ) : null}

                <label className="block">
                  <span className="text-[12.5px] text-zinc-500">
                    {connection ? "Заменить токен" : "Постоянный токен из «Мои токены» ATI.SU"}
                  </span>
                  <input
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="access_token"
                    autoComplete="off"
                    className={inputInline}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <ActionButton tone="primary" disabled={atiBusy} onClick={() => void saveToken()}>
                    {atiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                    Сохранить
                  </ActionButton>
                  {connection ? (
                    <>
                      <ActionButton disabled={atiBusy} onClick={() => void checkConnection()}>
                        <RefreshCw className="h-4 w-4" /> Проверить
                      </ActionButton>
                      <ActionButton tone="danger" disabled={atiBusy} onClick={() => void disconnectAti()}>
                        <Unplug className="h-4 w-4" /> Отключить
                      </ActionButton>
                    </>
                  ) : null}
                </div>
              </Card>
            </div>

            {/* Журнал действий: «кто что менял» — про организацию, поэтому
                ссылка живёт здесь, а не отдельной строкой в «Ещё» */}
            <div className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03]">
              <LinkRow
                icon={<History className="h-4.5 w-4.5" />}
                label="Журнал действий"
                value="кто что менял"
                href="/lm/audit"
              />
            </div>
          </>
        )}
      </div>
    </>
  )
}

const inputInline =
  "mt-1 min-h-[46px] w-full rounded-xl border border-white/8 bg-white/[0.04] px-3.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-orange-500/50 focus:outline-none"

function SummaryTile({
  icon,
  label,
  value,
  href,
  tone = "default",
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: number
  href?: string
  tone?: "default" | "warn"
  hint?: string
}) {
  const warn = tone === "warn"
  const body = (
    <div
      className={`rounded-xl border p-3 active:bg-white/[0.06] ${
        warn ? "border-amber-500/30 bg-amber-500/[0.1]" : "border-white/8 bg-white/[0.03]"
      }`}
    >
      <div className={`flex items-center gap-2 ${warn ? "text-amber-300" : "text-zinc-500"}`}>{icon}</div>
      <p className={`mt-1.5 text-[20px] font-semibold leading-none ${warn ? "text-amber-300" : "text-white"}`}>
        {value}
      </p>
      <p className={`mt-1 text-[12.5px] ${warn ? "text-amber-200" : "text-zinc-400"}`}>{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-amber-300/80">{hint}</p> : null}
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}
