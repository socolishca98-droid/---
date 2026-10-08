// app/owner/page.tsx — стартовый экран владельца платформы.
//
// Открывается сразу после входа под OWNER_EMAIL. Здесь: все компании, которые
// пользуются программой, цифры по каждой, поиск человека по всем компаниям
// и последние действия. По компании — экран с сотрудниками и её журналом.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Activity, Building2, ChevronRight, Loader2, Package, Route as RouteIcon, Search, Truck, UserCog, Users, X } from "lucide-react"

import { OwnerShell } from "@/components/owner/owner-shell"
import {
  ROLE_LABELS,
  Forbidden,
  Panel,
  Tile,
  actionLabel,
  formatCount,
  formatDateTime,
  formatDate,
  plural,
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

interface OverviewResponse {
  owner?: { email: string | null }
  totals: {
    organizations: number
    staff: number
    drivers: number
    vehicles: number
    activeRoutes: number
    ordersInWork: number
    ordersDelivered: number
  }
  organizations: OverviewOrg[]
  recent: {
    id: string
    createdAt: string
    organizationName: string | null
    actorEmail: string | null
    action: string
    targetEmail: string | null
  }[]
}

interface AccountsResponse {
  organizations: {
    id: string
    name: string
    users: { id: string; name: string; email: string | null; role: string; status: string }[]
    drivers: { id: string; userId: string | null; name: string; phone: string; vehiclePlate: string | null }[]
  }[]
}

export default function OwnerHomePage() {
  const { user } = useStaffSession()
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const overview = useJsonApi<OverviewResponse>(user ? "/api/admin/overview" : null)
  const search = query.trim().length >= 2
  const people = useJsonApi<AccountsResponse>(
    user && search ? `/api/admin/accounts?query=${encodeURIComponent(query.trim())}` : null,
  )

  const forbidden = Boolean(overview.error && /владельц/i.test(overview.error))
  const data = overview.data
  const totals = data?.totals

  const matches = useMemo(() => {
    if (!search || !people.data) return []
    return people.data.organizations.flatMap((org) => [
      ...org.users.map((u) => ({
        key: `u-${u.id}`,
        kind: "staff" as const,
        id: u.id,
        name: u.name,
        sub: `${ROLE_LABELS[u.role] ?? u.role} · ${u.email ?? "без почты"}`,
        org: org.name,
      })),
      ...org.drivers.map((d) => ({
        key: `d-${d.id}`,
        kind: "driver" as const,
        id: d.id,
        name: d.name,
        sub: `Водитель · ${d.phone}${d.vehiclePlate ? ` · ${d.vehiclePlate}` : ""}`,
        org: org.name,
      })),
    ])
  }, [people.data, search])

  async function enter(item: { kind: "staff" | "driver"; id: string; name: string }) {
    setBusyId(item.id)
    await enterAccount(item)
    setBusyId(null)
  }

  return (
    <OwnerShell>
      <header
        className="flex flex-col gap-1"
        style={{ animation: "rise-in 480ms cubic-bezier(0.22, 1, 0.36, 1) both" }}
      >
        <h1 className="text-[22px] font-semibold tracking-tight">Компании на платформе</h1>
        <p className="text-[13.5px] text-muted-foreground">
          Все организации, которые пользуются программой. Откройте компанию — увидите сотрудников,
          водителей и её журнал действий.
        </p>
      </header>

      {forbidden ? (
        <div className="mt-6">
          <Forbidden message="Этот экран доступен только владельцу платформы. Войдите под аккаунтом владельца." />
        </div>
      ) : null}

      {/* Цифры по платформе */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile icon={Building2} label="Компаний" value={totals ? formatCount(totals.organizations) : "—"} delay={0} />
        <Tile icon={Users} label="Сотрудников" value={totals ? formatCount(totals.staff) : "—"} delay={60} />
        <Tile icon={Truck} label="Водителей" value={totals ? formatCount(totals.drivers) : "—"} delay={120} tone="chart-2" />
        <Tile icon={Package} label="Машин" value={totals ? formatCount(totals.vehicles) : "—"} delay={180} tone="chart-2" />
        <Tile icon={RouteIcon} label="Рейсов в работе" value={totals ? formatCount(totals.activeRoutes) : "—"} delay={240} tone="warning" />
        <Tile icon={Activity} label="Заказов в работе" value={totals ? formatCount(totals.ordersInWork) : "—"} delay={300} tone="success" />
      </div>

      {/* Поиск человека по всем компаниям */}
      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти человека или водителя в любой компании: имя, почта, телефон, машина"
          className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-[14px] text-foreground transition-colors duration-200 placeholder:text-muted-foreground/80 focus:border-primary focus:outline-none"
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

      {search ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card transition-all duration-300">
          {people.loading ? (
            <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Ищу…
            </p>
          ) : matches.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-muted-foreground">Никого не нашли по запросу «{query.trim()}»</p>
          ) : (
            <ul className="divide-y divide-border">
              {matches.map((m) => (
                <li key={m.key} className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-secondary/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium">{m.name}</p>
                    <p className="truncate text-[12.5px] text-muted-foreground">
                      {m.sub} · <span className="text-foreground/80">{m.org}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === m.id}
                    onClick={() => enter({ kind: m.kind, id: m.id, name: m.name })}
                    className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] transition-colors duration-200 hover:bg-secondary disabled:opacity-60"
                  >
                    {busyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCog className="h-3.5 w-3.5" />}
                    Войти
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* Компании */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid gap-3 sm:grid-cols-2">
          {overview.loading && !data ? (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю компании…
            </div>
          ) : null}
          {(data?.organizations ?? []).map((org, index) => (
            <Link
              key={org.id}
              href={`/owner/org/${org.id}`}
              className="group rounded-xl border border-border bg-card p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
              style={{ animation: `rise-in 520ms cubic-bezier(0.22, 1, 0.36, 1) ${120 + index * 70}ms both` }}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Building2 className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{org.name}</p>
                  <p className="text-[12px] text-muted-foreground">
                    с {formatDate(org.createdAt)} · активность {formatDateTime(org.lastActivityAt)}
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-3 text-[12.5px]">
                <div>
                  <dt className="text-muted-foreground">Сотрудников</dt>
                  <dd className="text-[15px] font-semibold tabular-nums">{org.staff}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Водителей</dt>
                  <dd className="text-[15px] font-semibold tabular-nums">{org.drivers}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Машин</dt>
                  <dd className="text-[15px] font-semibold tabular-nums">{org.vehicles}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Рейсов в работе</dt>
                  <dd className="text-[15px] font-semibold tabular-nums text-warning">{org.activeRoutes}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Заказов в работе</dt>
                  <dd className="text-[15px] font-semibold tabular-nums text-success">{org.ordersInWork}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Доставлено</dt>
                  <dd className="text-[15px] font-semibold tabular-nums">{org.ordersDelivered}</dd>
                </div>
              </dl>

              <p className="mt-3 text-[12px] text-muted-foreground">
                {org.staff > 0
                  ? `${org.admins} адм. · ${org.logists} лог. — ${plural(org.staff, ["сотрудник", "сотрудника", "сотрудников"])}`
                  : "Сотрудников пока нет"}
              </p>
            </Link>
          ))}
          {data && data.organizations.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Компаний пока нет.</p>
          ) : null}
        </div>

        {/* Последние действия по всем компаниям */}
        <Panel
          title="Последние действия"
          action={
            <Link href="/owner/journal" className="text-[12.5px] text-primary transition-opacity duration-200 hover:opacity-80">
              Весь журнал →
            </Link>
          }
          className="self-start"
        >
          <ul className="divide-y divide-border">
            {(data?.recent ?? []).slice(0, 12).map((row) => (
              <li key={row.id} className="px-4 py-2.5">
                <p className="text-[13px]">
                  <span className="font-medium">{actionLabel(row.action)}</span>
                  {row.targetEmail ? <span className="text-muted-foreground"> · {row.targetEmail}</span> : null}
                </p>
                <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                  {formatDateTime(row.createdAt)} · {row.actorEmail ?? "—"} · {row.organizationName ?? "вне компании"}
                </p>
              </li>
            ))}
            {data && data.recent.length === 0 ? (
              <li className="px-4 py-4 text-[13px] text-muted-foreground">Действий пока нет</li>
            ) : null}
          </ul>
        </Panel>
      </div>
    </OwnerShell>
  )
}
