"use client"

// components/payments/payments-view.tsx
//
// Оплаты (задача 6): реальные данные заказов, напоминания о просрочке,
// список должников по клиентам и выгрузка для бухгалтерии.

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Bell,
  BellRing,
  Calendar,
  CheckCircle,
  Clock,
  Download,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { ClientCardDialog } from "@/components/clients/client-card-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { PaymentTermsDialog, type PaymentTermsTarget } from "./payment-terms-dialog"
import { TableSkeleton, KpiSkeleton } from "@/components/ui/skeletons"
import { DataTable, type DataTableColumn } from "@/components/ui/data-table"
import { fetchJsonCached, peekCache } from "@/lib/client-cache"

type PaymentRow = {
  id: string
  clientId: string | null
  clientName: string
  clientContact: string | null
  inn: string | null
  routeFrom: string
  routeTo: string
  distance: number
  cargoType: string
  status: string | null
  createdAt: string | null
  amount: number
  paymentType: string | null
  vatType: string | null
  deferredDays: number
  dueDate: string | null
  isDeferred: boolean
  isPaid: boolean
  paidAt: string | null
  isOverdue: boolean
  overdueDays: number
  remindedAt: string | null
  reminderCount: number
}

type Stats = {
  totalPending: number
  totalDeferred: number
  totalOverdue: number
  totalPaid: number
  totalRevenue: number
  pendingCount: number
  deferredCount: number
  overdueCount: number
  paidCount: number
  totalOrders: number
  avgPaymentDays: number | null
}

type PaymentsPayload = {
  success?: boolean
  orders?: PaymentRow[]
  stats?: Stats
  debtors?: Debtor[]
  error?: string
}

type Debtor = {
  key: string
  clientId: string | null
  clientName: string
  inn: string | null
  debt: number
  overdue: number
  ordersCount: number
  overdueCount: number
  maxOverdueDays: number
  oldestDueDate: string | null
  lastOrderAt: string | null
}

const EMPTY_STATS: Stats = {
  totalPending: 0,
  totalDeferred: 0,
  totalOverdue: 0,
  totalPaid: 0,
  totalRevenue: 0,
  pendingCount: 0,
  deferredCount: 0,
  overdueCount: 0,
  paidCount: 0,
  totalOrders: 0,
  avgPaymentDays: null,
}


const PAYMENT_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank: "Безнал",
  card: "Карта",
}

