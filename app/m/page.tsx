// app/m/page.tsx

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useDriverSession } from "@/hooks/use-driver-session"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import { SosButton } from "@/components/driver-mobile/sos-button"
import { DriverChatButton } from "@/components/driver-mobile/chat-button"
import { DriverNotificationsBell } from "@/components/driver-mobile/notifications-bell"
import { PendingLoadCard } from "@/components/driver-mobile/pending-load-card"
import { useDriverNotifications } from "@/hooks/use-driver-notifications"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { FirstLoginGuide } from "@/components/onboarding/first-login-guide"
import { isOrderClosed, isOrderMoving } from "@/lib/orders/stages"
import {
  Truck,
  Package,
  Coffee,
  Moon,
  Clock,
  Fuel,
  CheckCircle,
  Play,
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
import { TruckLoader } from "@/components/ui/truck-loader"

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

/**
 * Смена приходит сырой записью DriverShift: длительности считаем на клиенте
 * от startedAt/lastStatusChangeAt, а норму вождения — из блока rest ответа.
 */
interface Shift {
  id: string
  status: string
  startedAt: string
  lastStatusChangeAt: string
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
  const confirm = useConfirm()
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
  // Нормы отдыха: непрерывное время в пути и подсказка «пора отдыхать»
  const [rest, setRest] = useState<{
    resting: boolean
    restDue: boolean
    drivingMinutes: number
    minutesToRest: number
    currentBreakMin: number
    breakCounts: boolean
    limitMin: number
    minBreakMin: number
  } | null>(null)
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
        setRest(shiftData.rest || null)
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

    const okShift = await confirm({
      title: "Завершить смену?",
      description: "Смена закроется, а рейс останется за вами — открыть смену можно снова.",
      confirmLabel: "Завершить",
      destructive: true,
    })
    if (!okShift) return

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
        const baseAddress = typeof data.baseAddress === "string" ? data.baseAddress : null
        const baseLat = typeof data.baseLat === "number" ? data.baseLat : null
        const baseLng = typeof data.baseLng === "number" ? data.baseLng : null

        const formatEta = (min: number) => {
          if (min < 60) return `${min} мин`
          const h = Math.floor(min / 60)
          const m = min % 60
          return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
        }

        toast.success("Возврат на базу", {
          description: `${distanceKm} км • ~${formatEta(etaMinutes)}${
            baseAddress ? ` • ${baseAddress}` : ""
          }`,
          // Знать расстояние полезно, но ехать водитель будет по навигатору —
          // кнопка ведёт в Яндекс.Карты, как в карточке рейса.
          action:
            baseLat !== null &&
            baseLng !== null &&
            typeof latitude === "number" &&
            typeof longitude === "number"
              ? {
                  label: "Маршрут",
                  onClick: () =>
                    window.open(
                      `https://yandex.ru/maps/?rtext=${latitude},${longitude}~${baseLat},${baseLng}&rtt=auto`,
                      "_blank",
                      "noopener",
                    ),
                }
              : undefined,
        })
      } else {
        // Показываем причину с сервера: «адрес базы не указан» полезнее,
        // чем безличное «ошибка маршрута»
        toast.error(
          typeof data.error === "string" && data.error ? data.error : "Ошибка маршрута",
        )
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

    const okRoute = await confirm({
      title: "Завершить рейс?",
      description:
        pendingCount > 1
          ? `Незакрытых точек: ${pendingCount}. Все они будут отмечены как доставленные.`
          : "Рейс закроется, машина освободится для следующего задания.",
      confirmLabel: "Завершить рейс",
    })
    if (!okRoute) return

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
        <TruckLoader className="text-orange-500" />
      </div>
    )
  }

  // ✅ Если нет авторизации, хук сам перенаправит
  if (!isAuthenticated || !driver) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <TruckLoader className="text-orange-500" />
      </div>
    )
  }

  const toggleRest = async () => {
    const routeId = (activeOrder as any)?.routeId
    if (!driver?.id || !routeId) {
      toast.error("Отдых отмечаем в рейсе: дождитесь активного заказа")
      return
    }
    const status = rest?.resting ? "rest_end" : "rest_start"
    try {
      const res = await fetch("/api/m/route/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ routeId, driverId: driver.id, type: "status", status }),
      })
      const data = await res.json()
      if (!data.success) {
        toast.error(data.error || "Не удалось отметить отдых")
        return
      }
      toast.success(status === "rest_start" ? "Отдых начат: машина стоит, таймер отдыха идёт" : "Отдых завершён: хорошего пути")
      void fetchData()
    } catch {
      toast.error("Ошибка связи с сервером")
    }
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
    <div
      className={`min-h-screen bg-[#09090b] text-white ${
        shift && !isOnMaintenance ? "m-nav-pad-sos" : "m-nav-pad"
      }`}
    >
      {/* ... весь существующий JSX ... */}
      {/* Инструктаж при первом входе водителя */}
      <FirstLoginGuide />
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

              <DriverChatButton />
            </div>
          </div>
        </div>
      </header>

      <main className="p-4 space-y-4">
        {/* Догрузы требуют ответа — всегда наверху */}
        {proposedLoads.map((load) => (
          <PendingLoadCard
            key={load.id}
            load={load}
            onAccept={() => handleLoadProposal(load.id, true)}
            onReject={(reason) => handleLoadProposal(load.id, false, reason)}
          />
        ))}

        {isOnMaintenance && activeMaintenance ? (
          /* Машина на ТО: смена и рейс недоступны, пока ремонт не закрыт */
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-amber-400" />
              <span className="font-semibold text-amber-300">Машина на ТО</span>
            </div>
            <p className="text-sm text-gray-300">{activeMaintenance.description || activeMaintenance.type}</p>
            <p className="text-xs text-gray-500">
              Начато: {new Date(activeMaintenance.startedAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
            </p>
            <button
              type="button"
              onClick={completeMaintenance}
              disabled={isChangingStatus}
              className="w-full min-h-[48px] rounded-xl bg-amber-500 text-black font-semibold active:opacity-80 disabled:opacity-50"
            >
              Завершить ТО
            </button>
          </div>
        ) : !shift ? (
          /* Смена не начата: одна большая понятная кнопка */
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-800">
                <Power className="h-5 w-5 text-gray-400" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold">Смена не начата</p>
                <p className="text-xs text-gray-500">Начните смену, чтобы выйти на линию</p>
              </div>
            </div>
            {activeOrder && (
              <div className="flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 text-sm">
                <Truck className="h-4 w-4 shrink-0 text-orange-400" />
                <span className="truncate text-orange-200">
                  Вас ждёт рейс: {activeOrder.routeFrom} → {activeOrder.routeTo}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={startShift}
              disabled={isChangingStatus}
              className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-orange-500 font-semibold text-white active:opacity-80 disabled:opacity-50"
            >
              <PlayCircle className="h-5 w-5" />
              Начать смену
            </button>
          </div>
        ) : (
          <>
            {/* Смена идёт: таймеры и норма вождения (цифры обновляются вместе с опросом раз в 30 с) */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-green-400" />
                  <span className="text-sm font-medium text-green-400">Смена идёт</span>
                </div>
                <span className="text-sm text-gray-400">
                  {formatDuration(Math.floor((Date.now() - new Date(shift.startedAt).getTime()) / 1000))}
                </span>
              </div>
              {hasActiveTrip && rest && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>За рулём без перерыва</span>
                    <span>{formatDuration(rest.drivingMinutes * 60)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
                    <div
                      className={`h-full rounded-full transition-all ${
                        rest.restDue ? "bg-red-500" : rest.minutesToRest <= 30 ? "bg-amber-500" : "bg-green-500"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, (rest.drivingMinutes / Math.max(1, rest.limitMin)) * 100))}%`,
                      }}
                    />
                  </div>
                  {rest.restDue && !rest.resting && (
                    <p className="flex items-center gap-1.5 text-xs text-red-400">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      Пора отдохнуть: отметьте перерыв кнопкой «Отдых»
                    </p>
                  )}
                  {rest?.resting && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-300">
                      <Coffee className="h-3.5 w-3.5 shrink-0" />
                      Отдых идёт: {rest.currentBreakMin} мин{rest.breakCounts ? "" : ` (зачтётся от ${rest.minBreakMin} мин)`}
                    </p>
                  )}
                </div>
              )}
            </div>

            {hasPendingTrip && activeOrder && (
              /* Назначенный, но не начатый рейс */
              <div className="rounded-2xl border border-orange-500/40 bg-orange-500/10 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-orange-400" />
                  <span className="font-semibold text-orange-300">Вам назначен рейс</span>
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{activeOrder.routeFrom} → {activeOrder.routeTo}</p>
                  <p className="text-xs text-gray-400">
                    {activeOrder.cargoType}
                    {activeOrder.distance > 0 && ` • ${activeOrder.distance} км`}
                    {activeOrder.clientName && ` • ${activeOrder.clientName}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={acceptTrip}
                  disabled={isChangingStatus}
                  className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-orange-500 font-semibold text-white active:opacity-80 disabled:opacity-50"
                >
                  <Play className="h-5 w-5" />
                  Начать рейс
                </button>
              </div>
            )}

            {hasActiveTrip && activeOrder && (
              <>
                {/* Текущий рейс и точки маршрута */}
                <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <currentTripStatus.icon className="h-4 w-4 shrink-0 text-orange-400" />
                      <span className="truncate text-sm font-medium">{currentTripStatus.label}</span>
                      <span className="shrink-0 text-xs text-gray-500">
                        {formatDuration(Math.floor((Date.now() - new Date(shift.lastStatusChangeAt).getTime()) / 1000))}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-gray-500">Выполнено {routeProgress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
                    <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${routeProgress}%` }} />
                  </div>
                  <div className="space-y-1">
                    {allRouteOrders.map((point, i) => {
                      const closed = isOrderClosed(point.status)
                      const isCurrent = point.id === activeOrder.id
                      return (
                        <button
                          key={point.id}
                          type="button"
                          onClick={() => router.push(`/m/orders/${point.id}`)}
                          className={`flex w-full min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-left active:opacity-70 ${
                            isCurrent ? "bg-orange-500/10 border border-orange-500/30" : "border border-transparent"
                          }`}
                        >
                          {closed ? (
                            <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
                          ) : (
                            <MapPin className={`h-4 w-4 shrink-0 ${isCurrent ? "text-orange-400" : "text-gray-500"}`} />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-sm ${closed ? "text-gray-500 line-through" : ""}`}>
                              {i + 1}. {point.routeFrom} → {point.routeTo}
                            </p>
                            <p className="truncate text-xs text-gray-500">
                              {point.cargoType}
                              {point.isAdditionalLoad && " • догруз"}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-gray-600" />
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Чем вы сейчас заняты: статусы рейса */}
                <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Что сейчас делаете</p>
                  <div className="grid grid-cols-2 gap-2">
                    {TRIP_STATUSES.map((status) => {
                      const Icon = status.icon
                      const isActive = shift.status === status.id
                      const handleClick = () => {
                        // «Отдых» фиксируется событием рейса (таймер отдыха), остальное — статусом смены
                        if (status.id === "resting") {
                          void toggleRest()
                          return
                        }
                        void changeTripStatus(status.id)
                      }
                      const restActive = status.id === "resting" && rest?.resting
                      return (
                        <button
                          key={status.id}
                          type="button"
                          onClick={handleClick}
                          disabled={isChangingStatus}
                          className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border p-2 text-xs font-medium transition-colors active:opacity-70 disabled:opacity-50 ${
                            isActive || restActive
                              ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                              : "border-gray-800 bg-gray-900 text-gray-300"
                          }`}
                        >
                          <span className={`flex h-7 w-7 items-center justify-center rounded-full ${status.color}`}>
                            <Icon className="h-4 w-4 text-white" />
                          </span>
                          {status.id === "resting" && rest?.resting ? "Завершить отдых" : status.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={completeRoute}
                  disabled={completingRoute}
                  className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-green-600 font-semibold text-white active:opacity-80 disabled:opacity-50"
                >
                  <Flag className="h-5 w-5" />
                  {completingRoute ? "Завершаем..." : "Завершить рейс"}
                </button>
              </>
            )}

            {!activeOrder && (
              /* Смена открыта, рейса нет */
              <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-800">
                    <ParkingCircle className="h-5 w-5 text-gray-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold">Ожидаю рейс</p>
                    <p className="text-xs text-gray-500">Логист назначит задание — придёт уведомление</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => changeIdleStatus("maintenance")}
                  disabled={isChangingStatus}
                  className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl border border-gray-700 bg-gray-900 text-sm font-medium text-gray-200 active:opacity-70 disabled:opacity-50"
                >
                  <Wrench className="h-4 w-4 text-amber-400" />
                  Отметить ТО / ремонт
                </button>
              </div>
            )}

            {/* Общие действия смены */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={goToBase}
                disabled={isGoingToBase}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-gray-700 bg-gray-900 text-sm font-medium text-gray-200 active:opacity-70 disabled:opacity-50"
              >
                <Home className="h-4 w-4 text-sky-400" />
                {isGoingToBase ? "Считаем..." : "На базу"}
              </button>
              <button
                type="button"
                onClick={endShift}
                disabled={isChangingStatus}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-sm font-medium text-red-400 active:opacity-70 disabled:opacity-50"
              >
                <Power className="h-4 w-4" />
                Завершить смену
              </button>
            </div>
          </>
        )}
      </main>

      {shift && !isOnMaintenance && <SosButton orderId={activeOrder?.id} />}

      <BottomNav />
    </div>
  )
}