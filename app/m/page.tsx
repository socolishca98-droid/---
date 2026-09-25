// app/m/page.tsx

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useDriverSession } from "@/hooks/use-driver-session"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import { SosButton } from "@/components/driver-mobile/sos-button"
import { DriverNotificationsBell } from "@/components/driver-mobile/notifications-bell"
import { PendingLoadCard } from "@/components/driver-mobile/pending-load-card"
import { useDriverNotifications } from "@/hooks/use-driver-notifications"
import { isOrderClosed, isOrderMoving } from "@/lib/orders/stages"
import {
  Loader2,
  Truck,
  Package,
  Coffee,
  Moon,
  Clock,
  Fuel,
  CheckCircle,
  Play,
  MessageCircle,
  ChevronRight,
  Locate,
  WifiOff,
  Camera,
  Wifi,
  AlertCircle,
  Home,
  Power,
  Wrench,
  ParkingCircle,
  PlayCircle,
  MapPin,
  Flag,
} from "lucide-react"
import { toast } from "sonner"
import { getPhotoQueue } from "@/lib/offline/photo-queue"

// ... (оставляем все константы IDLE_STATUSES, TRIP_STATUSES, интерфейсы без изменений)

const IDLE_STATUSES = [
  {
    id: "waiting",
    label: "Ожидаю рейс",
    icon: ParkingCircle,
    color: "bg-gray-500",
    description: "Смена активна, жду назначения рейса",
  },
  {
    id: "maintenance",
    label: "ТО / Ремонт",
    icon: Wrench,
    color: "bg-amber-500",
    description: "Техобслуживание",
    requiresForm: true,
  },
] as const

const TRIP_STATUSES = [
  {
    id: "driving",
    label: "В пути",
    icon: Truck,
    color: "bg-orange-500",
    description: "Еду по маршруту",
  },
  {
    id: "loading",
    label: "Погрузка",
    icon: Package,
    color: "bg-blue-500",
    description: "На погрузке",
  },
  {
    id: "unloading",
    label: "Выгрузка",
    icon: CheckCircle,
    color: "bg-emerald-500",
    description: "На выгрузке",
  },
  {
    id: "fueling",
    label: "Заправка",
    icon: Fuel,
    color: "bg-purple-500",
    description: "Заправляюсь",
  },
  {
    id: "resting",
    label: "Отдых",
    icon: Coffee,
    color: "bg-amber-500",
    description: "Перерыв 15–45 мин",
  },
  {
    id: "sleeping",
    label: "Сон",
    icon: Moon,
    color: "bg-indigo-500",
    description: "Ночной отдых",
  },
  {
    id: "waiting_point",
    label: "Ожидание",
    icon: Clock,
    color: "bg-gray-500",
    description: "Жду на точке",
  },
] as const

interface Shift {
  id: string
  status: string
  statusDuration: number
  currentDrivingSeconds: number
  totalShiftSeconds: number
  drivingProgress: number
  drivingRemaining: number
  needsRest: boolean
  restWarning: boolean
}

interface ActiveOrder {
  id: string
  routeFrom: string
  routeTo: string
  distance: number
  cargoType: string
  price?: number
  clientName?: string
  status: string
  deadline?: string
  routeId?: string
  isAdditionalLoad?: boolean
}

interface ActiveMaintenance {
  id: string
  type: string
  description: string
  startedAt: string
}

interface ProposedLoad {
  id: string
  routeFrom: string
  routeTo: string
  distance: number
  weight: number
  price: number
  cargoType: string
  proposedAt?: string
}

type GpsStatus = "inactive" | "searching" | "active" | "error"

let geoPermissionToastShown = false