const VAT_LABELS: Record<string, string> = {
  none: "Без НДС",
  vat20: "НДС 20%",
  vat10: "НДС 10%",
  included: "НДС включён",
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

function shortMoney(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} млн ₽`
  if (value >= 1_000) return `${Math.round(value / 1000)} тыс. ₽`
  return money(value)
}

function date(value: string | null) {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleDateString("ru-RU")
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <CheckCircle className="mx-auto mb-3 h-8 w-8 text-emerald-500/50" />
      <p className="text-sm font-medium">{text}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Суммы, сроки и должники считаются по заказам вашей организации.
      </p>
    </div>
  )
}

export function PaymentsView() {
  const [orders, setOrders] = useState<PaymentRow[]>([])
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [tab, setTab] = useState("pending")
  const [search, setSearch] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [isReminding, setIsReminding] = useState(false)

  const [termsTarget, setTermsTarget] = useState<PaymentTermsTarget | null>(null)
  const [isTermsOpen, setIsTermsOpen] = useState(false)
  const [cardClientId, setCardClientId] = useState<string | null>(null)
  const [isCardOpen, setIsCardOpen] = useState(false)

  const load = useCallback(
    async (options?: { tab?: string; search?: string; quiet?: boolean }) => {
      const activeTab = options?.tab ?? tab
      const activeSearch = options?.search ?? search

      if (options?.quiet) setIsRefreshing(true)
      else setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        // «Кто должен» — тот же неоплаченный список, но разложенный по клиентам:
        // должников считает сервер, здесь только переключается вид
        params.set("tab", activeTab === "debtors" ? "pending" : activeTab)
        if (activeSearch.trim()) params.set("q", activeSearch.trim())

        // Через кеш: возврат на вкладку рисуется мгновенно из памяти,
        // а свежие суммы подставляются, когда ответит сервер
        const data = await fetchJsonCached<PaymentsPayload>(
          `/api/payments?${params.toString()}`,
          { force: options?.quiet === true },
        )

        setOrders(data.orders ?? [])
        setStats(data.stats ?? EMPTY_STATS)
        setDebtors(data.debtors ?? [])
      } catch (e: any) {
        setError(e?.message || "Не удалось загрузить оплаты")
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [tab, search],
  )

  useEffect(() => {
    // Смена вкладки: если данные уже приносили — показываем сразу, без скелетона.
    // Поиск применяется по кнопке или Enter (там load вызывается явно).
    const params = new URLSearchParams()
    params.set("tab", tab === "debtors" ? "pending" : tab)
    if (search.trim()) params.set("q", search.trim())
    if (peekCache(`/api/payments?${params.toString()}`)) setIsLoading(false)

    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const remindedToday = useCallback((row: PaymentRow) => {
    if (!row.remindedAt) return false
    return new Date(row.remindedAt).toDateString() === new Date().toDateString()
  }, [])

  const handleTogglePaid = async (row: PaymentRow) => {
    setUpdatingId(row.id)

    try {
      const res = await fetch("/api/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: row.id, isPaid: !row.isPaid }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось обновить статус оплаты")
      }

      toast.success(
        row.isPaid
          ? "Отметка об оплате снята — заказ снова в списке к получению"
          : `Оплата зафиксирована: ${money(row.amount)}`,
      )
      await load({ quiet: true })
    } catch (e: any) {
      toast.error(e?.message || "Не удалось обновить статус оплаты")
    } finally {
      setUpdatingId(null)
    }
  }

  const handleRemind = async (row: PaymentRow) => {
    setUpdatingId(row.id)

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: row.id }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось отправить напоминание")
      }

      if (data.created === 0) {
        toast.info("Сегодня по этому заказу уже напоминали", {
          description: "Напоминание логистам ушло раньше — повторять каждый час не нужно.",
        })
      } else {
        toast.success("Напоминание отправлено логистам", {
          description: `${row.clientName}: ${money(row.amount)}, просрочка ${row.overdueDays} дн.`,
        })
      }

      await load({ quiet: true })
    } catch (e: any) {
      toast.error(e?.message || "Не удалось отправить напоминание")
    } finally {
      setUpdatingId(null)
    }
  }

  const handleRemindAll = async () => {
    setIsReminding(true)

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allOverdue: true }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось отправить напоминания")
      }

      if (data.created === 0) {
        toast.info(data.message || "Новых напоминаний нет")
      } else {
        toast.success(`Напоминаний отправлено: ${data.created}`, {
          description: `На сумму ${money(data.totalAmount ?? 0)}${
            data.skipped > 0 ? `. Пропущено (уже напоминали сегодня): ${data.skipped}` : ""
          }`,
        })
      }

      await load({ quiet: true })
    } catch (e: any) {
      toast.error(e?.message || "Не удалось отправить напоминания")
    } finally {
      setIsReminding(false)
    }
  }

  const handleExport = () => {
    const params = new URLSearchParams()
    params.set("tab", tab === "debtors" ? "pending" : tab)
    if (search.trim()) params.set("q", search.trim())

    // Файл выгружает браузер: сервер отдаёт CSV с BOM и «;» — Excel открывает
    // его сразу, без импорта и настройки кодировки
    const link = document.createElement("a")
    link.href = `/api/payments/export?${params.toString()}`
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()
    link.remove()

    toast.success("Выгрузка для бухгалтерии готова", {
      description: "Файл открывается в Excel как есть.",
    })
  }

const DEBTOR_COLUMNS: DataTableColumn<Debtor>[] = [
  {
    key: "client",
    label: "Клиент",
    cell: (debtor) => (
      <>
        <div className="font-medium">{debtor.clientName}</div>
        {debtor.inn && <div className="text-xs text-muted-foreground">ИНН {debtor.inn}</div>}
      </>
    ),
  },
  {
    key: "debt",
    label: "Долг",
    align: "right",
    cellClassName: "font-medium",
    cell: (debtor) => money(debtor.debt),
  },
  {
    key: "overdue",
    label: "Из них просрочено",
    align: "right",
    cell: (debtor) =>
      debtor.overdue > 0 ? (
        <>
          <span className="text-destructive">{money(debtor.overdue)}</span>
          <div className="text-xs text-destructive">до {debtor.maxOverdueDays} дн.</div>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">нет</span>
      ),
  },
  {
    key: "orders",
    label: "Заказов",
    align: "right",
    cell: (debtor) => (
      <>
        {debtor.ordersCount}
        {debtor.overdueCount > 0 && (
          <div className="text-xs text-muted-foreground">
            из них {debtor.overdueCount} с просрочкой
          </div>
        )}
      </>
    ),
  },
  {
    key: "oldest",
    label: "Самый старый срок",
    cellClassName: "text-xs text-muted-foreground",
    cell: (debtor) => date(debtor.oldestDueDate),
  },
  {
    key: "actions",
    label: null,
    align: "right",
    cell: (debtor) =>
      debtor.clientId ? (
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            setCardClientId(debtor.clientId as string)
            setIsCardOpen(true)
          }}
        >
          Карточка
        </Button>
      ) : (
        <Badge variant="outline" className="text-[10px]">
          нет карточки клиента
        </Badge>
      ),
  },
]

  const emptyLabel: Record<string, string> = {
    pending: "Нет счетов, ожидающих оплаты",
    deferred: "Заказов с отсрочкой нет",
    overdue: "Просроченных оплат нет",
    paid: "Оплаченных заказов пока нет",
    debtors: "Должников нет",
    all: "Оплат пока нет",
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Оплаты</h1>
          <p className="text-sm text-muted-foreground">
            Что получено, что ждёт оплаты, кто задерживает и на сколько
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load({ quiet: true })}
            disabled={isRefreshing}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Для бухгалтерии (CSV)
          </Button>
          <Button
            size="sm"
            onClick={() => void handleRemindAll()}
            disabled={isReminding || stats.overdueCount === 0}
          >
            {isReminding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <BellRing className="mr-2 h-4 w-4" />
            )}
            Напомнить о просрочке ({stats.overdueCount})
          </Button>
        </div>
      </div>

      {isLoading ? (
        <KpiSkeleton />
      ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-in">
          <Card className="card-interactive">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xl font-bold">{shortMoney(stats.totalPending)}</p>
                <p className="text-xs text-muted-foreground">
                  К получению · {stats.pendingCount}{" "}
                  {plural(stats.pendingCount, "заказ", "заказа", "заказов")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-xl bg-amber-500/10 p-2.5 text-amber-500">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xl font-bold">{shortMoney(stats.totalDeferred)}</p>
                <p className="text-xs text-muted-foreground">С отсрочкой · {stats.deferredCount}</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className={`card-interactive ${stats.overdueCount > 0 ? "border-destructive/40 bg-destructive/5" : ""}`}
          >
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-xl bg-destructive/10 p-2.5 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p
                  className={
                    stats.overdueCount > 0 ? "text-xl font-bold text-destructive" : "text-xl font-bold"
                  }
                >
                  {shortMoney(stats.totalOverdue)}
                </p>
                <p className="text-xs text-muted-foreground">Просрочено · {stats.overdueCount}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-500">
                <Banknote className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xl font-bold">{shortMoney(stats.totalPaid)}</p>
                <p className="text-xs text-muted-foreground">
                  Получено · {stats.paidCount}
                  {stats.avgPaymentDays !== null
                    ? `, ${stats.avgPaymentDays > 0 ? "+" : ""}${stats.avgPaymentDays} дн. к сроку`
                    : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {stats.overdueCount > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
              <div>
                <p className="font-medium text-destructive">
                  Просрочено {money(stats.totalOverdue)} в {stats.overdueCount}{" "}
                  {plural(stats.overdueCount, "заказе", "заказах", "заказах")}
                </p>
                <p className="text-xs text-muted-foreground">
                  «Напомнить» ставит задачу логистам в уведомления: по одному заказу в день,
                  без повторов.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setTab("debtors")}>
                <Users className="mr-2 h-3.5 w-3.5" />
                Кто должен
              </Button>
              <Button size="sm" onClick={() => void handleRemindAll()} disabled={isReminding}>
                {isReminding ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <BellRing className="mr-2 h-3.5 w-3.5" />
                )}
                Напомнить всем
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load({ search })
            }}
            placeholder="Клиент, город, номер заказа или ИНН — Enter для поиска"
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void load({ search })}>
          Найти
        </Button>
        {search && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("")
              void load({ search: "" })
            }}
          >
            Сбросить
          </Button>
        )}
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="h-auto flex-wrap bg-secondary/60 p-1">
          <TabsTrigger value="pending" className="text-xs sm:text-sm">
            Ожидают ({stats.pendingCount})
          </TabsTrigger>
          <TabsTrigger value="deferred" className="text-xs sm:text-sm">
            С отсрочкой ({stats.deferredCount})
          </TabsTrigger>
          <TabsTrigger value="overdue" className="text-xs sm:text-sm">
            Просрочены ({stats.overdueCount})
          </TabsTrigger>
          <TabsTrigger value="paid" className="text-xs sm:text-sm">
            Оплачено ({stats.paidCount})
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs sm:text-sm">
            Все ({stats.totalOrders})
          </TabsTrigger>
          <TabsTrigger value="debtors" className="text-xs sm:text-sm">
            Кто должен ({debtors.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="space-y-3">
          {isLoading ? (
            tab === "debtors" ? (
              <TableSkeleton rows={5} columns={5} />
            ) : (
              <TableSkeleton rows={6} columns={6} />
            )
          ) : tab === "debtors" ? (
            <DataTable
              columns={DEBTOR_COLUMNS}
              rows={debtors}
              rowKey={(debtor) => debtor.key}
              empty={<EmptyState text={emptyLabel.debtors} />}
              onRowClick={(debtor) => {
                if (!debtor.clientId) return
                setCardClientId(debtor.clientId)
                setIsCardOpen(true)
              }}
            />
          ) : orders.length === 0 ? (
            <EmptyState text={emptyLabel[tab] ?? "Ничего не найдено"} />
          ) : (
            orders.map((row) => (
              <Card key={row.id} className={row.isOverdue ? "border-destructive/30" : ""}>
                <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={
                          row.clientId
                            ? "font-semibold hover:text-primary hover:underline"
                            : "font-semibold"
                        }
                        onClick={() => {
                          if (!row.clientId) return
                          setCardClientId(row.clientId)
                          setIsCardOpen(true)
                        }}
                        disabled={!row.clientId}
                      >
                        {row.clientName}
                      </button>

                      {row.paymentType && (
                        <Badge variant="outline" className="text-xs">
                          {PAYMENT_LABELS[row.paymentType] ?? row.paymentType}
                        </Badge>
                      )}
                      {row.vatType && (
                        <Badge variant="secondary" className="text-xs">
                          {VAT_LABELS[row.vatType] ?? row.vatType}
                        </Badge>
                      )}
                      {row.deferredDays > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          отсрочка {row.deferredDays} дн.
                        </Badge>
                      )}

                      {row.isPaid ? (
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">
                          <CheckCircle className="mr-1 h-3 w-3" />
                          Оплачен
                        </Badge>
                      ) : row.isOverdue ? (
                        <Badge variant="outline" className="border-destructive/40 text-destructive">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Просрочен на {row.overdueDays} дн.
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Ожидает оплаты
                        </Badge>
                      )}

                      {row.reminderCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          <Bell className="mr-1 inline h-3 w-3" />
                          напоминали {date(row.remindedAt)}
                          {row.reminderCount > 1 ? ` (${row.reminderCount})` : ""}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 text-primary" />
                      <span className="text-foreground">{row.routeFrom}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="text-foreground">{row.routeTo}</span>
                      <span className="ml-2 text-xs">
                        {row.distance} км · {row.cargoType}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Заказ от {date(row.createdAt)}</span>
                      {row.clientContact && <span>Контакт: {row.clientContact}</span>}
                      {row.dueDate && !row.isPaid && (
                        <span className={row.isOverdue ? "font-medium text-destructive" : ""}>
                          Срок оплаты: {date(row.dueDate)}
                        </span>
                      )}
                      {row.isPaid && row.paidAt && (
                        <span className="text-emerald-600">Оплачено: {date(row.paidAt)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 flex-row items-center justify-between gap-3 sm:justify-end lg:flex-col lg:items-end">
                    <div className="text-right">
                      <p className="text-xl font-bold tracking-tight">{money(row.amount)}</p>
                      <p className="text-xs text-muted-foreground">Заказ {row.id}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!row.isPaid && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          disabled={updatingId === row.id || remindedToday(row)}
                          title={
                            remindedToday(row)
                              ? "Сегодня по этому заказу уже напоминали"
                              : "Напомнить логистам о просроченной оплате"
                          }
                          onClick={() => void handleRemind(row)}
                        >
                          <Bell className="mr-1 h-3.5 w-3.5" />
                          {remindedToday(row) ? "Напомнили сегодня" : "Напомнить"}
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => {
                          setTermsTarget({
                            id: row.id,
                            clientName: row.clientName,
                            amount: row.amount,
                            paymentType: row.paymentType,
                            vatType: row.vatType,
                            deferredDays: row.deferredDays,
                            dueDate: row.dueDate,
                          })
                          setIsTermsOpen(true)
                        }}
                      >
                        <Settings2 className="mr-1 h-3.5 w-3.5" />
                        Условия
                      </Button>

                      <Button
                        size="sm"
                        className={`h-8 text-xs ${
                          row.isPaid
                            ? "bg-secondary text-foreground hover:bg-secondary/80"
                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                        }`}
                        disabled={updatingId === row.id}
                        onClick={() => void handleTogglePaid(row)}
                      >
                        {updatingId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : row.isPaid ? (
                          <>
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            Отменить оплату
                          </>
                        ) : (
                          <>
                            <CheckCircle className="mr-1 h-3.5 w-3.5" />
                            Отметить оплату
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <PaymentTermsDialog
        open={isTermsOpen}
        onOpenChange={setIsTermsOpen}
        target={termsTarget}
        onSaved={() => void load({ quiet: true })}
      />

      <ClientCardDialog
        open={isCardOpen}
        onOpenChange={setIsCardOpen}
        clientId={cardClientId}
        onChanged={() => void load({ quiet: true })}
      />
    </div>
  )
}
