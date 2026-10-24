// app/lm/routes/assistant/page.tsx — помощник сборки: МАРШРУТ из грузов биржи.
//
// Экран работает так, как работает реальный логист на бирже ATI:
//
//   1. «Куда едем» — город, где стоит машина (база). Выбираешь машину.
//   2. Жмёшь «Построить маршрут» — помощник идёт по грузам и складывает
//      цепочку: база → город → город → домой. Каждое плечо окупается,
//      убыточные маршруты он не предлагает.
//   3. «Маршрут собран» — видно все плечи, деньги и компании. Звонишь
//      фрахтователям и отмечаешь: согласовано / отказ.
//   4. Отказали — «Заменить груз» или «Убрать из маршрута», маршрут
//      пересобирается, согласованные грузы остаются.
//   5. Всё созвонил — «Отправить машину»: грузы становятся заказами,
//      создаётся рейс с машиной и водителем, водителю уходит уведомление.
//
// Всё сложное — под катом: «что осталось на бирже» и «почему так собрал».

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  Route as RouteIcon,
  Truck,
  X,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import {
  buildRoute,
  routeSummaryLine,
  type BuilderLoad,
  type BuilderVehicle,
  type BuiltRoute,
} from "@/lib/logist-mobile/route-builder"
import { normalizeCityKey } from "@/lib/logist-mobile/city-norm"
import { type MobileDriver } from "@/lib/logist-mobile/types"
import { formatMoney, formatWeightKg, shortCity, telHref } from "@/lib/logist-mobile/format"

/** Статус договорённости с фрахтователем по конкретному грузу. */
type CallStatus = "pending" | "agreed" | "declined"

/** Шаги анимации построения маршрута. */
const BUILD_STEPS = [
  "Ищем грузы с биржи…",
  "Складываем цепочку плеч…",
  "Считаем деньги по каждому плечу…",
  "Проверяем, что маршрут в плюс…",
]

const START_CITY_KEY = "assistant-start-city"

