// app/owner/page.tsx — администрирование платформы: вход в любой аккаунт.
//
// Доступ только владельцу (OWNER_EMAIL, по умолчанию socolishca98@gmail.com):
// он входит своим паролем, а здесь одной кнопкой открывает любой аккаунт —
// сотрудника или водителя, в любой организации. Данные для входа других людей
// знать не нужно: сервер выпускает сессию сам (POST /api/admin/impersonate).
//
// Внизу — журнал последних входов: видно, кто и когда входил.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Building2,
  Loader2,
  LogIn,
  Search,
  ShieldAlert,
  Truck,
  UserCog,
  Users,
  X,
} from "lucide-react"

import { AccountSwitchBanner } from "@/components/account-switch-banner"
import { Card, EmptyState, ErrorState, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"

interface StaffAccount {
  id: string
  name: string
  email: string | null
  role: string
  status: string
  lastLoginAt: string | null
  kind: "staff"
}

interface DriverAccount {
  id: string
  userId: string | null
  name: string
  phone: string
  status: string
  statusLabel: string
  vehiclePlate: string | null
  kind: "driver"
}

interface OwnerAccount {
  viewer?: never
}

interface OrgGroup {
  id: string
  name: string
  users: (StaffAccount | OwnerAccount)[]
  drivers: DriverAccount[]
}

interface AccountsResponse {
  owner?: { email: string | null; organizations: number }
  organizations: OrgGroup[]
  totals: { organizations: number; staff: number; drivers: number }
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  logist: "Логист",
  driver: "Водитель",
}

const STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  pending: "Ждёт подтверждения",
  suspended: "Заблокирован",
}

export default function OwnerPage() {
  const router = useRouter()
  const { user } = useStaffSession()
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<"staff" | "drivers">("staff")

  const { data, error, loading, reload } = useJsonApi<AccountsResponse>(
    user ? `/api/admin/accounts${query.trim() ? `?query=${encodeURIComponent(query.trim())}` : ""}` : null,
  )

  const groups = data?.organizations ?? []
  const totals = data?.totals ?? { organizations: 0, staff: 0, drivers: 0 }

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          users: tab === "staff" ? group.users : [],
          drivers: tab === "drivers" ? group.drivers : [],
        }))
        .filter((group) => group.users.length > 0 || group.drivers.length > 0),
    [groups, tab],
  )

  const forbidden = Boolean(error && /владельц/i.test(error))

  async function enter(account: { kind: "staff" | "driver"; id: string; name: string }) {
    setBusyId(account.id)
    const body = account.kind === "driver" ? { driverId: account.id } : { userId: account.id }
    const result = await apiSend<{ redirectTo?: string }>("/api/admin/impersonate", "POST", body)
    if (!result.ok) {
      setBusyId(null)
      toast.error(result.error || "Не удалось войти в аккаунт")
      return
    }
    toast.success(`Открываю аккаунт: ${account.name}`)
    const target = (result.data as { redirectTo?: string } | null)?.redirectTo ?? "/lm"
    // Полная перезагрузка: cookie сессии меняется, и клиентские контексты
    // должны прочитать её заново, а не догадываться о новом пользователе.
    window.location.assign(target)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-6">
      <AccountSwitchBanner className="mx-auto mb-4 rounded-lg border" />

      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <UserCog className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground">Вход в любой аккаунт</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Владелец платформы: {data?.owner?.email ?? user?.email ?? "—"}. Пароли других людей не нужны —
            вход выполняется вашей сессией.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="hidden shrink-0 rounded-lg border border-border px-3 py-2 text-[13px] text-foreground/90 hover:bg-secondary md:inline-flex"
        >
          В панель
        </Link>
      </header>

      {forbidden ? (
        <Card className="mt-4 border-destructive/40 bg-destructive/10">
          <p className="flex items-center gap-2 text-[14px] font-medium text-destructive">
            <ShieldAlert className="h-4 w-4" /> Раздел доступен только владельцу платформы
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Войдите под аккаунтом владельца (OWNER_EMAIL) — остальным этот экран закрыт.
          </p>
        </Card>
      ) : null}

      {/* Поиск */}
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Имя, email, телефон или номер машины"
          className="min-h-[46px] w-full rounded-xl border border-border bg-card pl-9 pr-9 text-[15px] text-foreground shadow-sm placeholder:text-muted-foreground/80 focus:border-primary focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            aria-label="Очистить"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Итоги: пока данные не пришли, нули не показываем — они путают */}
      <div
        className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground ${
          loading ? "invisible" : ""
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" /> Организаций: <span className="text-foreground">{totals.organizations}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Сотрудников: <span className="text-foreground">{totals.staff}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Truck className="h-3.5 w-3.5" /> Водителей: <span className="text-foreground">{totals.drivers}</span>
        </span>
      </div>

      {/* Вкладки */}
      <div className="mt-3 inline-flex rounded-lg border border-border p-0.5">
        {(
          [
            ["staff", `Сотрудники · ${totals.staff}`],
            ["drivers", `Водители · ${totals.drivers}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${
              tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? <ListSkeleton rows={5} /> : null}
      {error && !forbidden ? <ErrorState message={error} onRetry={reload} /> : null}

      {!loading && !forbidden && visibleGroups.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="Никого не нашли"
          description={query ? "Попробуйте другое имя, email или телефон." : "Аккаунтов пока нет."}
        />
      ) : null}

      <div className="mt-4 space-y-5">
        {visibleGroups.map((group) => (
          <section key={group.id}>
            <SectionTitle title={group.name} />

            {tab === "staff" ? (
              <div className="mt-2 space-y-2">
                {group.users.map((account) => {
                  const person = account as StaffAccount
                  const isSelf = person.id === user?.id
                  return (
                    <Card key={person.id} className="flex items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14.5px] font-medium text-foreground">{person.name}</p>
                        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                          {ROLE_LABELS[person.role] ?? person.role}
                          {person.email ? ` · ${person.email}` : ""}
                        </p>
                        {person.status !== "active" ? (
                          <p className="mt-0.5 text-[12px] text-warning">
                            {STATUS_LABELS[person.status] ?? person.status}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => void enter({ kind: "staff", id: person.id, name: person.name })}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {busyId === person.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <LogIn className="h-4 w-4" />
                        )}
                        {isSelf ? "Открыть" : "Войти"}
                      </button>
                    </Card>
                  )
                })}
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                {group.drivers.map((driver) => (
                  <Card key={driver.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-medium text-foreground">{driver.name}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                        {driver.phone}
                        {driver.vehiclePlate ? ` · ${driver.vehiclePlate}` : ""} · {driver.statusLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={() => void enter({ kind: "driver", id: driver.id, name: driver.name })}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-[13px] font-medium text-foreground/90 disabled:opacity-50"
                    >
                      {busyId === driver.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <LogIn className="h-4 w-4" />
                      )}
                      Открыть приложение
                    </button>
                  </Card>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
