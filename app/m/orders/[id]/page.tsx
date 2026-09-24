"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import {
  Navigation,
  Phone,
  Camera,
  MapPin,
  Package,
  FileText,
  ChevronLeft,
  Loader2,
  Truck,
  Clock,
  Banknote,
  Weight,
  Box,
  User,
} from "lucide-react"

interface Order {
  id: string
  routeFrom: string
  routeTo: string
  distance: number | null
  cargoType: string
  weight: number | null
  volume: number | null
  clientName: string | null
  clientContact: string
  status: string
  price: number | null
  loadingType: string | null
  requirements: string | null
  deadline: string | null
}

export default function OrderDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const orderId = params?.id as string

  const [order, setOrder] = useState<Order | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!orderId) return

      try {
        const res = await fetch(`/api/orders/${orderId}`)
        const data = await res.json().catch(() => ({}))
        if (data.success && data.order) {
          setOrder(data.order as Order)
          setErrorMessage(null)
        } else {
          // Сервер отвечает 401/403/404 с понятным текстом — показываем его,
          // а не безликое «не найдено» (иначе водитель не отличит «нет доступа»
          // от «заказ удалён»)
          setOrder(null)
          setErrorMessage(data?.error || `Заказ не загружен (код ${res.status})`)
        }
      } catch (e) {
        console.error("Failed to load order:", e)
        setOrder(null)
        setErrorMessage("Не удалось связаться с сервером")
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [orderId])

  const openNavigator = (address: string) => {
    window.open(
      `https://yandex.ru/maps/?rtext=~${encodeURIComponent(address)}&rtt=auto`,
      "_blank"
    )
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "loading":
        return "Погрузка"
      case "unloading":
        return "Выгрузка"
      case "in_transit":
      case "control":
        return "В пути"
      // канон этапов заказа — lib/orders/stages.ts
      case "search":
        return "Поиск"
      case "negotiation":
        return "Согласование"
      case "agreed":
        return "Согласован"
      case "in_route":
        return "В рейсе"
      case "documents":
        return "Документы"
      case "assigned":
        return "Назначен"
      case "delivered":
        return "Доставлен"
      case "cancelled":
        return "Отменён"
      case "rejected":
        return "Отклонён"
      case "expired":
        return "Просрочен"
      default:
        return "В работе"
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center gap-4 p-4">
        <Package className="h-16 w-16 text-gray-700" />
        <p className="text-gray-400 text-center">{errorMessage || "Заказ не найден"}</p>
        <button
          onClick={() => router.push("/m/orders")}
          className="px-6 py-3 rounded-xl bg-orange-500 text-white font-medium"
        >
          К списку рейсов
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold truncate">Рейс</h1>
            <p className="text-xs text-gray-500">
              {getStatusLabel(order.status)}
            </p>
          </div>
        </div>
      </header>

      <main className="p-4 space-y-4">
        {/* Маршрут */}
        <div className="bg-[#1a1a1f] border border-gray-800 rounded-2xl p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">
            Маршрут
          </h3>

          {/* Точка А — Погрузка */}
          <div className="relative pl-8 pb-6">
            <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <div className="absolute left-[11px] top-6 w-0.5 h-full bg-gray-700" />

            <div className="text-xs text-green-400 font-medium mb-1">
              Погрузка
            </div>
            <p className="font-medium text-white mb-3">{order.routeFrom}</p>

            <button
              onClick={() => openNavigator(order.routeFrom)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-medium transition-colors"
            >
              <Navigation className="h-4 w-4" />
              Маршрут
            </button>
          </div>

          {/* Точка Б — Выгрузка */}
          <div className="relative pl-8">
            <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-red-500" />
            </div>

            <div className="text-xs text-red-400 font-medium mb-1">
              Выгрузка
            </div>
            <p className="font-medium text-white mb-3">{order.routeTo}</p>

            <button
              onClick={() => openNavigator(order.routeTo)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-medium transition-colors"
            >
              <Navigation className="h-4 w-4" />
              Маршрут
            </button>
          </div>
        </div>

        {/* Быстрые действия */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => router.push("/m/photo")}
            className="bg-[#1a1a1f] border border-gray-800 hover:border-gray-700 p-4 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <Camera className="h-6 w-6 text-orange-400" />
            </div>
            <span className="text-sm font-medium">Фото</span>
          </button>

          {order.clientContact && (
            <a
              href={`tel:${order.clientContact}`}
              className="bg-[#1a1a1f] border border-gray-800 hover:border-gray-700 p-4 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                <Phone className="h-6 w-6 text-green-400" />
              </div>
              <span className="text-sm font-medium">Позвонить</span>
            </a>
          )}
        </div>

        {/* Информация о грузе */}
        <div className="bg-[#1a1a1f] border border-gray-800 rounded-2xl p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">
            Информация о грузе
          </h3>

          <div className="space-y-4">
            {/* Тип груза */}
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                <Package className="h-5 w-5 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Груз</p>
                <p className="font-medium">{order.cargoType}</p>
              </div>
            </div>

            {/* Вес и объём */}
            <div className="flex gap-4">
              {order.weight && (
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                    <Weight className="h-5 w-5 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Вес</p>
                    <p className="font-medium">
                      {(order.weight / 1000).toFixed(1)} т
                    </p>
                  </div>
                </div>
              )}
              {order.volume && (
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                    <Box className="h-5 w-5 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Объём</p>
                    <p className="font-medium">{order.volume} м³</p>
                  </div>
                </div>
              )}
            </div>

            {/* Расстояние */}
            {order.distance && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <MapPin className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Расстояние</p>
                  <p className="font-medium">{order.distance} км</p>
                </div>
              </div>
            )}

            {/* Стоимость */}
            {order.price && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <Banknote className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Стоимость</p>
                  <p className="font-medium text-orange-400">
                    {order.price.toLocaleString("ru-RU")} ₽
                  </p>
                </div>
              </div>
            )}

            {/* Клиент */}
            {order.clientName && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Клиент</p>
                  <p className="font-medium">{order.clientName}</p>
                </div>
              </div>
            )}

            {/* Тип загрузки */}
            {order.loadingType && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <Truck className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Тип загрузки</p>
                  <p className="font-medium">{order.loadingType}</p>
                </div>
              </div>
            )}

            {/* Дедлайн */}
            {order.deadline && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Срок доставки</p>
                  <p className="font-medium">
                    {new Date(order.deadline).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Особые требования */}
        {order.requirements && (
          <div className="bg-[#1a1a1f] border border-gray-800 rounded-2xl p-5">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
              Особые требования
            </h3>
            <p className="text-sm text-gray-300 leading-relaxed">
              {order.requirements}
            </p>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  )
}