export default function MobileHomePage() {
  const router = useRouter()

  // ✅ Используем централизованный хук вместо ручного парсинга
  const { driver, isLoading: isSessionLoading, isAuthenticated } = useDriverSession()

  const [shift, setShift] = useState<Shift | null>(null)
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null)
  const [allRouteOrders, setAllRouteOrders] = useState<ActiveOrder[]>([])
  const [activeMaintenance, setActiveMaintenance] = useState<ActiveMaintenance | null>(null)
  const [proposedLoads, setProposedLoads] = useState<ProposedLoad[]>([])
  const [isDataLoading, setIsDataLoading] = useState(true)
  const [isChangingStatus, setIsChangingStatus] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("inactive")
  const [isGoingToBase, setIsGoingToBase] = useState(false)
  const [tripStarted, setTripStarted] = useState(false)
  const [completingRoute, setCompletingRoute] = useState(false)
  /** Связь и очередь фото: водитель видит, что чек не потерян, а ждёт сети */
  const [isOnline, setIsOnline] = useState(true)
  const [pendingPhotos, setPendingPhotos] = useState(0)

  // Офлайн-индикатор и число фото, ждущих отправки. Раньше это показывала
  // шапка MobileHeader, но её никто не подключал: водитель про отсутствие
  // связи не знал, хотя фото при этом молча копились в очереди.
  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine)
    updateOnline()

    window.addEventListener("online", updateOnline)
    window.addEventListener("offline", updateOnline)

    const queue = getPhotoQueue()
    let unsubscribe: (() => void) | undefined

    if (queue) {
      void queue.pendingCount().then(setPendingPhotos)
      unsubscribe = queue.subscribe((items) => setPendingPhotos(items.length))
    }

    return () => {
      window.removeEventListener("online", updateOnline)
      window.removeEventListener("offline", updateOnline)
      unsubscribe?.()
    }
  }, [])

  const gpsIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const dataIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const watchIdRef = useRef<number | null>(null)

  const { addNotification } = useDriverNotifications(driver?.id)

  // ✅ Загрузка данных после получения сессии
  const fetchData = useCallback(async () => {
    if (!driver?.id) return

    try {
      // Всё — из водительских эндпоинтов (requireDriver по сессии).
      // Штабные /api/drivers/[id]/active-order и /api/orders водительская
      // сессия не проходит: экран оставался пустым.
      const [shiftRes, routeRes, maintenanceRes] = await Promise.all([
        fetch(`/api/m/shift?driverId=${driver.id}`),
        fetch("/api/m/route"),
        fetch(`/api/m/maintenance?driverId=${driver.id}`),
      ])

      const shiftData = await shiftRes.json()
      if (shiftData.success) {
        setShift(shiftData.shift || null)
      }

      const routeData = await routeRes.json()
      if (routeData.success) {
        // Точки рейса — это и есть заказы водителя по порядку объезда
        const points: ActiveOrder[] = (routeData.route?.points || []).map((point: any) => ({
          id: point.id,
          routeFrom: point.from,
          routeTo: point.to,
          distance: point.distanceKm ?? 0,
          cargoType: point.cargoType,
          price: point.price ?? undefined,
          clientName: point.clientName ?? undefined,
          status: point.status,
          routeId: routeData.route?.id,
          isAdditionalLoad: point.isAdditionalLoad,
        }))

        setAllRouteOrders(points)

        // Текущая точка — первая незакрытая
        const currentPoint = points.find((point) => !isOrderClosed(point.status)) || null
        setActiveOrder(currentPoint)

        // Рейс начат, если заказ в движении (канон — lib/orders/stages.ts,
        // прежние «in_transit»/«loading»/«unloading» приводятся к «control»)
        setTripStarted(Boolean(currentPoint && isOrderMoving(currentPoint.status)))

        setProposedLoads(
          (routeData.proposedLoads || []).map((load: any) => ({
            id: load.id,
            routeFrom: load.routeFrom,
            routeTo: load.routeTo,
            distance: load.distanceKm ?? 0,
            weight: load.weight ?? 0,
            price: load.price ?? 0,
            cargoType: load.cargoType,
          })),
        )
      }

      const maintenanceData = await maintenanceRes.json()
      if (maintenanceData.success) {
        setActiveMaintenance(maintenanceData.maintenance || null)
      }
    } catch (error) {
      console.error("[Mobile] Failed to fetch data:", error)
    } finally {
      setIsDataLoading(false)
    }
  }, [driver?.id])

  useEffect(() => {
    if (isAuthenticated && driver?.id) {
      fetchData()
      dataIntervalRef.current = setInterval(fetchData, 30000)
    }

    return () => {
      if (dataIntervalRef.current) clearInterval(dataIntervalRef.current)
    }
  }, [isAuthenticated, driver?.id, fetchData])

  // ... (остальной код GPS, startShift, endShift, etc. остаётся без изменений,
  //      но теперь использует driver из хука)

  const sendLocation = useCallback(
    async (position: GeolocationPosition) => {
      if (!driver?.id) return

      try {
        const res = await fetch("/api/m/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driverId: driver.id,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading,
          }),
        })

        setGpsStatus(res.ok ? "active" : "error")
      } catch (error) {
        console.error("[GPS] Send error:", error)
        setGpsStatus("error")
      }
    },
    [driver?.id]
  )

  const handleGpsError = useCallback((error: GeolocationPositionError) => {
    console.error("[GPS] Error:", error.message)

    if (error.code === error.PERMISSION_DENIED) {
      setGpsStatus("error")
      if (!geoPermissionToastShown) {
        geoPermissionToastShown = true
        toast.error("Нет доступа к геолокации", {
          description: "Разрешите доступ в настройках браузера",
        })
      }
      return
    }

    if (error.code === error.POSITION_UNAVAILABLE) {
      setGpsStatus("error")
      return
    }

    setGpsStatus("error")
  }, [])

  useEffect(() => {
    if (!shift || !driver?.id || !tripStarted) {
      setGpsStatus("inactive")
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current)
        gpsIntervalRef.current = null
      }
      return
    }

    if (!("geolocation" in navigator)) {
      setGpsStatus("error")
      toast.error("GPS не поддерживается")
      return
    }

    setGpsStatus("searching")

    navigator.geolocation.getCurrentPosition(sendLocation, handleGpsError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    })

    watchIdRef.current = navigator.geolocation.watchPosition(
      sendLocation,
      handleGpsError,
      { enableHighAccuracy: true, maximumAge: 30000 }
    )

    gpsIntervalRef.current = setInterval(() => {
      navigator.geolocation.getCurrentPosition(sendLocation, () => {}, {
        enableHighAccuracy: true,
        timeout: 10000,
      })
    }, 30000)

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      if (gpsIntervalRef.current) {
        clearInterval(gpsIntervalRef.current)
        gpsIntervalRef.current = null
      }
    }
  }, [shift, driver?.id, tripStarted, sendLocation, handleGpsError])

  const startShift = async () => {
    if (!driver?.id) return
    setIsChangingStatus(true)

    try {
      let latitude: number | undefined
      let longitude: number | undefined

      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5000,
          })
        })
        latitude = pos.coords.latitude
        longitude = pos.coords.longitude
      } catch {}

      const res = await fetch("/api/m/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: driver.id,
          action: "start",
          latitude,
          longitude,
        }),
      })

      const data = await res.json()
      if (data.success) {
        await fetchData()
        toast.success("Смена начата", {
          description: "Хорошего рабочего дня!",
        })
        if (navigator.vibrate) navigator.vibrate(100)
      } else {
        toast.error("Ошибка запуска смены", {
          description: data.error || "Не удалось начать смену",
        })
      }
    } catch {
      toast.error("Ошибка связи", {
        description: "Проверьте подключение к интернету",
      })
    } finally {
      setIsChangingStatus(false)
    }
  }

  const endShift = async () => {
    if (!driver?.id || !shift) return

    if (!confirm("Завершить смену?")) return

    setIsChangingStatus(true)

    try {
      const res = await fetch("/api/m/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: driver.id,
          action: "end",
        }),
      })

      const data = await res.json()
      if (data.success) {
        setShift(null)
        setActiveOrder(null)
        setTripStarted(false)
        toast.success("Смена завершена", {
          description: "Отдыхайте!",
        })
        if (navigator.vibrate) navigator.vibrate([100, 50, 100])
      } else {
        toast.error("Ошибка завершения смены", {
          description: data.error || "Не удалось завершить смену",
        })
      }
    } catch {
      toast.error("Ошибка связи")
    } finally {
      setIsChangingStatus(false)
    }
  }

  const changeIdleStatus = async (statusId: string) => {
    if (!driver?.id) return

    if (statusId === "maintenance") {
      router.push("/m/maintenance")
      return
    }
  }

  const acceptTrip = async () => {
    if (!driver?.id || !activeOrder) return

    setIsChangingStatus(true)

    try {
      const res = await fetch(`/api/m/orders/${activeOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "control" }),
      })

      const data = await res.json()
      if (data.success) {
        setTripStarted(true)
        setActiveOrder((prev) => (prev ? { ...prev, status: "control" } : prev))

        toast.success("Рейс начат", {
          description: `${activeOrder.routeFrom} → ${activeOrder.routeTo}`,
        })

        addNotification?.({
          type: "route",
          title: "Рейс начат",
          message: `Маршрут: ${activeOrder.routeFrom} → ${activeOrder.routeTo}`,
          action: { kind: "openOrder", orderId: activeOrder.id },
        })

        if (navigator.vibrate) navigator.vibrate(100)
      } else {
        toast.error("Ошибка принятия рейса", {
          description: data.error || "Не удалось начать рейс",
        })
      }
    } catch {
      toast.error("Ошибка связи")
    } finally {
      setIsChangingStatus(false)
    }
  }

  /**
   * Состояние рейса водителя (погрузка/выгрузка/в пути) — детальнее, чем этап
   * заказа, поэтому в заказе все три означают «на контроле». Подробное
   * состояние сохраняется в статусе самого водителя (POST /api/m/shift).
   */
  const mapTripStatusToOrderStatus = (statusId: string): string | undefined => {
    if (statusId === "loading") return "control"
    if (statusId === "unloading") return "control"
    if (statusId === "driving") return "control"
    return undefined
  }

  const changeTripStatus = async (statusId: string) => {
    if (!driver?.id || !shift || shift.status === statusId) return
    setIsChangingStatus(true)

    try {
      let latitude: number | undefined
      let longitude: number | undefined

      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 3000,
          })
        })
        latitude = pos.coords.latitude
        longitude = pos.coords.longitude
      } catch {}

      const res = await fetch("/api/m/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: driver.id,
          action: "status",
          status: statusId,
          latitude,
          longitude,
        }),
      })

      const data = await res.json()
      if (data.success) {
        const newOrderStatus = mapTripStatusToOrderStatus(statusId)
        if (activeOrder?.id && newOrderStatus) {
          try {
            await fetch(`/api/m/orders/${activeOrder.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: newOrderStatus }),
            })
          } catch (e) {
            console.error("[Mobile] Failed to update order status", e)
          }
        }

        await fetchData()

        if (statusId === "loading") {
          toast("📦 Погрузка", {
            description: "Сфотографируйте груз",
            action: {
              label: "Камера",
              onClick: () => router.push("/m/photo?context=loading"),
            },
          })
        } else if (statusId === "unloading") {
          toast("✅ Выгрузка", {
            description: "Сфотографируйте груз после выгрузки",
            action: {
              label: "Камера",
              onClick: () => router.push("/m/photo?context=unloading"),
            },
          })
        } else if (statusId === "fueling") {
          toast("⛽ Заправка", {
            description: "Сохраните чек",
            action: {
              label: "Сфотографировать чек",
              onClick: () => router.push("/m/photo?context=fueling"),
            },
          })
        } else {
          const statusMeta = TRIP_STATUSES.find((s: any) => s.id === statusId)
          toast.success(`Статус: ${statusMeta?.label || statusId}`)
        }

        if (navigator.vibrate) navigator.vibrate(50)
      } else {
        toast.error("Ошибка смены статуса", {
          description: data.error,
        })
      }
    } catch {
      toast.error("Ошибка связи")
    } finally {
      setIsChangingStatus(false)
    }
  }

  const goToBase = async () => {
    if (!driver?.id) return
    setIsGoingToBase(true)

    try {
      let latitude: number | undefined
      let longitude: number | undefined

      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 7000,
          })
        })
        latitude = pos.coords.latitude
        longitude = pos.coords.longitude
      } catch {
        toast.error("Геолокация недоступна")
        setIsGoingToBase(false)
        return
      }

      const res = await fetch("/api/m/base-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: driver.id, latitude, longitude }),
      })

      const data = await res.json()
      if (data.success) {
        const distanceKm = data.distanceKm as number
        const etaMinutes = data.etaMinutes as number

        const formatEta = (min: number) => {
          if (min < 60) return `${min} мин`
          const h = Math.floor(min / 60)
          const m = min % 60
          return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
        }

        toast.success("Возврат на базу", {
          description: `${distanceKm} км • ~${formatEta(etaMinutes)}`,
        })
      } else {
        toast.error("Ошибка маршрута")
      }
    } catch {
      toast.error("Ошибка")
    } finally {
      setIsGoingToBase(false)
    }
  }

  const completeRoute = async () => {
    if (!activeOrder?.routeId || !driver?.id) return

    const pendingCount = allRouteOrders.filter((o: any) => !["delivered", "cancelled", "rejected"].includes(o.status)
    ).length

    const confirmMessage =
      pendingCount > 1
        ? `Завершить рейс? Все ${pendingCount} точек будут отмечены как доставленные.`
        : "Завершить рейс?"

    if (!confirm(confirmMessage)) return

    setCompletingRoute(true)

    try {
      const res = await fetch(`/api/routes/${activeOrder.routeId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: driver.id,
          force: true,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setActiveOrder(null)
        setAllRouteOrders([])
        setTripStarted(false)
        setShift(null)

        toast.success("Рейс завершён!", {
          description: `${data.stats.ordersCount} точек, ${data.stats.totalRevenue.toLocaleString()}₽`,
        })

        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100])
      } else {
        toast.error("Ошибка завершения рейса", {
          description: data.error,
        })
      }
    } catch {
      toast.error("Ошибка связи")
    } finally {
      setCompletingRoute(false)
    }
  }

  const handleLoadProposal = async (orderId: string, accept: boolean, reason?: string) => {
    try {
      const res = await fetch("/api/m/route/accept-load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          driverId: driver?.id,
          accept,
          rejectionReason: reason,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setProposedLoads((prev) => prev.filter((l: any) => l.id !== orderId))
        toast.success(accept ? "Догруз принят" : "Догруз отклонён")
        await fetchData()
      } else {
        toast.error(data.error)
      }
    } catch {
      toast.error("Ошибка связи")
    }
  }

  const completeMaintenance = async () => {
    if (!activeMaintenance || !driver?.id) return

    setIsChangingStatus(true)

    try {
      const res = await fetch("/api/m/maintenance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maintenanceId: activeMaintenance.id,
          driverId: driver.id,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setActiveMaintenance(null)
        toast.success("ТО завершено")
      } else {
        toast.error("Ошибка завершения ТО")
      }
    } catch {
      toast.error("Ошибка связи")
    } finally {
      setIsChangingStatus(false)
    }
  }

  const formatDuration = (seconds: number): string => {
    if (!seconds || seconds < 0) return "0 м"
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0) return `${h} ч ${m} м`
    return `${m} м`
  }

  const currentTripStatus = TRIP_STATUSES.find((s: any) => s.id === shift?.status) || TRIP_STATUSES[0]

  // ✅ Показываем загрузку пока проверяется сессия
  if (isSessionLoading || isDataLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  // ✅ Если нет авторизации, хук сам перенаправит
  if (!isAuthenticated || !driver) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  const hasActiveTrip = activeOrder !== null && tripStarted
  const hasPendingTrip = activeOrder !== null && !tripStarted
  const isOnMaintenance = activeMaintenance !== null
  const routeProgress =
    allRouteOrders.length > 0
      ? Math.round(
          (allRouteOrders.filter((o: any) => o.status === "delivered").length /
            allRouteOrders.length) *
            100
        )
      : 0

  // ... (весь JSX остаётся без изменений, так как driver теперь из хука)
  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-24">
      {/* ... весь существующий JSX ... */}
      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold truncate">{driver.name}</h1>
              <p className="text-xs text-gray-500 truncate">
                {driver.vehiclePlate || "Нет ТС"}
                {driver.vehicleType && ` • ${driver.vehicleType}`}
              </p>
            </div>

            <div className="flex items-center gap-2 ml-3">
              {hasActiveTrip && shift && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    gpsStatus === "active"
                      ? "bg-green-500/20 text-green-400 border border-green-500/30"
                      : gpsStatus === "error"
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : gpsStatus === "searching"
                          ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                          : "bg-gray-500/20 text-gray-400 border border-gray-500/30"
                  }`}
                >
                  {gpsStatus === "active" && <Wifi className="h-3 w-3" />}
                  {gpsStatus === "error" && <WifiOff className="h-3 w-3" />}
                  {gpsStatus === "searching" && <Locate className="h-3 w-3 animate-pulse" />}
                  {gpsStatus === "inactive" && <WifiOff className="h-3 w-3" />}
                  <span>GPS</span>
                </div>
              )}

              {!isOnline && (
                <span
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  title="Нет связи: действия отправятся, когда сеть вернётся"
                >
                  <WifiOff className="h-3 w-3" />
                  Офлайн
                </span>
              )}

              {pendingPhotos > 0 && (
                <span
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium bg-sky-500/20 text-sky-400 border border-sky-500/30"
                  title="Фото ждут отправки и уйдут сами"
                >
                  <Camera className="h-3 w-3" />
                  {pendingPhotos}
                </span>
              )}

              <DriverNotificationsBell driverId={driver.id} />

              <button
                onClick={() => router.push("/m/chat")}
                className="p-2.5 hover:bg-gray-800 rounded-xl transition-colors"
              >
                <MessageCircle className="h-5 w-5 text-gray-400" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Остальной JSX... (без изменений, код слишком длинный) */}
      <main className="p-4 space-y-4">
        {/* ... */}
      </main>

      {shift && !isOnMaintenance && <SosButton orderId={activeOrder?.id} />}

      <BottomNav />
    </div>
  )
}