"use client"

import { useEffect, useState, useCallback } from "react"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import Link from "next/link"
import { useDriverSession } from "@/hooks/use-driver-session"
import {
  Loader2,
  MapPin,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Package,
  RefreshCw,
} from "lucide-react"

interface DriverSession {
  id: string
  name: string
}

interface Order {
  id: string
  routeFrom: string
  routeTo: string
  distance: number | null
  price: number | null
  cargoType: string
  status: string
  createdAt: string
}

type Tab = "active" | "history"

export default function DriverOrdersPage() {
  // Сессия водителя — серверная (httpOnly-cookie): страница раньше читала
  // «driver_session» из localStorage, которой после задачи 1 не существует,
  // и любой вход заканчивался возвратом на экран логина
  const { driver } = useDriverSession()
  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [historyOrders, setHistoryOrders] = useState<Order[]>([])
  const [tab, setTab] = useState<Tab>("active")
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const fetchOrders = useCallback(async (showRefresh = false) => {
    if (!driver?.id) return

    if (showRefresh) setIsRefreshing(true)
    else setIsLoading(true)

    try {
      const [activeRes, historyRes] = await Promise.all([
        fetch(`/api/m/orders?driverId=${driver.id}&status=active`),
        fetch(`/api/m/orders?driverId=${driver.id}&status=history`),
      ])

      const activeData = await activeRes.json()
      const historyData = await historyRes.json()

      if (activeData.success) {
        setActiveOrders(activeData.orders as Order[])
      }
      if (historyData.success) {
        setHistoryOrders(historyData.orders as Order[])
      }
    } catch (e) {
      console.error("Failed to fetch orders:", e)
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [driver?.id])

  useEffect(() => {
    if (driver?.id) {
      fetchOrders()
    }
  }, [driver?.id, fetchOrders])

  const orders = tab === "active" ? activeOrders : historyOrders

  const getStatusInfo = (status: string) => {
    switch (status) {
      case "delivered":
        return {
          label: "Завершён",
          icon: CheckCircle2,
          className: "bg-emerald-500/15 text-emerald-400",
        }
      case "cancelled":
        return {
          label: "Отменён",
          icon: XCircle,
          className: "bg-red-500/15 text-red-400",
        }
      case "loading":
        return {
          label: "Погрузка",
          icon: Package,
          className: "bg-blue-500/15 text-blue-400",
        }
      case "unloading":
        return {
          label: "Выгрузка",
          icon: Package,
          className: "bg-emerald-500/15 text-emerald-400",
        }
      case "in_transit":
      case "control":
        return {
          label: "В пути",
          icon: Clock,
          className: "bg-orange-500/15 text-orange-400",
        }
      // канон этапов заказа — lib/orders/stages.ts
      case "search":
        return {
          label: "Поиск",
          icon: Clock,
          className: "bg-slate-500/15 text-slate-300",
        }
      case "negotiation":
        return {
          label: "Согласование",
          icon: Clock,
          className: "bg-amber-500/15 text-amber-400",
        }
      case "agreed":
        return {
          label: "Согласован",
          icon: CheckCircle2,
          className: "bg-cyan-500/15 text-cyan-400",
        }
      case "in_route":
        return {
          label: "В рейсе",
          icon: Clock,
          className: "bg-blue-500/15 text-blue-400",
        }
      case "documents":
        return {
          label: "Документы",
          icon: Package,
          className: "bg-violet-500/15 text-violet-400",
        }
      case "assigned":
        return {
          label: "Назначен",
          icon: CheckCircle2,
          className: "bg-emerald-500/15 text-emerald-400",
        }
      case "rejected":
        return {
          label: "Отклонён",
          icon: XCircle,
          className: "bg-red-500/15 text-red-400",
        }
      case "expired":
        return {
          label: "Просрочен",
          icon: XCircle,
          className: "bg-slate-500/15 text-slate-300",
        }
      default:
        return {
          label: "В работе",
          icon: Clock,
          className: "bg-orange-500/15 text-orange-400",
        }
    }
  }

  if (!driver) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-24">
      {/* HEADER */}
      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-bold">Мои рейсы</h1>
          <button
            onClick={() => fetchOrders(true)}
            disabled={isRefreshing}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`h-5 w-5 text-gray-400 ${
                isRefreshing ? "animate-spin" : ""
              }`}
            />
          </button>
        </div>

        {/* Табы */}
        <div className="px-4 pb-3">
          <div className="flex bg-[#111116] rounded-xl p-1 border border-gray-800">
            <button
              onClick={() => setTab("active")}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                tab === "active"
                  ? "bg-orange-500 text-white shadow-lg"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              Активные
              {activeOrders.length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-white/20">
                  {activeOrders.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab("history")}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                tab === "history"
                  ? "bg-orange-500 text-white shadow-lg"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              История
            </button>
          </div>
        </div>
      </header>

      {/* CONTENT */}
      <main className="p-4 space-y-3">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500 mb-3" />
            <p className="text-gray-500 text-sm">Загрузка рейсов...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Package className="h-16 w-16 text-gray-700 mb-4" />
            <p className="text-gray-400 font-medium mb-1">
              {tab === "active" ? "Нет активных рейсов" : "История пуста"}
            </p>
            <p className="text-gray-600 text-sm text-center max-w-xs">
              {tab === "active"
                ? "Новые рейсы появятся здесь, когда логист назначит их вам"
                : "Завершённые рейсы будут отображаться здесь"}
            </p>
          </div>
        ) : (
          orders.map((order: any) => {
            const statusInfo = getStatusInfo(order.status)
            const StatusIcon = statusInfo.icon

            return (
              <Link
                key={order.id}
                href={`/m/orders/${order.id}`}
                className="block w-full bg-[#1a1a1f] border border-gray-800 rounded-2xl p-4 text-left active:scale-[0.99] transition-transform hover:border-gray-700"
              >
                {/* Верхняя часть: груз + статус */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white mb-1 truncate">
                      {order.cargoType}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(order.createdAt).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${statusInfo.className}`}
                  >
                    <StatusIcon className="h-3 w-3" />
                    {statusInfo.label}
                  </span>
                </div>

                {/* Маршрут */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex flex-col items-center pt-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    <div className="w-0.5 h-6 bg-gray-700 my-1" />
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-sm text-gray-200 truncate">
                      {order.routeFrom}
                    </p>
                    <p className="text-sm text-gray-200 truncate">
                      {order.routeTo}
                    </p>
                  </div>
                </div>

                {/* Нижняя часть: расстояние + цена */}
                <div className="flex items-center justify-between pt-3 border-t border-gray-800">
                  <div className="flex items-center gap-1.5 text-gray-500">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="text-sm">
                      {order.distance ? `${order.distance} км` : "—"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {order.price && order.price > 0 && (
                      <span className="text-sm font-bold text-orange-400">
                        {order.price.toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-gray-600" />
                  </div>
                </div>
              </Link>
            )
          })
        )}
      </main>

      <BottomNav />
    </div>
  )
}