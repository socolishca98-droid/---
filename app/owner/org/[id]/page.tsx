// app/owner/org/[id]/page.tsx — одна компания: сотрудники, водители и журнал.
//
// Владелец видит всех людей компании и может войти в любой аккаунт —
// как сотрудника, так и водителя. Журнал — действия только этой компании.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Activity, ArrowLeft, Building2, Loader2, Package, Route as RouteIcon, Truck, UserCog, Users } from "lucide-react"

import { OwnerShell } from "@/components/owner/owner-shell"
import {
  ROLE_LABELS,
  USER_STATUS_LABELS,
  Forbidden,
  Panel,
  Tile,
  actionLabel,
  formatCount,
  formatDate,
  formatDateTime,
} from "@/components/owner/owner-ui"
import { enterAccount } from "@/components/owner/enter-account"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"

interface OverviewOrg {
  id: string
  name: string
  createdAt: string | null
  staff: number
  admins: number
  logists: number
  drivers: number
  vehicles: number
  activeRoutes: number
  completedRoutes: number
  ordersInWork: number
  ordersDelivered: number
  lastActivityAt: string | null
}

interface AccountsResponse {
  organizations: {
    id: string
    name: string
    users: { id: string; name: string; email: string | null; role: string; status: string; lastLoginAt: string | null }[]
    drivers: { id: string; userId: string | null; name: string; phone: string; statusLabel: string; vehiclePlate: string | null }[]
  }[]
}

interface JournalResponse {
  total: number
  items: {
    id: string
    createdAt: string
    actorEmail: string | null
    action: string
    targetEmail: string | null
    targetType: string
  }[]
}

export default function OwnerOrgPage() {
  const params = useParams<{ id: string }>()
  const orgId = params?.id ?? ""
  const { user } = useStaffSession()
  const [busyId, setBusyId] = useState<string | null>(null)

  const overview = useJsonApi<{ organizations: OverviewOrg[] }>(user && orgId ? "/api/admin/overview" : null)
  const accounts = useJsonApi<AccountsResponse>(user && orgId ? "/api/admin/accounts" : null)
  const journal = useJsonApi<JournalResponse>(
    user && orgId ? `/api/admin/journal?organizationId=${encodeURIComponent(orgId)}&limit=40` : null,
  )

  const org = useMemo(
    () => overview.data?.organizations.find((item) => item.id === orgId) ?? null,
    [overview.data, orgId],
  )
  const group = useMemo(
    () => accounts.data?.organizations.find((item) => item.id === orgId) ?? null,
    [accounts.data, orgId],
  )

  const forbidden = Boolean(overview.error && /владельц/i.test(overview.error))
  const notFound = Boolean(overview.data && !org)

  async function enter(item: { kind: "staff" | "driver"; id: string; name: string }) {
    setBusyId(item.id)
    await enterAccount(item)
    setBusyId(null)
  }

  return (
    <OwnerShell>
      <Link
        href="/owner"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Все компании
      </Link>

      {forbidden ? (
        <div className="mt-4">
          <Forbidden message="Этот экран доступен только владельцу платформы." />
        </div>
      ) : null}

      {notFound ? (
        <div className="mt-4">
          <Forbidden message="Компания не найдена. Возможно, её удалили." />
        </div>
      ) : null}

      {org ? (
        <>
          <header
            className="mt-4 flex items-start gap-3"
            style={{ animation: "rise-in 480ms cubic-bezier(0.22, 1, 0.36, 1) both" }}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-semibold tracking-tight">{org.name}</h1>
              <p className="text-[13px] text-muted-foreground">
                Работает с {formatDate(org.createdAt)} · последняя активность {formatDateTime(org.lastActivityAt)}
              </p>
            </div>
          </header>

          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Tile icon={Users} label="Сотрудников" value={formatCount(org.staff)} hint={`${org.admins} адм. · ${org.logists} лог.`} delay={0} />
            <Tile icon={Truck} label="Водителей" value={formatCount(org.drivers)} delay={60} tone="chart-2" />
            <Tile icon={Package} label="Машин" value={formatCount(org.vehicles)} delay={120} tone="chart-2" />
            <Tile icon={RouteIcon} label="Рейсов в работе" value={formatCount(org.activeRoutes)} delay={180} tone="warning" />
            <Tile icon={Activity} label="Заказов в работе" value={formatCount(org.ordersInWork)} delay={240} tone="success" />
            <Tile icon={Activity} label="Доставлено заказов" value={formatCount(org.ordersDelivered)} delay={300} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="flex flex-col gap-4">
              {/* Сотрудники */}
              <Panel title={`Сотрудники · ${group?.users.length ?? org.staff}`}>
                {accounts.loading && !group ? (
                  <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
                  </p>
                ) : (group?.users ?? []).length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-muted-foreground">Сотрудников пока нет</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {group!.users.map((person, index) => (
                      <li
                        key={person.id}
                        className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-secondary/40"
                        style={{ animation: `rise-in 420ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 40}ms both` }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium">{person.name}</p>
                          <p className="truncate text-[12.5px] text-muted-foreground">
                            {ROLE_LABELS[person.role] ?? person.role} · {person.email ?? "без почты"} ·{" "}
                            {USER_STATUS_LABELS[person.status] ?? person.status}
                          </p>
                          <p className="text-[11.5px] text-muted-foreground">
                            Последний вход: {formatDateTime(person.lastLoginAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busyId === person.id}
                          onClick={() => enter({ kind: "staff", id: person.id, name: person.name })}
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] transition-colors duration-200 hover:bg-secondary disabled:opacity-60"
                        >
                          {busyId === person.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCog className="h-3.5 w-3.5" />}
                          Войти
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {/* Водители */}
              <Panel title={`Водители · ${group?.drivers.length ?? org.drivers}`}>
                {(group?.drivers ?? []).length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-muted-foreground">Водителей пока нет</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {group!.drivers.map((driver, index) => (
                      <li
                        key={driver.id}
                        className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-secondary/40"
                        style={{ animation: `rise-in 420ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 40}ms both` }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium">{driver.name}</p>
                          <p className="truncate text-[12.5px] text-muted-foreground">
                            {driver.phone}
                            {driver.vehiclePlate ? ` · ${driver.vehiclePlate}` : ""} · {driver.statusLabel}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busyId === driver.id}
                          onClick={() => enter({ kind: "driver", id: driver.id, name: driver.name })}
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] transition-colors duration-200 hover:bg-secondary disabled:opacity-60"
                        >
                          {busyId === driver.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCog className="h-3.5 w-3.5" />}
                          Войти как водитель
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            {/* Журнал компании */}
            <Panel title={`Журнал компании · ${journal.data?.total ?? 0}`} className="self-start">
              <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
                {(journal.data?.items ?? []).map((row) => (
                  <li key={row.id} className="px-4 py-2.5">
                    <p className="text-[13px]">
                      <span className="font-medium">{actionLabel(row.action)}</span>
                      {row.targetEmail ? <span className="text-muted-foreground"> · {row.targetEmail}</span> : null}
                    </p>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                      {formatDateTime(row.createdAt)} · {row.actorEmail ?? "система"}
                    </p>
                  </li>
                ))}
                {journal.data && journal.data.items.length === 0 ? (
                  <li className="px-4 py-4 text-[13px] text-muted-foreground">Действий в этой компании пока нет</li>
                ) : null}
              </ul>
            </Panel>
          </div>
        </>
      ) : null}
    </OwnerShell>
  )
}