export default function RouteAssistantPage() {
  const router = useRouter()
  const { user } = useStaffSession()

  const loadsState = useJsonApi<{
    items: Array<{
      id: string
      atiLoadId: string
      routeFrom: string
      routeTo: string
      distance: number | null
      weight: number | null
      volume: number | null
      cargoType: string | null
      price: number | null
      vatIncluded: boolean
      loadingDate: string | null
      firmName: string | null
      contactPhone: string | null
      status: string
      fromPoint: { lat: number; lng: number } | null
      toPoint: { lat: number; lng: number } | null
    }>
    refreshError: string | null
    stale: boolean
  }>(user ? "/api/ati/loads?status=new&limit=100" : null)

  const vehiclesState = useJsonApi<{ vehicles: BuilderVehicle[] }>(user ? "/api/vehicles" : null)
  const driversState = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)

  // ── Состояние помощника ──
  const [startCity, setStartCity] = useState("")
  const [vehicleId, setVehicleId] = useState("")
  /** Радиус «по пути», км: груз рядом с маршрутом тоже берём */
  const [detourKm, setDetourKm] = useState(150)
  const [phase, setPhase] = useState<"setup" | "building" | "route" | "sending">("setup")
  const [buildStep, setBuildStep] = useState(0)
  const [route, setRoute] = useState<BuiltRoute | null>(null)
  /** Договорённости по грузам: позвонил → согласовано / отказ */
  const [calls, setCalls] = useState<Record<string, CallStatus>>({})
  /** Согласованные звонком грузы — пересборка их сохраняет */
  const [keepIds, setKeepIds] = useState<string[]>([])
  /** Грузы, которые убираем: отказались или логист исключил */
  const [excludeIds, setExcludeIds] = useState<string[]>([])
  const [refreshing, setRefreshing] = useState(false)
  /** Телефоны фрахтователей, добытые кнопкой «Узнать телефон» */
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [phoneBusy, setPhoneBusy] = useState<string | null>(null)

  // Город старта помним: логист обычно едет из одной базы
  useEffect(() => {
    const saved = window.localStorage.getItem(START_CITY_KEY)
    if (saved) setStartCity(saved)
  }, [])

  // Биржа обновляется в фоне: скан ATI занимает больше минуты, и экран не
  // должен из-за него висеть. Сервер помечает кэш «stale» — дёргаем POST
  // и перечитываем список, когда он уже показан.
  const [autoRefresh, setAutoRefresh] = useState(false)
  useEffect(() => {
    if (!loadsState.data?.stale || autoRefresh) return
    setAutoRefresh(true)
    void apiSend<{ count?: number }>("/api/ati/loads", "POST").then((result) => {
      loadsState.reload()
      if (result.ok) toast.success("Биржа обновлена")
    })
  }, [loadsState.data, autoRefresh, loadsState])

  const loads = useMemo<BuilderLoad[]>(
    () =>
      (loadsState.data?.items ?? []).map((row) => ({
        id: row.id,
        loadId: row.atiLoadId,
        fromCity: row.routeFrom,
        toCity: row.routeTo,
        weightKg: row.weight,
        volumeM3: row.volume,
        cargoType: row.cargoType,
        priceRub: row.price,
        priceWithNds: row.vatIncluded ? row.price : null,
        distanceKm: row.distance,
        firmName: row.firmName,
        contactPhone: row.contactPhone,
        loadingDate: row.loadingDate,
        status: row.status,
        // Точные координаты точки погрузки/выгрузки из груза ATI —
        // приоритетнее центра города из геокодера
        fromPoint: row.fromPoint ?? null,
        toPoint: row.toPoint ?? null,
      })),
    [loadsState.data],
  )
  const vehicles = useMemo<BuilderVehicle[]>(() => {
    // У машин часто не заполнен паспортный расход — прибыль тогда нечем
    // считать. Подставляем оценку по типу кузова и честно помечаем это в
    // «Почему собрал так»: точные литры появятся, когда расход заполнят.
    const rows = vehiclesState.data?.vehicles ?? []
    return rows.map((vehicle) => {
      if (vehicle.fuelConsumptionPer100 && vehicle.fuelConsumptionPer100 > 0) return vehicle
      const type = (vehicle.type ?? "").toLowerCase()
      const estimate = /газел|малый|малотон|микро/.test(type)
        ? 18
        : /фур|полуфур|тент|рефриж|изотерм|борт/.test(type)
          ? 30
          : 24
      return { ...vehicle, fuelConsumptionPer100: estimate, fuelEstimated: true }
    })
  }, [vehiclesState.data])

  const drivers = driversState.data?.drivers ?? []

  const loading = loadsState.loading || vehiclesState.loading
  const error = loadsState.error || vehiclesState.error

  const freeVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "available"),
    [vehicles],
  )

  /** Грузы, которые вообще могут поехать: свежие, со ставкой, известный маршрут. */
  const usableLoads = useMemo(
    () =>
      loads.filter(
        (load) =>
          load.status === "new" &&
          (load.priceWithNds ?? load.priceRub ?? 0) > 0 &&
          shortCity(load.fromCity) !== "—" &&
          shortCity(load.toCity) !== "—",
      ),
    [loads],
  )

  /** Города погрузки на бирже — быстрый выбор базы, если своей нет в списке. */
  const topFromCities = useMemo(() => {
    const counts = new Map<string, number>()
    for (const load of usableLoads) {
      const city = shortCity(load.fromCity)
      counts.set(city, (counts.get(city) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [usableLoads])

  // ── Координаты городов биржи: нужны, чтобы брать грузы «по пути» ──
  // Без них цепочка строится только по точному совпадению городов, а на
  // бирже один город пишут по-разному и «стыков» мало — маршрут оборвётся
  // на одном плече. Точки тянем один раз на все города грузов.
  const pointsQuery = useMemo(() => {
    const cities = new Set<string>()
    for (const load of usableLoads) {
      cities.add(shortCity(load.fromCity))
      cities.add(shortCity(load.toCity))
    }
    return [...cities].slice(0, 40).join(",")
  }, [usableLoads])

  const pointsState = useJsonApi<{ points: Record<string, { lat: number; lng: number } | null> }>(
    user && pointsQuery ? `/api/ati/cities/points?cities=${encodeURIComponent(pointsQuery)}` : null,
  )
  const cityPoints = pointsState.data?.points ?? null

  /** Грузы с координатами городов — билдер умеет брать «по пути». */
  const loadsWithPoints = useMemo<BuilderLoad[]>(() => {
    if (!cityPoints) return loads
    return loads.map((load) => ({
      ...load,
      fromPoint: load.fromPoint ?? cityPoints[normalizeCityKey(shortCity(load.fromCity))] ?? null,
      toPoint: load.toPoint ?? cityPoints[normalizeCityKey(shortCity(load.toCity))] ?? null,
    }))
  }, [loads, cityPoints])

  const startPoint = useMemo(
    () => (cityPoints && startCity ? cityPoints[normalizeCityKey(shortCity(startCity))] ?? null : null),
    [cityPoints, startCity],
  )

  // ── Построение маршрута ──
  // Таймер анимации живёт в ref: если логист ушёл с экрана mid-анимации,
  // интервал гасится — иначе он стучится в размонтированный компонент.
  const buildTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (buildTimer.current !== null) window.clearInterval(buildTimer.current)
  }, [])

  function runBuild(start: string, keep: string[], exclude: string[]) {
    if (!start.trim()) {
      toast.error("Укажите город, откуда едете")
      return
    }
    setPhase("building")
    setBuildStep(0)

    // Анимация построения: шаги с задержкой, затем результат
    let step = 0
    const tick = window.setInterval(() => {
      step += 1
      if (step < BUILD_STEPS.length) {
        setBuildStep(step)
        return
      }
      window.clearInterval(tick)
      buildTimer.current = null
      const built = buildRoute({
        startCity: start.trim(),
        loads: loadsWithPoints,
        vehicles,
        fuelPriceRubPerL: 62,
        keepIds: keep,
        excludeIds: exclude,
        detourKm,
        startPoint,
      })
      setRoute(built)
      setPhase("route")
      if (!built) {
        toast.error("Из этого города не собралось ни одного окупаемого плеча")
      }
    }, 550)
    buildTimer.current = tick
  }

  function refreshAll() {
    setRefreshing(true)
    loadsState.reload()
    vehiclesState.reload()
    driversState.reload()
    window.setTimeout(() => {
      setRefreshing(false)
      toast.success("Данные обновлены")
      // Маршрут уже построен — пересобираем на свежих грузах, иначе он
      // показывает вчерашнюю биржу
      if (route) runBuild(startCity, keepIds, excludeIds)
    }, 800)
  }

  /** «Узнать телефон»: ATI отдаёт контакт фрахтователя отдельным запросом. */
  async function fetchPhone(loadId: string) {
    setPhoneBusy(loadId)
    try {
      const result = await apiSend<{ phone: string | null; name: string | null }>(
        "/api/ati/loads/contacts",
        "POST",
        { cacheId: loadId },
      )
      if (result.ok && result.data?.phone) {
        setPhones((prev) => ({ ...prev, [loadId]: result.data?.phone as string }))
        loadsState.reload()
        toast.success(`Фрахтователь: ${result.data.phone}`)
      } else {
        toast.error(result.error ?? "Телефон не найден")
      }
    } catch {
      toast.error("Не удалось получить телефон")
    } finally {
      setPhoneBusy(null)
    }
  }

  /** Отказ фрахтователя: убираем груз и пересобираем, согласованные остаются. */
  function declineLoad(loadId: string) {    setCalls((prev) => ({ ...prev, [loadId]: "declined" }))
    const keep = keepIds.filter((id) => id !== loadId)
    const exclude = [...excludeIds, loadId]
    setKeepIds(keep)
    setExcludeIds(exclude)
    runBuild(startCity, keep, exclude)
    toast("Груз убран — пересобираю маршрут")
  }

  /** Убрать груз из маршрута без статуса отказа. */
  function removeLoad(loadId: string) {
    const keep = keepIds.filter((id) => id !== loadId)
    const exclude = [...excludeIds, loadId]
    setKeepIds(keep)
    setExcludeIds(exclude)
    runBuild(startCity, keep, exclude)
  }

  function markCall(loadId: string, status: CallStatus) {
    setCalls((prev) => ({ ...prev, [loadId]: status }))
    if (status === "agreed" && !keepIds.includes(loadId)) {
      const keep = [...keepIds, loadId]
      setKeepIds(keep)
      setRoute((current) => {
        if (!current) return current
        return {
          ...current,
          reasons: [
            ...current.reasons.filter((reason) => !reason.startsWith("Согласованные грузы")),
            `Согласованные грузы сохранены: ${current.legs.filter((leg) => keep.includes(leg.load.id)).length}`,
          ],
        }
      })
    }
    if (status === "declined") {
      declineLoad(loadId)
    }
  }

  /** Отправить машину: грузы → заказы → рейс с экипажем. */
  async function sendRoute() {
    if (!route) return
    setPhase("sending")
    try {
      const vehicle =
        vehicles.find((item) => item.id === vehicleId) ?? route.vehicle ?? null
      const driver = vehicle
        ? drivers.find((item) => item.vehicleId === vehicle.id) ??
          drivers.find((item) => item.status === "available") ??
          null
        : null

      // 1. Каждый груз биржи становится нашим заказом (этап «Поиск»)
      const orderIds: string[] = []
      for (const leg of route.legs) {
        const result = await apiSend<{
          order: { id: string }
          code?: string
        }>("/api/orders/from-cache", "POST", {
          cacheId: leg.load.id,
          fetchContacts: true,
        })
        if (result.ok && result.data?.order) {
          orderIds.push(result.data.order.id)
        } else if (result.data?.code === "already_taken" && result.data?.order?.id) {
          // Груз уже взят в работу раньше (например, с экрана биржи) —
          // используем тот заказ, дубликат не нужен
          orderIds.push(result.data.order.id)
        } else {
          toast.error(result.error ?? `Не удалось взять груз ${shortCity(leg.load.fromCity)} → ${shortCity(leg.load.toCity)}`)
          setPhase("route")
          return
        }
      }

      // 2. Рейс: заказы + машина + водитель
      const created = await apiSend<{ route: { id: string } }>("/api/routes", "POST", {
        orderIds,
        vehicleId: vehicle?.id ?? null,
        driverId: driver?.id ?? null,
        name: `Маршрут: ${route.path.join(" → ")}`,
      })
      if (created.ok && created.data?.route) {
        toast.success(driver ? "Машина в пути — водителю ушло уведомление" : "Рейс создан — назначьте водителя")
        router.push(`/lm/routes/${created.data.route.id}`)
      } else {
        toast.error(created.error ?? "Не удалось создать рейс")
        setPhase("route")
      }
    } catch {
      toast.error("Не удалось отправить машину")
      setPhase("route")
    }
  }

  // ═══════════════ Экран ═══════════════
  return (
    <>
      <LogistHeader
        title="Сборка маршрута"
        subtitle="Грузы биржи → цепочка → машина в пути"
        back
        userName={user?.name}
        action={
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            aria-label="Обновить"
            className="flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 active:bg-secondary/60 disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        }
      />

      <div className="px-4 pt-4 pb-8">
        {error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              loadsState.reload()
              vehiclesState.reload()
            }}
          />
        ) : loading ? (
          <ListSkeleton rows={3} />
        ) : phase === "setup" ? (
          <SetupPhase
            startCity={startCity}
            setStartCity={(value) => {
              setStartCity(value)
              window.localStorage.setItem(START_CITY_KEY, value)
            }}
            topFromCities={topFromCities}
            vehicles={freeVehicles}
            allVehiclesBusy={freeVehicles.length === 0 && vehicles.length > 0}
            vehicleId={vehicleId}
            setVehicleId={setVehicleId}
            drivers={drivers}
            usableLoadsCount={usableLoads.length}
            detourKm={detourKm}
            setDetourKm={setDetourKm}
            pointsLoading={pointsState.loading}
            noStartPoint={cityPoints !== null && startCity.trim().length > 0 && !startPoint}
            onBuild={() => runBuild(startCity, keepIds, excludeIds)}
          />
        ) : phase === "building" ? (
          <BuildingPhase step={buildStep} />
        ) : route ? (
          <RoutePhase
            route={route}
            calls={calls}
            keepIds={keepIds}
            phones={phones}
            phoneBusy={phoneBusy}
            onFetchPhone={(loadId) => void fetchPhone(loadId)}
            onCall={markCall}
            onRemove={removeLoad}
            onRebuild={() => {
              setCalls({})
              setKeepIds([])
              setExcludeIds([])
              runBuild(startCity, [], [])
            }}
            onBack={() => setPhase("setup")}
            onSend={() => void sendRoute()}
            sending={phase === "sending"}
          />
        ) : (
          <EmptyState
            icon={<RouteIcon className="h-6 w-6" />}
            title="Маршрут не собрался"
            description="Из этого города не нашлось окупаемых плеч. Попробуйте другой город или нажмите «Обновить» — возможно, биржа обновилась."
            action={
              <button
                type="button"
                onClick={() => setPhase("setup")}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-4 text-[14px] font-medium text-foreground active:opacity-70"
              >
                Другой город
              </button>
            }
          />
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Шаг 1. Куда едем
// ---------------------------------------------------------------------------

function SetupPhase({
  startCity,
  setStartCity,
  topFromCities,
  vehicles,
  allVehiclesBusy,
  vehicleId,
  setVehicleId,
  drivers,
  usableLoadsCount,
  detourKm,
  setDetourKm,
  pointsLoading,
  noStartPoint,
  onBuild,
}: {
  startCity: string
  setStartCity: (value: string) => void
  topFromCities: Array<[string, number]>
  vehicles: BuilderVehicle[]
  allVehiclesBusy: boolean
  vehicleId: string
  setVehicleId: (value: string) => void
  drivers: MobileDriver[]
  usableLoadsCount: number
  detourKm: number
  setDetourKm: (value: number) => void
  /** Точки городов ещё считаются — «по пути» пока не работает */
  pointsLoading: boolean
  /** Для выбранного города нет координат — только точное совпадение городов */
  noStartPoint: boolean
  onBuild: () => void
}) {
  const selected = vehicles.find((vehicle) => vehicle.id === vehicleId) ?? vehicles[0] ?? null
  const driver = selected ? drivers.find((item) => item.vehicleId === selected.id) ?? null : null

  return (
    <div className="space-y-5">
      {/* Откуда едем */}
      <Card>
        <label className="block text-[13px] font-medium text-foreground">
          Откуда едете (база или город машины)
        </label>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-background px-3">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={startCity}
            onChange={(event) => setStartCity(event.target.value)}
            placeholder="Например: Коломна"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
        </div>

        {pointsLoading ? (
          <p className="mt-2 text-[12px] text-muted-foreground">Считаю расстояния между городами биржи…</p>
        ) : noStartPoint ? (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            Для этого города нет точных координат — маршрут соберём только по точному совпадению
            городов. Укажите ближайший крупный город, чтобы работали грузы «по пути».
          </p>
        ) : null}

        {topFromCities.length > 0 ? (
          <div className="mt-2.5">
            <p className="text-[12px] text-muted-foreground">Города погрузки на бирже:</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {topFromCities.map(([city, count]) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => setStartCity(city)}
                  className={`min-h-[34px] rounded-md border px-3 text-[12.5px] active:opacity-70 ${
                    startCity === city
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border text-foreground/90"
                  }`}
                >
                  {city} · {count}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {/* Машина */}
      <Card>
        <p className="text-[13px] font-medium text-foreground">Машина</p>
        {vehicles.length === 0 ? (
          <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
            {allVehiclesBusy
              ? "Все машины заняты или на ТО. Маршрут всё равно можно построить — машину назначите позже."
              : "Свободных машин нет. Маршрут всё равно можно построить — машину назначите позже."}
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {vehicles.map((vehicle) => {
              const active = (vehicleId || vehicles[0]?.id) === vehicle.id
              const vehicleDriver = drivers.find((item) => item.vehicleId === vehicle.id) ?? null
              return (
                <button
                  key={vehicle.id}
                  type="button"
                  onClick={() => setVehicleId(vehicle.id)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left active:opacity-70 ${
                    active ? "border-primary/40 bg-primary/10" : "border-border"
                  }`}
                >
                  <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-foreground">{vehicle.plate}</span>
                    <span className="mt-0.5 block text-[12px] text-muted-foreground">
                      {vehicle.type ?? "машина"}
                      {vehicle.capacity ? ` · ${formatWeightKg(vehicle.capacity)}` : ""}
                      {vehicleDriver ? ` · ${vehicleDriver.name}` : " · водитель не закреплён"}
                    </span>
                  </span>
                  {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
              )
            })}
          </div>
        )}
        {selected && !driver ? (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            За {selected.plate} не закреплён водитель — при отправке назначим свободного.
          </p>
        ) : null}
      </Card>

      {/* Насколько далеко от маршрута брать грузы */}
      <Card>
        <p className="text-[13px] font-medium text-foreground">Грузы «по пути»</p>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          Берём груз из вашего города и из городов рядом с маршрутом — так цепочка не обрывается на одном плече.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[50, 100, 150, 300].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDetourKm(value)}
              className={`min-h-[34px] rounded-md border px-3 text-[12.5px] active:opacity-70 ${
                detourKm === value
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border text-foreground/90"
              }`}
            >
              {value} км
            </button>
          ))}
        </div>
      </Card>

      {/* Что будет */}
      <Card className="border-primary/25 bg-primary/[0.06]">
        <p className="text-[13px] text-muted-foreground">
          Помощник пройдёт по {usableLoadsCount} грузам биржи и сложит цепочку: из вашего города —
          в соседний, оттуда — дальше, и обратно домой с грузом. Убыточные плеча не берёт.
        </p>
        <button
          type="button"
          onClick={onBuild}
          disabled={usableLoadsCount === 0}
          className="mt-3 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
        >
          <RouteIcon className="h-5 w-5" />
          Построить маршрут
        </button>
        {usableLoadsCount === 0 ? (
          <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
            Свежих грузов на бирже нет. Нажмите «Обновить» в шапке — подтянем новые с ATI.
          </p>
        ) : null}
        <Link
          href="/lm/search"
          className="mt-3 flex min-h-[40px] items-center justify-center gap-1.5 text-[13px] font-medium text-primary active:opacity-70"
        >
          <Package className="h-4 w-4" />
          Открыть биржу грузов
        </Link>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Шаг 2. Анимация построения
// ---------------------------------------------------------------------------

function BuildingPhase({ step }: { step: number }) {
  return (
    <div className="pt-10">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
        <RouteIcon className="h-8 w-8 animate-pulse text-primary" />
      </div>
      <p className="mt-4 text-center text-[16px] font-semibold text-foreground">Строим маршрут</p>
      <ul className="mx-auto mt-5 max-w-[280px] space-y-2.5">
        {BUILD_STEPS.map((text, index) => {
          const done = index < step
          const active = index === step
          return (
            <li
              key={text}
              className={`flex items-center gap-2.5 text-[13.5px] ${
                done ? "text-foreground/70" : active ? "text-foreground" : "text-muted-foreground/50"
              }`}
            >
              {done ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : active ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
              )}
              {text}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Шаг 3. Маршрут собран
// ---------------------------------------------------------------------------

function RoutePhase({
  route,
  calls,
  keepIds,
  phones,
  phoneBusy,
  onFetchPhone,
  onCall,
  onRemove,
  onRebuild,
  onBack,
  onSend,
  sending,
}: {
  route: BuiltRoute
  calls: Record<string, CallStatus>
  keepIds: string[]
  phones: Record<string, string>
  phoneBusy: string | null
  onFetchPhone: (loadId: string) => void
  onCall: (loadId: string, status: CallStatus) => void
  onRemove: (loadId: string) => void
  onRebuild: () => void
  onBack: () => void
  onSend: () => void
  sending: boolean
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)

  const agreedCount = route.legs.filter((leg) => calls[leg.load.id] === "agreed").length
  const declinedCount = route.legs.filter((leg) => calls[leg.load.id] === "declined").length

  return (
    <div className="space-y-5">
      {/* Итог: деньги — главное */}
      <Card className="border-primary/25 bg-primary/[0.06]">
        <p className="text-[13px] text-muted-foreground">Маршрут собран · {route.path[0]} → {route.path[route.path.length - 1]}</p>
        <p className="mt-1 text-[30px] font-bold leading-none text-foreground">
          {route.totalProfitRub !== null ? (
            <>
              {route.totalProfitRub < 0 ? "−" : "+"}
              {formatMoney(Math.abs(route.totalProfitRub))} ₽
            </>
          ) : (
            "Прибыль не посчитана"
          )}
        </p>
        {route.totalProfitRub === null ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            У машины не заполнен расход топлива — прибыль нечем оценить
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-primary/15 pt-3">
          <SummaryCell label="Выручка" value={`${formatMoney(route.totalRevenue)} ₽`} />
          <SummaryCell
            label="Топливо"
            value={route.totalFuelCostRub !== null ? `≈ ${formatMoney(route.totalFuelCostRub)} ₽` : "—"}
          />
          <SummaryCell label="Плеч" value={String(route.legs.length)} />
          <SummaryCell
            label="Расстояние"
            value={route.totalDistanceKm > 0 ? `${route.totalDistanceKm} км` : "—"}
          />
        </div>

        {route.returnDeadheadKm > 0 ? (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            В конце — возврат в {route.path[0]}: {route.returnDeadheadKm} км порожнем, топливо на него
            уже учтено в прибыли.
          </p>
        ) : null}

        {route.unprofitable ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-[12.5px] leading-snug text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Маршрут в убыток — отправлять невыгодно. Уберите груз или пересоберите.
          </p>
        ) : null}
        {route.needsFuelSetup ? (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            Заполните расход топлива у машины — помощник будет считать прибыль точно.
          </p>
        ) : null}
      </Card>

      {/* Плечи: цепочка городов */}
      <section>
        <h2 className="mb-2 px-1 text-[14px] font-semibold text-foreground">Маршрут по плечам</h2>
        <div className="space-y-3">
          {route.legs.map((leg, index) => {
            const status = calls[leg.load.id] ?? "pending"
            const phone = telHref(phones[leg.load.id] ?? leg.load.contactPhone)
            return (
              <Card key={leg.load.id}>
                <div className="flex items-start gap-3">
                  {/* Точка маршрута */}
                  <div className="flex flex-col items-center pt-1">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[12px] font-semibold text-primary">
                      {index + 1}
                    </span>
                    {index < route.legs.length - 1 ? (
                      <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Направление */}
                    <p className="flex items-center gap-1.5 text-[15px] font-semibold leading-snug text-foreground">
                      <span className="truncate">{shortCity(leg.load.fromCity)}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{shortCity(leg.load.toCity)}</span>
                    </p>

                    {/* Компания и груз — отдельными строками, без склеек */}
                    <p className="mt-1 truncate text-[13px] text-foreground/90">
                      {leg.load.firmName?.trim() || "Фрахтователь не указан"}
                      {leg.load.cargoType ? ` · ${leg.load.cargoType}` : ""}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                      {leg.loadedKm > 0 ? `${leg.loadedKm} км` : "расстояние неизвестно"}
                      {leg.load.weightKg ? ` · ${formatWeightKg(leg.load.weightKg)}` : ""}
                    </p>

                    {/* Деньги плеча */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[14px] font-semibold tabular-nums text-foreground">
                        {formatMoney(leg.revenue)} ₽
                      </span>
                      {leg.profitRub !== null ? (
                        <span
                          className={`text-[12.5px] font-medium tabular-nums ${
                            leg.profitRub >= 0 ? "text-primary" : "text-destructive"
                          }`}
                        >
                          прибыль {leg.profitRub >= 0 ? "+" : "−"}
                          {formatMoney(Math.abs(leg.profitRub))} ₽
                        </span>
                      ) : null}
                      {leg.returnsHome ? (
                        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                          домой с грузом
                        </span>
                      ) : null}
                      {leg.byTheWay ? (
                        <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-foreground/80">
                          по пути
                        </span>
                      ) : null}
                    </div>

                    {leg.deadheadKm > 0 ? (
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        +{leg.deadheadKm} км подъезда к погрузке — учтено в прибыли плеча
                      </p>
                    ) : null}

                    {/* Звонок и статус */}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {phone ? (
                        <a
                          href={phone}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1f6f3f] px-3 text-[13px] font-medium text-white active:opacity-70"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Позвонить
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onFetchPhone(leg.load.id)}
                          disabled={phoneBusy === leg.load.id}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#1f6f3f] px-3 text-[13px] font-medium text-white active:opacity-70 disabled:opacity-50"
                        >
                          {phoneBusy === leg.load.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Phone className="h-3.5 w-3.5" />
                          )}
                          Узнать телефон
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onCall(leg.load.id, "agreed")}
                        className={`inline-flex min-h-[38px] items-center gap-1 rounded-lg border px-2.5 text-[12.5px] active:opacity-70 ${
                          status === "agreed"
                            ? "border-primary/40 bg-primary/15 text-primary"
                            : "border-border text-foreground/90"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Договорились
                      </button>
                      <button
                        type="button"
                        onClick={() => onCall(leg.load.id, "declined")}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-border px-2.5 text-[12.5px] text-foreground/90 active:opacity-70"
                      >
                        <X className="h-3.5 w-3.5" />
                        Отказ
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(leg.load.id)}
                        className="inline-flex min-h-[38px] items-center rounded-lg px-2 text-[12.5px] text-muted-foreground active:opacity-70"
                      >
                        Убрать
                      </button>
                    </div>

                    {status === "agreed" ? (
                      <p className="mt-1.5 text-[12px] font-medium text-primary">
                        Согласовано — груз останется в маршруте при пересборке
                      </p>
                    ) : null}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Договорённости: сколько созвонили */}
      {agreedCount + declinedCount > 0 ? (
        <p className="px-1 text-[12.5px] text-muted-foreground">
          Созвонились: {agreedCount} из {route.legs.length} договорились, {declinedCount} отказали
        </p>
      ) : null}

      {/* Отправка машины */}
      <Card className="border-primary/25 bg-primary/[0.06]">
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          {agreedCount === route.legs.length && route.legs.length > 0
            ? "Все фрахтователи согласованы — можно отправлять."
            : "Отправлять можно и без полного согласования: что-то договоритесь уже в пути."}
        </p>
        <button
          type="button"
          onClick={onSend}
          disabled={sending || route.unprofitable}
          className="mt-3 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Truck className="h-5 w-5" />}
          {sending ? "Отправляю машину…" : "Отправить машину"}
        </button>
        <div className="mt-2.5 flex items-center gap-4">
          <button
            type="button"
            onClick={onRebuild}
            className="inline-flex min-h-[40px] items-center gap-1.5 text-[13px] font-medium text-foreground/80 active:opacity-70"
          >
            <RefreshCw className="h-4 w-4" />
            Пересобрать маршрут
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[40px] items-center gap-1.5 text-[13px] font-medium text-foreground/80 active:opacity-70"
          >
            <MapPin className="h-4 w-4" />
            Другой город
          </button>
        </div>
      </Card>

      {/* Подробности: что осталось на бирже */}
      <section>
        <button
          type="button"
          onClick={() => setDetailsOpen((value) => !value)}
          className="flex min-h-[40px] w-full items-center justify-between rounded-xl px-1 text-[13px] font-medium text-foreground/80 active:opacity-70"
        >
          Что осталось на бирже ({route.excluded.length})
          {detailsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {detailsOpen ? (
          <div className="mt-2 space-y-1.5">
            {route.excluded.length === 0 ? (
              <p className="px-1 text-[12.5px] text-muted-foreground">Все грузы биржи уже в маршруте.</p>
            ) : (
              route.excluded.slice(0, 20).map(({ load, reason }) => (
                <div
                  key={load.id}
                  className="flex items-start gap-2 rounded-xl border border-border px-3 py-2"
                >
                  <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground">
                      {shortCity(load.fromCity)} → {shortCity(load.toCity)}
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {load.firmName?.trim() || "фрахтователь не указан"} · {reason}
                    </p>
                  </div>
                  {load.priceRub ? (
                    <span className="shrink-0 text-[12.5px] tabular-nums text-foreground/90">
                      {formatMoney(load.priceRub)} ₽
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      {/* Подробности: почему так собрал */}
      <section>
        <button
          type="button"
          onClick={() => setWhyOpen((value) => !value)}
          className="flex min-h-[40px] w-full items-center justify-between rounded-xl px-1 text-[13px] font-medium text-foreground/80 active:opacity-70"
        >
          Почему собрал так
          {whyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {whyOpen ? (
          <ul className="mt-2 space-y-1.5 px-1">
            {route.reasons.map((reason) => (
              <li key={reason} className="text-[12.5px] leading-snug text-muted-foreground">
                · {reason}
              </li>
            ))}
            {keepIds.length > 0 ? (
              <li className="text-[12.5px] leading-snug text-muted-foreground">
                · Согласованные вами грузы: {keepIds.length}
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Мелочи
// ---------------------------------------------------------------------------

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className="text-[14px] font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}
