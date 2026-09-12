"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { mockOrders } from "@/lib/mock-data"
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
} from "lucide-react"

// Типизируем paymentConfig, чтобы TS не ругался на ключи
type PaymentType = "cash" | "bank_transfer" | "deferred"

export default function PaymentsPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/")
    }
    if (!isLoading && user?.role === "driver") {
      router.push("/m")
    }
  }, [user, isLoading, router])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // Явное приведение к any[], чтобы TS не искал payment в типе Order (если он вдруг подтянулся)
  const orders = mockOrders as any[]

  // Calculate payment stats
  const ordersWithPayment = orders.filter((o) => o.payment && o.price)
  const pendingPayments = ordersWithPayment.filter((o) => !o.payment?.isPaid)
  const deferredPayments = ordersWithPayment.filter(
    (o) => o.payment?.type === "deferred" && !o.payment?.isPaid,
  )

  // Find overdue payments
  const now = new Date()
  const overduePayments = deferredPayments.filter(
    (o) => o.payment?.dueDate && new Date(o.payment.dueDate) < now,
  )

  const totalPending = pendingPayments.reduce((sum, o) => sum + (o.price || 0), 0)
  const totalOverdue = overduePayments.reduce((sum, o) => sum + (o.price || 0), 0)

  const paymentTypeConfig: Record<
    string,
    { label: string; icon: any; className: string }
  > = {
    cash: {
      label: "Наличные",
      icon: Banknote,
      className: "text-green-600 bg-green-500/10",
    },
    bank_transfer: {
      label: "Безнал",
      icon: CreditCard,
      className: "text-blue-600 bg-blue-500/10",
    },
    deferred: {
      label: "Отсрочка",
      icon: Calendar,
      className: "text-amber-600 bg-amber-500/10",
    },
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="pl-64">
        <Header />
        <main className="p-6 space-y-6">
          {/* Page Title */}
          <div>
            <h1 className="text-2xl font-bold">Оплаты</h1>
            <p className="text-muted-foreground">
              Учёт оплат и контроль дебиторской задолженности
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-secondary">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{pendingPayments.length}</p>
                  <p className="text-xs text-muted-foreground">Ожидают оплаты</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10">
                  <Calendar className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{deferredPayments.length}</p>
                  <p className="text-xs text-muted-foreground">С отсрочкой</p>
                </div>
              </CardContent>
            </Card>
            <Card className={overduePayments.length > 0 ? "border-red-500/50" : ""}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">
                    {overduePayments.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Просрочены</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Banknote className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {(totalPending / 1000).toFixed(0)}к ₽
                  </p>
                  <p className="text-xs text-muted-foreground">К получению</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Overdue alert */}
          {overduePayments.length > 0 && (
            <Card className="border-red-500/50 bg-red-500/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                  Просроченные платежи
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Сумма просроченных платежей:{" "}
                  <span className="font-bold text-red-600">
                    {totalOverdue.toLocaleString("ru-RU")} ₽
                  </span>
                </p>
                <div className="space-y-2">
                  {overduePayments.slice(0, 3).map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-background"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{order.clientName}</span>
                        <span className="text-sm text-muted-foreground">
                          {order.routeFrom} → {order.routeTo}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold">
                          {order.price?.toLocaleString("ru-RU")} ₽
                        </span>
                        <Button size="sm" variant="outline">
                          <Bell className="h-3 w-3 mr-1" />
                          Напомнить
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Payment list */}
          <Tabs defaultValue="pending" className="space-y-4">
            <TabsList>
              <TabsTrigger value="pending">Ожидают оплаты</TabsTrigger>
              <TabsTrigger value="deferred">С отсрочкой</TabsTrigger>
              <TabsTrigger value="paid">Оплаченные</TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-3">
              {pendingPayments.map((order) => {
                const pType = order.payment
                  ? paymentTypeConfig[order.payment.type]
                  : null
                const PIcon = pType?.icon
                return (
                  <Card key={order.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {order.clientName || "Клиент"}
                            </span>
                            {pType && PIcon && (
                              <Badge variant="outline" className={pType.className}>
                                <PIcon className="h-3 w-3 mr-1" />
                                {pType.label}
                              </Badge>
                            )}
                            {order.payment?.vat === "with_vat" && (
                              <Badge variant="secondary" className="text-xs">
                                С НДС
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <MapPin className="h-3 w-3" />
                            {order.routeFrom}
                            <ArrowRight className="h-3 w-3" />
                            {order.routeTo}
                          </div>
                          {order.payment?.dueDate && (
                            <p className="text-xs text-muted-foreground">
                              Срок оплаты:{" "}
                              {new Date(order.payment.dueDate).toLocaleDateString(
                                "ru-RU",
                              )}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold">
                            {order.price?.toLocaleString("ru-RU")} ₽
                          </p>
                          <Button size="sm" className="mt-2">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Отметить оплату
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
              {pendingPayments.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Все платежи получены</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="deferred" className="space-y-3">
              {deferredPayments.map((order) => (
                <Card key={order.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {order.clientName || "Клиент"}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-amber-600 bg-amber-500/10"
                          >
                            <Calendar className="h-3 w-3 mr-1" />
                            Отсрочка {order.payment?.deferredDays} дней
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {order.routeFrom} → {order.routeTo}
                        </div>
                        {order.payment?.dueDate && (
                          <p
                            className={`text-xs ${
                              new Date(order.payment.dueDate) < now
                                ? "text-red-600 font-medium"
                                : "text-muted-foreground"
                            }`}
                          >
                            Срок:{" "}
                            {new Date(order.payment.dueDate).toLocaleDateString(
                              "ru-RU",
                            )}
                            {new Date(order.payment.dueDate) < now &&
                              " (просрочено!)"}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold">
                          {order.price?.toLocaleString("ru-RU")} ₽
                        </p>
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" variant="outline">
                            <Bell className="h-3 w-3 mr-1" />
                            Напомнить
                          </Button>
                          <Button size="sm">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Оплачено
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="paid">
              <div className="text-center py-12 text-muted-foreground">
                <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>История оплаченных заказов</p>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}