// app/owner/org/[id]/page.tsx — одна компания: сотрудники, водители и журнал.
//
// Владелец видит всех людей компании и может войти в любой аккаунт —
// как сотрудника, так и водителя. Журнал — действия только этой компании.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  Activity,
  ArrowLeft,
  Building2,
  Loader2,
  LogOut,
  Package,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  ShieldOff,
  Truck,
  UserCog,
  Users,
  X,
} from "lucide-react"
import { toast } from "sonner"

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
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
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
    users: {
      id: string
      name: string
      email: string | null
      role: string
      status: string
      lastLoginAt: string | null
      suspendReason: string | null
    }[]
    drivers: {
      id: string
      userId: string | null
      userStatus: string | null
      suspendReason: string | null
      name: string
      phone: string
      statusLabel: string
      vehiclePlate: string | null
    }[]
  }[]
}

type AccessAction = "suspend" | "restore" | "revokeSessions"

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

  // Поиск по учётным записям компании: в крупной компании искать сотрудника
  // глазами в списке невозможно, а именно под конкретной записью владелец и
  // «подключается» к организации.
  const [accountQuery, setAccountQuery] = useState("")
  const accountNeedle = accountQuery.trim().toLowerCase()
  const orgUsers = group?.users ?? []
  const orgDrivers = group?.drivers ?? []
  const visibleUsers = useMemo(() => {
    if (!accountNeedle) return orgUsers
    return orgUsers.filter((person) =>
      [person.name, person.email ?? "", ROLE_LABELS[person.role] ?? person.role].some((value) =>
        value.toLowerCase().includes(accountNeedle),
      ),
    )
  }, [orgUsers, accountNeedle])
  const visibleDrivers = useMemo(() => {
    if (!accountNeedle) return orgDrivers
    return orgDrivers.filter((driver) =>
      [driver.name, driver.phone, driver.vehiclePlate ?? ""].some((value) =>
        value.toLowerCase().includes(accountNeedle),
      ),
    )
  }, [orgDrivers, accountNeedle])
  // Компания без единой учётной записи: войти в неё невозможно в принципе —
  // и об этом надо сказать прямо, а не показывать два пустых списка.
  const noAccountsAtAll = Boolean(group) && orgUsers.length === 0 && orgDrivers.length === 0

  const forbidden = Boolean(overview.error && /недостаточно прав/i.test(overview.error))
  const notFound = Boolean(overview.data && !org)
  // Ошибки загрузки не должны выглядеть как пустые разделы: «Сотрудников пока
  // нет» при упавшем API — это ложное сообщение о состоянии компании.
  const overviewError = overview.error && !forbidden ? overview.error : null
  const accountsError = accounts.error ?? null
  const journalError = journal.error ?? null

  async function enter(item: { kind: "staff" | "driver"; id: string; name: string }) {
    setBusyId(item.id)
    await enterAccount(item)
    setBusyId(null)
  }

  /** Закрытый доступ: войти в такую учётную запись нельзя — сессия не заработает. */
  function accessClosed(status: string): boolean {
    return status === "suspended" || status === "pending"
  }

  /** Закрыть/открыть доступ и «Завершить сессии» — через PATCH /api/admin/accounts/[id]. */
  async function access(userId: string, action: AccessAction, name: string) {
    if (action === "suspend" && !window.confirm(`Закрыть доступ: ${name}? Все сессии будут завершены.`)) {
      return
    }
    setBusyId(`${action}:${userId}`)
    const result = await apiSend<{ message?: string; warning?: string }>(
      `/api/admin/accounts/${encodeURIComponent(userId)}`,
      "PATCH",
      { action },
    )
    setBusyId(null)
    if (!result.ok) {
      toast.error(result.error || "Не получилось. Попробуйте ещё раз.")
      return
    }
    // Действие выполнено, но журнал не сохранился — об этом надо сказать:
    // иначе операция над доступом проходит бесследно.
    if (result.data?.warning) toast.warning(result.data.warning)
    toast.success(result.data?.message ?? "Готово")
    accounts.reload()
    journal.reload()
  }

  /** Кнопки управления доступом. Свой аккаунт не трогаем: самоотзыв запрещён. */
  function AccessButtons({ userId, status, name }: { userId: string; status: string; name: string }) {
    if (user && user.id === userId) {
      return <p className="text-[11.5px] text-muted-foreground">Это ваш аккаунт</p>
    }
    const suspended = status === "suspended"
    const btn =
      "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] transition-colors duration-200 hover:bg-secondary disabled:opacity-60"
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busyId === `revokeSessions:${userId}`}
          onClick={() => access(userId, "revokeSessions", name)}
          title="Все сессии будут завершены, но вход по паролю останется"
          className={btn}
        >
          {busyId === `revokeSessions:${userId}` ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5" />
          )}
          Завершить сессии
        </button>
        {suspended ? (
          <button
            type="button"
            disabled={busyId === `restore:${userId}`}
            onClick={() => access(userId, "restore", name)}
            className={`${btn} text-success`}
          >
            {busyId === `restore:${userId}` ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Открыть доступ
          </button>
        ) : (
          <button
            type="button"
            disabled={busyId === `suspend:${userId}`}
            onClick={() => access(userId, "suspend", name)}
            className={`${btn} text-destructive`}
          >
            {busyId === `suspend:${userId}` ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldOff className="h-3.5 w-3.5" />
            )}
            Закрыть доступ
          </button>
        )}
      </div>
    )
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
          <Forbidden message="Недостаточно прав для этого раздела." />
        </div>
      ) : null}

      {notFound ? (
        <div className="mt-4">
          <Forbidden message="Компания не найдена. Возможно, её удалили." />
        </div>
      ) : null}

      {overviewError ? (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-5">
          <p className="text-[14px] text-destructive">Не удалось загрузить компанию: {overviewError}</p>
          <button
            type="button"
            onClick={() => overview.reload()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-[13px] text-foreground transition-colors duration-200 hover:bg-secondary"
          >
            Повторить
          </button>
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

          {/* Поиск по учётным записям компании */}
          {group ? (
            <div className="relative mt-6">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={accountQuery}
                onChange={(event) => setAccountQuery(event.target.value)}
                placeholder="Найти в компании: имя, почта, телефон, машина"
                className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-[14px] text-foreground transition-colors duration-200 placeholder:text-muted-foreground/80 focus:border-primary focus:outline-none"
              />
              {accountQuery ? (
                <button
                  type="button"
                  aria-label="Очистить поиск"
                  onClick={() => setAccountQuery("")}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : null}

          {noAccountsAtAll ? (
            <Panel title="Учётные записи" className="mt-4">
              <div className="px-4 py-5">
                <p className="text-[14px] font-medium">В этой компании пока нет учётных записей</p>
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  Подключиться к организации можно только под существующей учётной записью:
                  сотрудник или водитель должны быть добавлены администратором либо
                  зарегистрироваться сами. Как только запись появится, здесь будет кнопка
                  «Войти» — владелец входит без пароля, сессию выдаёт сервер.
                </p>
              </div>
            </Panel>
          ) : (
            <>
              {/* grid-cols-1: иначе на мобильном колонка равна max-content и обрезает экран */}
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
                <div className="flex flex-col gap-4">
              {/* Сотрудники */}
              <Panel
                title={`Сотрудники · ${
                  accountNeedle ? `${visibleUsers.length} из ${orgUsers.length}` : `${group?.users.length ?? org.staff}`
                }`}
              >
                {accounts.loading && !group ? (
                  <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
                  </p>
                ) : accountsError ? (
                  <div className="px-4 py-4">
                    <p className="text-[13px] text-destructive">Не удалось загрузить сотрудников: {accountsError}</p>
                    <button
                      type="button"
                      onClick={() => accounts.reload()}
                      className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[12.5px] transition-colors duration-200 hover:bg-secondary"
                    >
                      Повторить
                    </button>
                  </div>
                ) : orgUsers.length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-muted-foreground">Сотрудников пока нет</p>
                ) : visibleUsers.length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-muted-foreground">
                    Никого не нашли по запросу «{accountQuery.trim()}»
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {visibleUsers.map((person, index) => (
                      <li
                        key={person.id}
                        className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-secondary/40"
                        style={{ animation: `rise-in 420ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 40}ms both` }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-medium">{person.name}</p>
                              <p className="truncate text-[12.5px] text-muted-foreground">
                                {ROLE_LABELS[person.role] ?? person.role} · {person.email ?? "без почты"} ·{" "}
                                <span className={person.status === "suspended" ? "text-destructive" : undefined}>
                                  {USER_STATUS_LABELS[person.status] ?? person.status}
                                </span>
                              </p>
                              <p className="text-[11.5px] text-muted-foreground">
                                Последний вход: {formatDateTime(person.lastLoginAt)}
                                {person.status === "suspended" && person.suspendReason
                                  ? ` · ${person.suspendReason}`
                                  : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={busyId === person.id || accessClosed(person.status)}
                              title={
                                accessClosed(person.status)
                                  ? "Доступ закрыт — войти в эту учётную запись нельзя"
                                  : undefined
                              }
                              onClick={() => enter({ kind: "staff", id: person.id, name: person.name })}
                              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] transition-colors duration-200 hover:bg-secondary disabled:opacity-60"
                            >
                              {busyId === person.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCog className="h-3.5 w-3.5" />}
                              {accessClosed(person.status) ? "Доступ закрыт" : "Войти"}
                            </button>
                          </div>
                          <div className="mt-2">
                            <AccessButtons userId={person.id} status={person.status} name={person.name} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {/* Водители */}
              <Panel
                title={`Водители · ${
                  accountNeedle ? `${visibleDrivers.length} из ${orgDrivers.length}` : `${group?.drivers.length ?? org.drivers}`
                }`}
              >
                {accounts.loading && !group ? (
                  <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Загружаю…
                  </p>
                ) : accountsError ? (
                  <div className="px-4 py-4">
                    <p className="text-[13px] text-destructive">Не удалось загрузить водителей: {accountsError}</p>
                    <button
                      type="button"
                      onClick={() => accounts.reload()}
                      className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[12.5px] transition-colors duration-200 hover:bg-secondary"
                    >
                      Повторить
                    </button>
                  </div>
                ) : orgDrivers.length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-muted-foreground">Водителей пока нет</p>
                ) : visibleDrivers.length === 0 ? (
                  <p className="px-4 py-4 text-[13px] text-muted-foreground">
                    Никого не нашли по запросу «{accountQuery.trim()}»
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {visibleDrivers.map((driver, index) => (
                      <li
                        key={driver.id}
                        className="flex items-center gap-3 px-4 py-3 transition-colors duration-200 hover:bg-secondary/40"
                        style={{ animation: `rise-in 420ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 40}ms both` }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-medium">{driver.name}</p>
                              <p className="truncate text-[12.5px] text-muted-foreground">
                                {driver.phone}
                                {driver.vehiclePlate ? ` · ${driver.vehiclePlate}` : ""} · {driver.statusLabel}
                                {driver.userStatus === "suspended" ? (
                                  <span className="text-destructive"> · доступ закрыт</span>
                                ) : null}
                              </p>
                              {driver.userStatus === "suspended" && driver.suspendReason ? (
                                <p className="truncate text-[11.5px] text-muted-foreground">{driver.suspendReason}</p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              disabled={busyId === driver.id || accessClosed(driver.userStatus ?? "active")}
                              title={
                                accessClosed(driver.userStatus ?? "active")
                                  ? "Доступ закрыт — войти в эту учётную запись нельзя"
                                  : undefined
                              }
                              onClick={() => enter({ kind: "driver", id: driver.id, name: driver.name })}
                              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] transition-colors duration-200 hover:bg-secondary disabled:opacity-60"
                            >
                              {busyId === driver.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCog className="h-3.5 w-3.5" />}
                              {accessClosed(driver.userStatus ?? "active") ? "Доступ закрыт" : "Войти как водитель"}
                            </button>
                          </div>
                          <div className="mt-2">
                            {driver.userId ? (
                              <AccessButtons userId={driver.userId} status={driver.userStatus ?? "active"} name={driver.name} />
                            ) : (
                              <p className="text-[11.5px] text-muted-foreground">
                                Учётной записи ещё нет — закрывать нечего
                              </p>
                            )}
                          </div>
                        </div>
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
                {journalError ? (
                  <li className="px-4 py-4">
                    <p className="text-[13px] text-destructive">Журнал не загрузился: {journalError}</p>
                    <button
                      type="button"
                      onClick={() => journal.reload()}
                      className="mt-2 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[12.5px] transition-colors duration-200 hover:bg-secondary"
                    >
                      Повторить
                    </button>
                  </li>
                ) : journal.data && journal.data.items.length === 0 ? (
                  <li className="px-4 py-4 text-[13px] text-muted-foreground">Действий в этой компании пока нет</li>
                ) : null}
              </ul>
            </Panel>
              </div>
            </>
          )}
        </>
      ) : null}
    </OwnerShell>
  )
}
