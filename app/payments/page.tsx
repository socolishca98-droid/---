// app/payments/page.tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Loader2,
  CreditCard,
  Clock,
  CheckCircle,
  AlertTriangle,
  Banknote,
  Calendar,
  Bell,
  ArrowRight,
  MapPin,
  RefreshCw,
  Search,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"

interface OrderPayment {
  id: string
  routeFrom: string
  routeTo: string
  distance: number
  cargoType: string
  clientName: string
  clientContact: string
  clientFirmId: string | null
  price: number
  priceNegotiable: boolean
  paymentType: "cash" | "bank_transfer" | "deferred" | string
  vatType: string
  deferredDays: number
  dueDate: string | null
  isPaid: boolean
  paidAt: string | null
  isOverdue: boolean
  status: string
  driver?: { id: string; name: string; phone: string } | null
  vehicle?: { id: string; plate: string; type: string } | null
  createdAt: string
}

interface PaymentStats {
  totalPending: number
  totalDeferred: number
  totalOverdue: number
  totalPaid: number
  pendingCount: number
  deferredCount: number
  overdueCount: number
  paidCount: number
  totalOrders: number
}

const paymentTypeConfig: Record<
  string,
  { label: string; icon: typeof Banknote; className: string }
> = {
  cash: {
    label: "Наличные",
    icon: Banknote,
    className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  bank_transfer: {
    label: "Безнал",
    icon: CreditCard,
    className: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  deferred: {
    label: "Отсрочка",
    icon: Calendar,
    className: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  },
}

export default function PaymentsPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  const [orders, setOrders] = useState<OrderPayment[]>([])
  const [stats, setStats] = useState<PaymentStats>({
    totalPending: 0,
    totalDeferred: 0,
    totalOverdue: 0,
    totalPaid: 0,
    pendingCount: 0,
    deferredCount: 0,
    overdueCount: 0,
    paidCount: 0,
    totalOrders: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [currentTab, setCurrentTab] = useState("pending")

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/")
    }
  }, [user, authLoading, router])

  const fetchPayments = useCallback(async (tab = currentTab, query = searchQuery) => {
    try {
      const params = new URLSearchParams()
      if (tab) params.set("tab", tab)
      if (query) params.set("q", query)

      const res = await fetch(`/api/payments?${params.toString()}`)
      if (!res.ok) {
        throw new Error(`Ошибка загрузки: HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.success) {
        setOrders(data.orders || [])
        if (data.stats) setStats(data.stats)
      } else {
        toast.error(data.error || "Не удалось загрузить оплаты")
      }
    } catch (err: any) {
      console.error("[PaymentsPage] fetch error:", err)
      toast.error("Ошибка при получении данных об оплатах")
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [currentTab, searchQuery])

  useEffect(() => {
    if (user) {
      fetchPayments(currentTab, searchQuery)
    }
  }, [user, currentTab, searchQuery, fetchPayments])

  const handleTabChange = (val: string) => {
    setCurrentTab(val)
    fetchPayments(val, searchQuery)
  }

  const handleTogglePaid = async (orderId: string, currentStatus: boolean) => {
    setUpdatingId(orderId)
    try {
      const res = await fetch("/api/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          isPaid: !currentStatus,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success(
          !currentStatus
            ? "Оплата успешно подтверждена и зафиксирована в реестре"
            : "Статус оплаты сброшен на ожидание"
        )
        // Обновляем список и статистику
        await fetchPayments(currentTab, searchQuery)
      } else {
        toast.error(data.error || "Не удалось обновить статус оплаты")
      }
    } catch (err) {
      console.error("[PaymentsPage] update error:", err)
      toast.error("Сетевая ошибка при обновлении")
    } finally {
      setUpdatingId(null)
    }
  }

  const handleRemind = async (order: OrderPayment) => {
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        toast.success(
          `Напоминание отправлено: ${order.clientName} (${order.clientContact})`
        )
      } else {
        toast.error(data.error || "Ошибка отправки напоминания")
      }
    } catch (err) {
      toast.error("Не удалось отправить напоминание")
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const now = new Date()
  const overdueOrders = orders.filter((o) => o.isOverdue)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <div
        className="transition-all duration-300 ease-in-out"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <main className="p-6 space-y-6 max-w-7xl mx-auto">
          {/* Header Bar */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Финансы и оплаты</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Учёт поступлений, контроль дебиторской задолженности и отсрочек
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsRefreshing(true)
                  fetchPayments(currentTab, searchQuery)
                }}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
                />
                Обновить
              </Button>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-card/50 backdrop-blur border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.pendingCount}</p>
                  <p className="text-xs text-muted-foreground">Ожидают оплаты</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.deferredCount}</p>
                  <p className="text-xs text-muted-foreground">С отсрочкой</p>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`bg-card/50 backdrop-blur ${
                stats.overdueCount > 0
                  ? "border-red-500/40 bg-red-500/5"
                  : "border-border"
              }`}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-red-500/10 text-red-500">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p
                    className={`text-2xl font-bold ${
                      stats.overdueCount > 0 ? "text-red-500" : ""
                    }`}
                  >
                    {stats.overdueCount}
                  </p>
                  <p className="text-xs text-muted-foreground">Просрочены</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500">
                  <Banknote className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {(stats.totalPending / 1000).toLocaleString("ru-RU", {
                      maximumFractionDigits: 0,
                    })}
                    к ₽
                  </p>
                  <p className="text-xs text-muted-foreground">К получению</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Overdue alert banner if any */}
          {stats.overdueCount > 0 && overdueOrders.length > 0 && (
            <Card className="border-red-500/40 bg-red-500/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-red-500 font-semibold">
                  <AlertTriangle className="h-5 w-5" />
                  Внимание: просроченная дебиторская задолженность
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-red-200/90">
                  Общая сумма просрочки:{" "}
                  <span className="font-bold text-red-400">
                    {stats.totalOverdue.toLocaleString("ru-RU")} ₽
                  </span>
                </p>
                <div className="space-y-2">
                  {overdueOrders.slice(0, 3).map((order) => (
                    <div
                      key={order.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-card/80 border border-red-500/20 gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">
                            {order.clientName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {order.routeFrom} → {order.routeTo}
                          </span>
                        </div>
                        <p className="text-xs text-red-400">
                          Срок истёк:{" "}
                          {order.dueDate
                            ? new Date(order.dueDate).toLocaleDateString("ru-RU")
                            : "Не указан"}
                          {order.clientContact && ` • Контакт: ${order.clientContact}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <span className="font-bold text-red-400 text-sm">
                          {order.price.toLocaleString("ru-RU")} ₽
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRemind(order)}
                          className="h-8 text-xs border-red-500/30 hover:bg-red-500/20"
                        >
                          <Bell className="h-3.5 w-3.5 mr-1" />
                          Напомнить
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleTogglePaid(order.id, order.isPaid)}
                          disabled={updatingId === order.id}
                          className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          {updatingId === order.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle className="h-3.5 w-3.5 mr-1" />
                              Оплачено
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Search bar & Tabs */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по клиенту, городу или номеру..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
            </div>

            <Tabs
              value={currentTab}
              onValueChange={handleTabChange}
              className="space-y-4"
            >
              <TabsList className="bg-secondary/60 p-1 flex-wrap h-auto">
                <TabsTrigger value="pending" className="text-xs sm:text-sm">
                  Ожидают ({stats.pendingCount})
                </TabsTrigger>
                <TabsTrigger value="deferred" className="text-xs sm:text-sm">
                  С отсрочкой ({stats.deferredCount})
                </TabsTrigger>
                <TabsTrigger value="paid" className="text-xs sm:text-sm">
                  Оплаченные ({stats.paidCount})
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs sm:text-sm">
                  Все ({stats.totalOrders})
                </TabsTrigger>
              </TabsList>

              <TabsContent value={currentTab} className="space-y-3 mt-4">
                {orders.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
                    <CheckCircle className="h-10 w-10 mx-auto mb-3 opacity-40 text-emerald-500" />
                    <p className="text-base font-medium">
                      {currentTab === "paid"
                        ? "Оплаченных заказов пока нет"
                        : currentTab === "pending"
                        ? "Нет счетов, ожидающих оплаты"
                        : "Заказов в этом фильтре не найдено"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Все данные синхронизируются с базой данных Loginex
                    </p>
                  </div>
                ) : (
                  orders.map((order) => {
                    const pConfig =
                      paymentTypeConfig[order.paymentType] || paymentTypeConfig.bank_transfer
                    const PIcon = pConfig.icon
                    const isDuePast =
                      order.dueDate && new Date(order.dueDate) < now && !order.isPaid

                    return (
                      <Card
                        key={order.id}
                        className={`bg-card/60 backdrop-blur transition-all hover:border-primary/40 ${
                          order.isPaid
                            ? "border-emerald-500/20"
                            : isDuePast
                            ? "border-red-500/30"
                            : "border-border"
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            {/* Левая колонка: контрагент и маршрут */}
                            <div className="space-y-1.5 flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-base">
                                  {order.clientName}
                                </span>
                                <Badge variant="outline" className={pConfig.className}>
                                  <PIcon className="h-3 w-3 mr-1" />
                                  {pConfig.label}
                                </Badge>
                                {order.vatType === "with_vat" && (
                                  <Badge variant="secondary" className="text-xs">
                                    НДС 20%
                                  </Badge>
                                )}
                                {order.isPaid ? (
                                  <Badge
                                    variant="outline"
                                    className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  >
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Оплачен
                                  </Badge>
                                ) : isDuePast ? (
                                  <Badge
                                    variant="outline"
                                    className="bg-red-500/10 text-red-400 border-red-500/20"
                                  >
                                    <AlertTriangle className="h-3 w-3 mr-1" />
                                    Просрочен
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">
                                    Ожидает
                                  </Badge>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
                                <MapPin className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                <span className="text-foreground">{order.routeFrom}</span>
                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                <span className="text-foreground">{order.routeTo}</span>
                                <span className="text-xs text-muted-foreground ml-2">
                                  ({order.distance} км • {order.cargoType})
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                {order.clientContact && (
                                  <span>Контакты: {order.clientContact}</span>
                                )}
                                {order.dueDate && !order.isPaid && (
                                  <span
                                    className={
                                      isDuePast
                                        ? "text-red-400 font-semibold"
                                        : "text-muted-foreground"
                                    }
                                  >
                                    Срок оплаты:{" "}
                                    {new Date(order.dueDate).toLocaleDateString("ru-RU")}
                                    {isDuePast ? " (просрочено!)" : ""}
                                  </span>
                                )}
                                {order.isPaid && order.paidAt && (
                                  <span className="text-emerald-400">
                                    Оплачено:{" "}
                                    {new Date(order.paidAt).toLocaleDateString("ru-RU")}
                                  </span>
                                )}
                                {order.driver && (
                                  <span>Водитель: {order.driver.name}</span>
                                )}
                              </div>
                            </div>

                            {/* Правая колонка: сумма и действия */}
                            <div className="flex sm:flex-row lg:flex-col items-end justify-between sm:justify-end gap-3 flex-shrink-0">
                              <div className="text-right">
                                <p className="text-xl font-bold tracking-tight">
                                  {order.price.toLocaleString("ru-RU")} ₽
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Заказ #{order.id}
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                {!order.isPaid && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleRemind(order)}
                                    className="h-8 text-xs"
                                  >
                                    <Bell className="h-3.5 w-3.5 mr-1" />
                                    Напомнить
                                  </Button>
                                )}

                                <Button
                                  size="sm"
                                  onClick={() =>
                                    handleTogglePaid(order.id, order.isPaid)
                                  }
                                  disabled={updatingId === order.id}
                                  className={`h-8 text-xs ${
                                    order.isPaid
                                      ? "bg-secondary hover:bg-secondary/80 text-foreground"
                                      : "bg-emerald-600 hover:bg-emerald-700 text-white"
                                  }`}
                                >
                                  {updatingId === order.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : order.isPaid ? (
                                    <>
                                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                      Отменить оплату
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                      Отметить оплату
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  )
}
