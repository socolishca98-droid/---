// app/m/page.tsx
//
// Кабина водителя — главный экран мобильного приложения.
//
// Экран перестроен вокруг управления рейсом, а не вокруг списка статусов.
// Водитель видит пульт: чем занят сейчас, сколько это длится, на каком шаге
// рейса он находится и что делать дальше. Кнопки «В пути / Погрузка /
// Выгрузка / Ожидание / Заправка / Отдых / Сон» пишут события в журнал смены
// (ShiftEvent) — из него считаются и итоги за смену на этом же экране, и
// аналитика по организации (сколько водитель простоял на погрузке, сколько
// ждал у ворот, сколько отдыхал).
//
// Вся математика времени — в lib/shift/timeline.ts, работа с базой — в
// lib/shift/service.ts, роут — app/api/m/shift/route.ts. Здесь только экран.

"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"

import { useDriverSession } from "@/hooks/use-driver-session"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import { SosButton } from "@/components/driver-mobile/sos-button"
import { DriverChatButton } from "@/components/driver-mobile/chat-button"
import { DriverNotificationsBell } from "@/components/driver-mobile/notifications-bell"
import { PendingLoadCard } from "@/components/driver-mobile/pending-load-card"
import { ActionGrid } from "@/components/driver-mobile/action-grid"
import { ControlPanel } from "@/components/driver-mobile/control-panel"
import { RestCard } from "@/components/driver-mobile/rest-card"
import { PushCard as DriverPushCard } from "@/components/driver-mobile/push-card"
import { TripStagePanel } from "@/components/driver-mobile/trip-stage-panel"
import { useDriverNotifications } from "@/hooks/use-driver-notifications"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { FirstLoginGuide } from "@/components/onboarding/first-login-guide"
import { isOrderClosed } from "@/lib/orders/stages"
import { tripState } from "@/lib/shift/trip-state"
import { shortPersonName } from "@/lib/logist-mobile/format"
import { emptyTotals, shiftStatusLabel, type ShiftTotals } from "@/lib/shift/timeline"
import {
  AlertCircle,
  Camera,
  CheckCircle,
  ChevronRight,
  Clock,
  Flag,
  Home,
  Locate,
  MapPin,
  ParkingCircle,
  Play,
  PlayCircle,
  Power,
  Truck,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"
import { getPhotoQueue } from "@/lib/offline/photo-queue"
import { useAdaptivePolling } from "@/hooks/use-adaptive-polling"
import { TruckLoader } from "@/components/ui/truck-loader"

interface Shift {
  id: string
  status: string
  startedAt: string
  lastStatusChangeAt: string
}

interface RestInfo {
  resting: boolean
  restDue: boolean
  drivingMinutes: number
  minutesToRest: number
  currentBreakMin: number
  breakCounts: boolean
  limitMin: number
  minBreakMin: number
}

interface RoutePoint {
  id: string
  routeFrom: string
  routeTo: string
  distance: number
  cargoType: string
  price?: number
  clientName?: string
  status: string
  routeId?: string
  isAdditionalLoad?: boolean
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

interface ActiveMaintenance {
  id: string
  type: string
  description: string
  startedAt: string
}

// Плашка GPS показывает причину всегда: смена не начата / рейс не назначен /
// ожидание сигнала / работает / отказано в доступе / ошибка отправки.
type GpsStatus =
  | "inactive"      // смена не начата
  | "no_trip"       // смена идёт, но рейс не назначен
  | "searching"     // ждём спутники
  | "active"        // координаты уходят
  | "denied"        // браузер не дал геолокацию
  | "error"         // отправка не удалась

// Подписи только про геолокацию. Раньше здесь стояло «Рейс не назначен» и
// «Смена не начата» — чип в шапке читался как состояние рейса и спорил с
// карточкой «Вам назначен рейс» на том же экране.
const GPS_LABELS: Record<GpsStatus, string> = {
  inactive: "GPS выкл.",
  no_trip: "GPS ждёт рейс",
  searching: "GPS ищет",
  active: "GPS ок",
  denied: "GPS запрещён",
  error: "GPS: ошибка",
}

/** Статусы, при которых заказ считается «в исполнении». */
const ORDER_STATUS_FOR_TRIP: Record<string, string> = {
  driving: "control",
  loading: "control",
  unloading: "control",
  waiting_point: "control",
}

/** Что делать после перерыва: запоминаем, чем водитель занимался. */
const DEFAULT_RETURN_STATUS = "driving"

export default function MobileHomePage() {
  const confirm = useConfirm()
  const router = useRouter()

  const { driver, isLoading: isSessionLoading, isAuthenticated } = useDriverSession()

  const [shift, setShift] = useState<Shift | null>(null)
  const [statusSeconds, setStatusSeconds] = useState(0)
  const [totals, setTotals] = useState<ShiftTotals>(emptyTotals())
  const [rest, setRest] = useState<RestInfo | null>(null)
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([])
  const [proposedLoads, setProposedLoads] = useState<ProposedLoad[]>([])
  const [activeMaintenance, setActiveMaintenance] = useState<ActiveMaintenance | null>(null)
  const [isDataLoading, setIsDataLoading] = useState(true)
  // Рейс приходит заметно позже смены (до 14 с на холодном сервере) — экран
  // показываем сразу после смены, а на месте карточки рейса честно пишем, что
  // он ещё грузится.
  const [isRouteLoading, setIsRouteLoading] = useState(true)
  const [isChangingStatus, setIsChangingStatus] = useState(false)
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("inactive")
  const [isGoingToBase, setIsGoingToBase] = useState(false)
  const [completingRoute, setCompletingRoute] = useState(false)
  const [returnAfterRest, setReturnAfterRest] = useState(DEFAULT_RETURN_STATUS)
  // Прогноз рейса и кнопки текущего этапа — приходят с сервера вместе с рейсом
  const [trip, setTrip] = useState<any>(null)
  /** Связь и очередь фото: водитель видит, что чек не потерян, а ждёт сети */
  const [isOnline, setIsOnline] = useState(true)
  const [pendingPhotos, setPendingPhotos] = useState(0)

  const gpsIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const watchIdRef = useRef<number | null>(null)

  const { addNotification } = useDriverNotifications(driver?.id)

  // ── Офлайн-индикатор и очередь фото ────────────────────────────────────
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

  // Открытые точки — это и есть текущий рейс. Закрытые остаются в списке как
  // история, но «активным рейсом» больше не считаются: раньше из-за этого на
  // выполненном рейсе висело «Вам назначен рейс · Начать рейс», а кнопка молча
  // ничего не делала.
  const tripView = tripState(routePoints)
  const activeOrder = tripView.active
  const hasActiveTrip = tripView.hasActiveTrip
  const closedPoints = tripView.closed.length
  const tripFinished = tripView.finished
  const routeProgress = tripView.progress

  // ── Загрузка данных ────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!driver?.id) return

    try {
      // Смена — первым запросом и без ожидания остальных: она решает, что
      // вообще показывать на экране. Раньше экран ждал весь пакет и висел на
      // загрузчике 8–14 секунд.
      const shiftRes = await fetch("/api/m/shift")
      const shiftData = await shiftRes.json()
      if (shiftData.success) {
        setShift(shiftData.shift || null)
        setStatusSeconds(shiftData.statusSeconds ?? 0)
        setTotals(shiftData.totals ?? emptyTotals())
        setRest(shiftData.rest || null)
      }
      setIsDataLoading(false)

      const [routeRes, maintenanceRes] = await Promise.all([
        fetch("/api/m/route"),
        fetch(`/api/m/maintenance?driverId=${driver.id}`),
      ])

      const routeData = await routeRes.json()
      if (routeData.success) {
        const points: RoutePoint[] = (routeData.route?.points || []).map((point: any) => ({
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

        setRoutePoints(points)
        setTrip(routeData.trip ?? null)
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
      setIsRouteLoading(false)
    }
  }, [driver?.id])

  // Первая загрузка — сразу, как только сессия водителя известна. Опрос
  // стартует вместе с экраном, когда driver ещё null, поэтому без этого
  // эффекта главная /m висела на загрузчике до первого тика таймера (30 с).
  useEffect(() => {
    if (!driver?.id) return
    void fetchData()
  }, [driver?.id, fetchData])

  // Опрос данных рейса: адаптивный. Таймеры на экране тикают сами, сервер
  // нужен только для новых точек, догрузов и норм отдыха — поэтому интервал
  // побольше, а в скрытой вкладке и без сети опрос выключен совсем.
  const dataPolling = useAdaptivePolling(
    () => {
      if (!isAuthenticated || !driver?.id) return
      return fetchData()
    },
    { baseMs: 30_000, maxMs: 120_000 },
  )

  // ── GPS ────────────────────────────────────────────────────────────────
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
    [driver?.id],
  )

  const handleGpsError = useCallback((error: GeolocationPositionError) => {
    console.error("[GPS] Error:", error.message)

    // Отказ в доступе — не ошибка связи: подсказка постоянная, внутри плашки
    // (см. GPS_LABELS), чтобы водитель всегда видел, что делать.
    if (error.code === error.PERMISSION_DENIED) {
      setGpsStatus("denied")
      return
    }

    setGpsStatus("error")
  }, [])

  useEffect(() => {
    // Условие ОТПРАВКИ не меняем — меняем только то, что видит водитель.
    if (!shift || !driver?.id || !hasActiveTrip) {
      setGpsStatus(!shift || !driver?.id ? "inactive" : "no_trip")
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

    watchIdRef.current = navigator.geolocation.watchPosition(sendLocation, handleGpsError, {
      enableHighAccuracy: true,
      maximumAge: 30000,
    })

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
  }, [shift, driver?.id, hasActiveTrip, sendLocation, handleGpsError])

  // ── Смена ──────────────────────────────────────────────────────────────
  const startShift = async () => {
    if (!driver?.id) {
      toast.error("Не удалось начать смену", { description: "Профиль водителя не загрузился — обновите экран" })
      return
    }
    setIsChangingStatus(true)

    try {
      const res = await fetch("/api/m/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverId: driver.id, action: "start" }),
      })

      const data = await res.json()
      if (data.success) {
        applyShiftResponse(data)
        toast.success("Смена начата", { description: "Хорошего рабочего дня!" })
        if (navigator.vibrate) navigator.vibrate(100)
      } else {
        toast.error("Ошибка запуска смены", {
          description: data.error || "Не удалось начать смену",
        })
      }
    } catch {
      toast.error("Ошибка связи", { description: "Проверьте подключение к интернету" })
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
        body: JSON.stringify({ driverId: driver.id, action: "end" }),
      })

      const data = await res.json()
      if (data.success) {
        setShift(null)
        setStatusSeconds(0)
        setTotals(emptyTotals())
        setRoutePoints([])
        toast.success("Смена завершена", { description: "Отдыхайте!" })
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

  /** Ответ роута смены сразу отражаем на экране: не ждём следующего опроса. */
  const applyShiftResponse = (data: any) => {
    if (data.shift) {
      setShift({
        id: data.shift.id,
        status: data.shift.status,
        startedAt: data.shift.startedAt,
        lastStatusChangeAt: data.shift.lastStatusChangeAt,
      })
      setStatusSeconds(data.statusSeconds ?? 0)
    }
    if (data.totals) setTotals(data.totals)
    if (data.rest) setRest(data.rest)
  }

  // ── Статусы рейса ──────────────────────────────────────────────────────
  const changeStatus = async (statusId: string) => {
    if (!driver?.id || !shift) return

    // Завершение перерыва: возвращаемся к тому, чем занимались до него
    const target = statusId === "__rest_end__" ? returnAfterRest : statusId
    const isRest = target === "resting" || target === "sleeping"
    if (isRest) setReturnAfterRest(shift.status)

    setIsChangingStatus(true)

    try {
      // Координаты — чтобы в журнале было видно, где сменился статус
      let latitude: number | undefined
      let longitude: number | undefined
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 })
        })
        latitude = pos.coords.latitude
        longitude = pos.coords.longitude
      } catch {
        // Геолокация не обязательна: статус важнее координат
      }

      const res = await fetch("/api/m/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: driver.id,
          action: "status",
          status: target,
          orderId: activeOrder?.id ?? null,
          latitude,
          longitude,
        }),
      })

      const data = await res.json()
      if (!data.success) {
        toast.error("Не удалось сменить статус", { description: data.error })
        return
      }

      applyShiftResponse(data)

      // Этап заказа: погрузка, путь и выгрузка означают «контроль» —
      // деталь живёт в статусе смены, а не в заказе.
      const orderStatus = ORDER_STATUS_FOR_TRIP[target]
      if (activeOrder?.id && orderStatus && activeOrder.status !== orderStatus) {
        try {
          await fetch(`/api/m/orders/${activeOrder.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: orderStatus }),
          })
        } catch (error) {
          console.error("[Mobile] Failed to update order status", error)
        }
      }

      // Подсказки про фото: чек на заправке и фото груза на погрузке/выгрузке
      if (target === "loading") {
        toast("📦 Погрузка", {
          description: "Сфотографируйте груз — фото уйдёт в отчёт",
          action: { label: "Камера", onClick: () => router.push("/m/photo?context=loading") },
        })
      } else if (target === "unloading") {
        toast("✅ Выгрузка", {
          description: "Сфотографируйте груз после выгрузки",
          action: { label: "Камера", onClick: () => router.push("/m/photo?context=unloading") },
        })
      } else if (target === "fueling") {
        toast("⛽ Заправка", {
          description: "Сохраните чек",
          action: {
            label: "Фото чека",
            onClick: () => router.push("/m/photo?context=fueling"),
          },
        })
      } else if (target === "resting" || target === "sleeping") {
        toast.success("Отдых начат", {
          description: "Таймер отдыха идёт, время за рулём обнулится",
        })
      } else if (target === "driving" && statusId === "__rest_end__") {
        toast.success("Отдых завершён", { description: "Хорошего пути!" })
      } else if (data.seconds) {
        toast.success(`${shiftStatusLabel(shift.status)}: ${Math.round(data.seconds / 60)} мин`, {
          description: "Время записано в отчёт",
        })
      }

      if (navigator.vibrate) navigator.vibrate(50)
      void fetchData()
    } catch {
      toast.error("Ошибка связи")
    } finally {
      setIsChangingStatus(false)
    }
  }

  // ── Принять назначенный рейс ───────────────────────────────────────────
  const acceptTrip = async () => {
    if (!activeOrder) {
      // Раньше кнопка молча ничего не делала: экран показывал «Вам назначен
      // рейс», а в данных открытых точек уже не было.
      toast.info("Этот рейс уже выполнен", { description: "Ждите новое задание — оно придёт уведомлением" })
      return
    }
    if (!driver?.id) {
      toast.error("Не удалось начать рейс", { description: "Профиль водителя не загрузился — обновите экран" })
      return
    }
    setIsChangingStatus(true)

    try {
      const res = await fetch(`/api/m/orders/${activeOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "control" }),
      })

      const data = await res.json()
      if (data.success) {
        // Принятый рейс сразу переводит смену в «в пути»
        const statusRes = await fetch("/api/m/shift", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driverId: driver.id,
            action: "status",
            status: "driving",
            orderId: activeOrder.id,
          }),
        })
        const statusData = await statusRes.json()
        if (statusData.success) applyShiftResponse(statusData)

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
        await fetchData()
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

  // ── На базу ────────────────────────────────────────────────────────────
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

  // ── Завершение рейса ───────────────────────────────────────────────────
  const completeRoute = async () => {
    if (!activeOrder?.routeId || !driver?.id) return

    const pendingCount = routePoints.filter((point) => !isOrderClosed(point.status)).length

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
        body: JSON.stringify({ driverId: driver.id, force: true }),
      })

      const data = await res.json()
      if (data.success) {
        setRoutePoints([])
        toast.success("Рейс завершён!", {
          description: `${data.stats.ordersCount} точек, ${data.stats.totalRevenue.toLocaleString()}₽`,
        })
        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100])

        // После рейса водитель снова «ожидает рейс»: иначе таймер выгрузки
        // продолжал бы тикать и портил бы аналитику простоев.
        await changeStatus("waiting")
        await fetchData()
      } else {
        toast.error("Ошибка завершения рейса", { description: data.error })
      }
    } catch {
      toast.error("Ошибка связи")
    } finally {
      setCompletingRoute(false)
    }
  }

  // ── Догрузы ────────────────────────────────────────────────────────────
  const handleLoadProposal = async (orderId: string, accept: boolean, reason?: string) => {
    try {
      const res = await fetch("/api/m/route/accept-load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, driverId: driver?.id, accept, rejectionReason: reason }),
      })

      const data = await res.json()
      if (data.success) {
        setProposedLoads((prev) => prev.filter((load) => load.id !== orderId))
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
        body: JSON.stringify({ maintenanceId: activeMaintenance.id, driverId: driver.id }),
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

  // ── Состояния экрана ───────────────────────────────────────────────────
  if (isSessionLoading || isDataLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <TruckLoader className="text-orange-500" />
      </div>
    )
  }

  if (!isAuthenticated || !driver) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <TruckLoader className="text-orange-500" />
      </div>
    )
  }

  const isOnMaintenance = activeMaintenance !== null
  const statusId = shift?.status ?? "waiting"

  return (
    <div className={`min-h-screen bg-[#09090b] text-white ${shift && !isOnMaintenance ? "m-nav-pad-sos" : "m-nav-pad"}`}>
      <FirstLoginGuide />

      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3">
          {/* Шапка в две строки: имя и машина сверху, служебные чипы снизу.
              В одну строку имя обрезалось до «Кузнец…», а госномер — до
              «В108МК799 • …»: чипы занимали больше места, чем данные. */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-bold leading-tight">{shortPersonName(driver.name)}</h1>
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {driver.vehiclePlate || "Нет ТС"}
                {driver.vehicleType && ` • ${driver.vehicleType}`}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <DriverNotificationsBell driverId={driver.id} />
              <DriverChatButton />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <div
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                gpsStatus === "active"
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : gpsStatus === "denied" || gpsStatus === "error"
                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                    : gpsStatus === "searching"
                      ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                      : "bg-gray-500/20 text-gray-400 border border-gray-500/30"
              }`}
              title={
                gpsStatus === "denied"
                  ? "Разрешите доступ к геолокации в настройках браузера для этого сайта"
                  : gpsStatus === "no_trip"
                    ? "Рейс не начат — координаты не отправляются, пока нет задания"
                    : undefined
              }
            >
              {gpsStatus === "active" && <Wifi className="h-3 w-3" />}
              {gpsStatus === "searching" && <Locate className="h-3 w-3 animate-pulse" />}
              {(gpsStatus === "denied" || gpsStatus === "error" || gpsStatus === "inactive" || gpsStatus === "no_trip") && (
                <WifiOff className="h-3 w-3" />
              )}
              <span>{GPS_LABELS[gpsStatus]}</span>
            </div>

            {!isOnline && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30"
                title="Нет связи: действия отправятся, когда сеть вернётся"
              >
                <WifiOff className="h-3 w-3" />
                Офлайн
              </span>
            )}

            {pendingPhotos > 0 && (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium bg-sky-500/20 text-sky-400 border border-sky-500/30"
                title="Фото ждут отправки и уйдут сами"
              >
                <Camera className="h-3 w-3" />
                {pendingPhotos}
              </span>
            )}
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
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-amber-400" />
              <span className="font-semibold text-amber-300">Машина на ТО</span>
            </div>
            <p className="text-sm text-gray-300">{activeMaintenance.description || activeMaintenance.type}</p>
            <p className="text-xs text-gray-500">
              Начато:{" "}
              {new Date(activeMaintenance.startedAt).toLocaleString("ru-RU", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
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
            {routePoints.length > 0 && activeOrder && (
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
            {/* ── Пульт: чем занят, сколько длится, где в рейсе ── */}
            <ControlPanel
              status={statusId}
              statusSeconds={statusSeconds}
              totals={totals}
              hasActiveTrip={hasActiveTrip}
              tripFinished={tripFinished}
              closedPoints={closedPoints}
              totalPoints={routePoints.length}
            />

            {/* ── Назначенный, но не начатый рейс ── */}
            {hasActiveTrip && routePoints.length > 0 && (
              <div className="rounded-2xl border border-orange-500/40 bg-orange-500/10 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-orange-400" />
                  <span className="font-semibold text-orange-300">Вам назначен рейс</span>
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {routePoints[0].routeFrom} → {routePoints[routePoints.length - 1].routeTo}
                  </p>
                  <p className="text-xs text-gray-400">
                    Точек в рейсе: {routePoints.length}
                    {routePoints[0].cargoType && ` • ${routePoints[0].cargoType}`}
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

            {/* ── Рейс выполнен: открытых точек нет ── */}
            {tripFinished && (
              <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                  <span className="font-semibold text-green-300">Рейс выполнен</span>
                </div>
                <p className="text-sm text-gray-300">
                  {routePoints[0].routeFrom} → {routePoints[routePoints.length - 1].routeTo}
                </p>
                <p className="text-xs text-gray-500">
                  Все точки закрыты ({routePoints.length}). Логист назначит следующее задание — оно придёт уведомлением.
                </p>
              </div>
            )}

            {/* Рейс ещё грузится: не показываем «задания нет» раньше времени */}
            {isRouteLoading && routePoints.length === 0 && (
              <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
                <p className="flex items-center gap-2 text-sm text-gray-400">
                  Загружаем данные рейса…
                </p>
              </div>
            )}

            {/* ── Кнопки состояний: пишут время в отчёт ── */}
            <ActionGrid
              status={statusId}
              statusSeconds={statusSeconds}
              hasActiveTrip={hasActiveTrip}
              currentPointIsAdditional={activeOrder?.isAdditionalLoad}
              resting={Boolean(rest?.resting)}
              currentBreakMin={rest?.currentBreakMin ?? 0}
              breakCounts={Boolean(rest?.breakCounts)}
              minBreakMin={rest?.minBreakMin ?? 45}
              disabled={isChangingStatus}
              onSelect={(status) => void changeStatus(status)}
              onPhoto={(context) => router.push(`/m/photo?context=${context}`)}
              onMaintenance={() => router.push("/m/maintenance")}
            />

            {/* ── Нормы отдыха ── */}
            {rest && (
              <RestCard
                resting={rest.resting}
                restDue={rest.restDue}
                drivingMinutes={rest.drivingMinutes}
                minutesToRest={rest.minutesToRest}
                currentBreakMin={rest.currentBreakMin}
                breakCounts={rest.breakCounts}
                limitMin={rest.limitMin}
                minBreakMin={rest.minBreakMin}
              />
            )}

            {/* ── Активный рейс: этап, кнопки и прогноз ── */}
            {activeOrder?.routeId && (
              <TripStagePanel
                routeId={activeOrder.routeId}
                trip={trip}
                onRefresh={fetchData}
              />
            )}

            {/* ── Точки рейса ── */}
            {routePoints.length > 0 && (
              <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <MapPin className="h-4 w-4 shrink-0 text-orange-400" />
                    <span className="truncate text-sm font-medium">Точки рейса</span>
                  </div>
                  <span className="shrink-0 text-xs text-gray-500">Выполнено {routeProgress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
                  <div
                    className="h-full rounded-full bg-orange-500 transition-all"
                    style={{ width: `${routeProgress}%` }}
                  />
                </div>
                <div className="space-y-1">
                  {routePoints.map((point, index) => {
                    const closed = isOrderClosed(point.status)
                    const isCurrent = point.id === activeOrder?.id
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
                            {index + 1}. {point.routeFrom} → {point.routeTo}
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
            )}

            {/* ── Ожидаю рейс: смена открыта, задания нет ── */}
            {!hasActiveTrip && routePoints.length === 0 && !isRouteLoading && (
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
                <p className="flex items-start gap-1.5 text-xs text-gray-500">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Время ожидания тоже пишется в отчёт — просто держите статус «Ожидаю рейс»
                </p>
              </div>
            )}

            {/* ── Завершение рейса ── */}
            {hasActiveTrip && activeOrder?.routeId && (
              <button
                type="button"
                onClick={completeRoute}
                disabled={completingRoute}
                className="flex w-full min-h-[52px] items-center justify-center gap-2 rounded-xl bg-green-600 font-semibold text-white active:opacity-80 disabled:opacity-50"
              >
                <Flag className="h-5 w-5" />
                {completingRoute ? "Завершаем..." : "Завершить рейс"}
              </button>
            )}

            {/* ── Пуши: рейс и догруз должны доходить со свёрнутым приложением ── */}
            <DriverPushCard />

            {/* ── Общие действия смены ── */}
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

            {!isOnline && (
              <p className="flex items-start gap-1.5 text-xs text-amber-400/80">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Нет связи: фото копятся в очереди и уйдут сами, а смену статуса нужно
                повторить, когда сеть вернётся.
              </p>
            )}
          </>
        )}
      </main>

      {shift && !isOnMaintenance && <SosButton orderId={activeOrder?.id} />}

      <BottomNav />
    </div>
  )
}
