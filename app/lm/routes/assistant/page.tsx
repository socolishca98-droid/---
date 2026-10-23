// app/lm/routes/assistant/page.tsx — помощник сборки рейсов.
//
// Экран сделан как для логиста: три блока сверху вниз, на каждом блоке —
// одна главная кнопка. Всё, что нужно не всегда (состав рейса, выбор машины
// и водителя, радиус сборки, обратная загрузка), свёрнуто в «Подробности»
// и не мешает основному пути: увидел → предложил рейс.
//
//   1. Что собираем  — сколько заказов ждут рейса и кнопка «Собрать рейс»
//   2. Готовые рейсы — карточки с прибылью и кнопкой «Предложить рейс»
//   3. Биржа грузов  — три варианта с биржи и кнопка «Взять в работу»
//
// После «Предложить рейс» создаётся рейс (POST /api/routes) и открывается
// его карточка: там назначают водителя и отправляют рейс.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Loader2,
  Package,
  Phone,
  RefreshCw,
  Route as RouteIcon,
  Settings2,
  Sparkles,
  Truck,
  Undo2,
  User,
  X,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { ActionButton, Card, EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import {
  assignableDrivers,
  buildRouteFromAnchor,
  buildRouteProposals,
  driverOfVehicle,
  isRouteableForAssistant,
  pickCrew,
  proposalLine,
  proposalSummary,
  vehiclesForCargo,
  type AssistantOrder,
  type AssistantVehicle,
  type RouteProposal,
} from "@/lib/logist-mobile/route-assistant"
import { DRIVER_STATUS_META, type MobileDriver, type MobileOrder } from "@/lib/logist-mobile/types"
import { ProposalEtaComparison } from "@/components/logist-mobile/proposal-eta-comparison"
import { suggestExchangeLoads, type SuggestionLoad, type SuggestionVehicle } from "@/lib/logist-mobile/load-suggestions"
import { formatKm, formatMoney, formatWeightKg, shortCity, telHref } from "@/lib/logist-mobile/format"

export default function RouteAssistantPage() {
  const router = useRouter()
  const { user } = useStaffSession()

  const ordersState = useJsonApi<{ orders: MobileOrder[] }>(user ? "/api/orders?limit=200" : null)
  const vehiclesState = useJsonApi<{ vehicles: AssistantVehicle[] }>(user ? "/api/vehicles" : null)
  const driversState = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)
  // Биржа грузов: грузы с площадок ATI + автообновление (если кэш устарел —
  // сервер сам дёргает ATI и только потом отдаёт список)
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
      note: string | null
      status: string
    }>
    lastScanAt: string | null
    refreshError: string | null
  }>(user ? "/api/ati/loads?status=new&limit=50" : null)

  const [hidden, setHidden] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  /** Что логист поменял руками: своя машина и водитель на предложение */
  const [vehicleChoice, setVehicleChoice] = useState<Record<string, string>>({})
  const [driverChoice, setDriverChoice] = useState<Record<string, string>>({})
  /**
   * Опорный заказ: рейс строится вокруг него. По умолчанию выключено —
   * помощник сам раскладывает все заказы без рейса по направлениям.
   * Включается в «Настройках сборки» (нуно редко — под конкретный груз).
   */
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Радиус сборки, км. Ноль — только по направлению (общий город). */
  const [radiusKm, setRadiusKm] = useState(0)
  const [refreshingAll, setRefreshingAll] = useState(false)

  // Координаты городов — только когда выбран опорный заказ и радиус: без них
  // геокодер зря не дёргается.
  const geoState = useJsonApi<{ points: Record<string, { lat: number; lng: number } | null> }>(
    user && anchorId && radiusKm > 0 ? "/api/orders/geo-points" : null,
  )

  const orders = (ordersState.data?.orders ?? []) as AssistantOrder[]
  const vehicles = vehiclesState.data?.vehicles ?? []
  const drivers = driversState.data?.drivers ?? []

  const loading = ordersState.loading || vehiclesState.loading
  const error = ordersState.error || vehiclesState.error

  // Координаты подставляем заказам: без них радиус не измерить, и помощник
  // честно соберёт по направлению.
  const geoPoints = geoState.data?.points ?? null
  const ordersWithPoints = useMemo(() => {
    if (!geoPoints) return orders
    return orders.map((order) => ({
      ...order,
      fromPoint: geoPoints[shortCity(order.routeFrom)] ?? null,
      toPoint: geoPoints[shortCity(order.routeTo)] ?? null,
    }))
  }, [orders, geoPoints])

  const proposals = useMemo(
    () => buildRouteProposals(ordersWithPoints, vehicles),
    [ordersWithPoints, vehicles],
  )

  /** Сборка от опорного заказа (если выбран в настройках). */
  const anchorBuild = useMemo(() => {
    if (!anchorId) return null
    return buildRouteFromAnchor(ordersWithPoints, vehicles, {
      anchorOrderId: anchorId,
      radiusKm: radiusKm > 0 ? radiusKm : null,
    })
  }, [anchorId, radiusKm, ordersWithPoints, vehicles])

  // Когда выбран опорный заказ — показываем сборку вокруг него одной карточкой.
  const visible = anchorBuild
    ? [anchorBuild.proposal]
    : proposals.filter((proposal) => !hidden.includes(proposal.id))
  const readyCount = orders.filter(isRouteableForAssistant).length
  const summary = proposalSummary(proposals, readyCount)
  const anchorOrder = anchorId ? orders.find((order) => order.id === anchorId) ?? null : null

  /** Пересборка: убираем скрытые предложения и перечитываем все списки. */
  function rebuildAll() {
    setHidden([])
    ordersState.reload()
    vehiclesState.reload()
    driversState.reload()
    loadsState.reload()
  }

  async function refreshAll() {
    setRefreshingAll(true)
    try {
      rebuildAll()
      toast.success("Данные обновлены")
    } finally {
      setRefreshingAll(false)
    }
  }

  // ── Биржа: три примерно подходящих груза ──
  // ATI не отдаёт контакты под автоматическую сборку — помощник только
  // показывает три варианта. Логист звонит, договаривается, потом жмёт
  // «Взять в работу»: груз становится нашим заказом (этап «Поиск»).
  const exchangeLoads = useMemo<SuggestionLoad[]>(() => {
    const rows = loadsState.data?.items ?? []
    return rows.map((row) => ({
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
      ratePerKm:
        row.price && row.distance && row.distance > 0 ? row.price / row.distance : null,
      firmName: row.firmName,
      firmRating: null,
      firstDate: row.loadingDate,
      lastDate: null,
      status: row.status,
    }))
  }, [loadsState.data])

  const exchangeSuggestions = useMemo(
    () => suggestExchangeLoads(exchangeLoads, vehicles as SuggestionVehicle[]),
    [exchangeLoads, vehicles],
  )

  /** «Взять в работу» — груз с биржи становится нашим заказом. */
  const [takingLoad, setTakingLoad] = useState<string | null>(null)
  const [refreshingLoads, setRefreshingLoads] = useState(false)

  async function takeExchangeLoad(load: SuggestionLoad) {
    setTakingLoad(load.id)
    try {
      const result = await apiSend<{ order: { id: string } }>("/api/orders/from-cache", "POST", {
        cacheId: load.id,
        fetchContacts: true,
      })
      if (result.ok && result.data?.order) {
        toast.success("Груз взят в работу — заказ создан")
        router.push(`/lm/orders/${result.data.order.id}`)
      } else {
        toast.error(result.error ?? "Не удалось взять груз в работу")
      }
    } catch {
      toast.error("Не удалось взять груз в работу")
    } finally {
      setTakingLoad(null)
    }
  }

  async function refreshExchangeLoads() {
    setRefreshingLoads(true)
    try {
      const result = await apiSend<{ count?: number; total?: number }>("/api/ati/loads", "POST")
      if (result.ok) {
        toast.success(`Биржа обновлена: грузов ${result.data?.count ?? result.data?.total ?? 0}`)
        loadsState.reload()
      } else {
        toast.error(result.error ?? "Не удалось обновить биржу")
      }
    } catch {
      toast.error("Не удалось обновить биржу")
    } finally {
      setRefreshingLoads(false)
    }
  }

  /**
   * Экипаж предложения: машина и водитель подставляются помощником, логист
   * может поменять любого (в «Подробностях» карточки). Связка всегда
   * допустимая — машина в базе закреплена за одним водителем.
   */
  function crewFor(proposal: RouteProposal): { vehicle: AssistantVehicle | null; driver: MobileDriver | null } {
    const preset = pickCrew(proposal.weightKg, proposal.volumeM3, vehicles, drivers)
    const manualVehicle = vehicleChoice[proposal.id]
    const manualDriver = driverChoice[proposal.id]

    let vehicle: AssistantVehicle | null
    if (manualVehicle === "none") vehicle = null
    else if (manualVehicle) vehicle = vehicles.find((item) => item.id === manualVehicle) ?? null
    else vehicle = preset.vehicle

    let driver: MobileDriver | null
    if (manualDriver === "none") driver = null
    else if (manualDriver) driver = drivers.find((item) => item.id === manualDriver) ?? null
    else driver = preset.driver

    // Машина одна на водителя: если выбрана чужая — берём её хозяина,
    // если выбран водитель со своей машиной — едет на своей.
    const owner = driverOfVehicle(vehicle?.id, drivers)
    if (owner && driver && owner.id !== driver.id) driver = owner
    if (driver?.vehicleId && driver.vehicleId !== vehicle?.id) {
      vehicle = vehicles.find((item) => item.id === driver?.vehicleId) ?? vehicle
    }

    return { vehicle, driver }
  }

  async function propose(proposal: RouteProposal) {
    const { vehicle, driver } = crewFor(proposal)
    setBusy(proposal.id)
    try {
      const result = await apiSend<{ route?: { id: string } }>("/api/routes", "POST", {
        orderIds: proposal.orders.map((order) => order.id),
        vehicleId: vehicle?.id ?? null,
        driverId: driver?.id ?? null,
        name: proposal.name,
      })
      if (result.ok) {
        const created = (result.data as { route?: { id: string } } | null)?.route?.id
        toast.success(driver ? "Рейс предложен — водителю ушло уведомление" : "Рейс предложен — назначьте водителя")
        router.push(created ? `/lm/routes/${created}` : "/lm/routes")
      } else {
        toast.error(result.error ?? "Не удалось предложить рейс")
      }
    } catch {
      toast.error("Не удалось предложить рейс")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <LogistHeader
        title="Помощник сборки"
        subtitle="Заказы → рейс, без лишних шагов"
        back
        userName={user?.name}
        action={
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshingAll}
            aria-label="Обновить"
            className="flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 active:bg-secondary/60 disabled:opacity-50"
          >
            <RefreshCw className={`h-5 w-5 ${refreshingAll ? "animate-spin" : ""}`} />
          </button>
        }
      />

      <div className="px-4 pt-4 pb-8">
        {error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              ordersState.reload()
              vehiclesState.reload()
              driversState.reload()
            }}
          />
        ) : loading ? (
          <ListSkeleton rows={3} />
        ) : (
          <>
            {/* ═══════════ БЛОК 1. Что собираем ═══════════ */}
            <section>
              <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3.5">
                <p className="text-[13px] text-muted-foreground">Заказов ждут рейса</p>
                <p className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-[32px] font-bold leading-none text-foreground">{readyCount}</span>
                  {summary.routes > 0 ? (
                    <span className="text-[13px] text-foreground/80">
                      · собрал {summary.routes} {plural(summary.routes, ["рейс", "рейса", "рейсов"])}
                    </span>
                  ) : null}
                </p>

                <button
                  type="button"
                  onClick={rebuildAll}
                  disabled={readyCount === 0}
                  className="mt-3 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
                >
                  <Truck className="h-5 w-5" />
                  {readyCount === 0 ? "Собирать нечего" : "Собрать рейс"}
                </button>

                {readyCount === 0 ? (
                  <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
                    Заказ попадает в сборку сразу после создания — согласование будет
                    позже, когда рейс собран.{" "}
                    <Link href="/lm/orders" className="font-medium text-primary">
                      К заказам
                    </Link>
                  </p>
                ) : (
                  <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
                    Помощник разложит все заказы без рейса по направлениям и посчитает
                    прибыль каждого рейса.
                  </p>
                )}

                {/* Настройки сборки — редко нужны, поэтому свёрнуты */}
                {readyCount > 0 ? (
                  <div className="mt-2.5 border-t border-primary/15 pt-2.5">
                    <button
                      type="button"
                      onClick={() => setSettingsOpen((v) => !v)}
                      className="flex min-h-[36px] w-full items-center gap-1.5 text-[12.5px] font-medium text-foreground/70 active:opacity-70"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Настройки сборки
                      {anchorId ? " · вокруг заказа" : ""}
                    </button>

                    {settingsOpen ? (
                      <div className="mt-2 space-y-3">
                        <p className="text-[12px] text-muted-foreground">
                          Опорный заказ — рейс строится вокруг него. Не выбран: помощник
                          сам раскладывает все заказы по направлениям.
                        </p>
                        <div className="max-h-[200px] space-y-1.5 overflow-y-auto overscroll-contain">
                          {orders
                            .filter(isRouteableForAssistant)
                            .map((order) => {
                              const active = order.id === anchorId
                              return (
                                <button
                                  key={order.id}
                                  type="button"
                                  onClick={() => setAnchorId(active ? null : order.id)}
                                  className={`flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left active:opacity-70 ${
                                    active ? "border-primary/40 bg-primary/10" : "border-border"
                                  }`}
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[13px] text-foreground">
                                      {order.clientName?.trim() || shortCity(order.routeFrom)}
                                    </span>
                                    <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
                                      {shortCity(order.routeFrom)}
                                      <ArrowRight className="h-3 w-3" />
                                      {shortCity(order.routeTo)}
                                      {order.weight ? <span>· {formatWeightKg(order.weight)}</span> : null}
                                    </span>
                                  </span>
                                  {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                                </button>
                              )
                            })}
                        </div>

                        {anchorId ? (
                          <>
                            <div className="rounded-xl bg-secondary/40 px-3 py-2.5">
                              <p className="text-[12.5px] font-medium text-foreground">
                                Радиус сборки: {radiusKm === 0 ? "по направлению" : `${radiusKm} км`}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {[0, 50, 100, 200, 400].map((value) => (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => setRadiusKm(value)}
                                    className={`min-h-[34px] rounded-md border px-3 text-[12.5px] ${
                                      radiusKm === value
                                        ? "border-primary/40 bg-primary/15 text-primary"
                                        : "border-border text-foreground/90"
                                    }`}
                                  >
                                    {value === 0 ? "по направлению" : `${value} км`}
                                  </button>
                                ))}
                              </div>
                              <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                                {radiusKm === 0
                                  ? "Берём грузы с общим городом погрузки или выгрузки."
                                  : "Берём грузы, у которых город рядом с вашим маршрутом."}
                              </p>
                              {radiusKm > 0 && geoState.loading ? (
                                <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" /> Считаю расстояния…
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setAnchorId(null)
                                setRadiusKm(0)
                              }}
                              className="text-[12.5px] font-medium text-primary"
                            >
                              Сбросить опорный заказ
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>

            {/* ═══════════ БЛОК 2. Готовые рейсы ═══════════ */}
            <section className="mt-5">
              <h2 className="mb-2 px-1 text-[14px] font-semibold text-foreground">
                {anchorBuild ? "Рейс вокруг заказа" : "Готовые рейсы"}
              </h2>

              {visible.length === 0 ? (
                <EmptyState
                  icon={<RouteIcon className="h-6 w-6" />}
                  title={
                    readyCount === 0
                      ? "Заказов без рейса нет"
                      : proposals.length > 0
                        ? "Предложения разобраны"
                        : "Предложений нет"
                  }
                  description={
                    readyCount === 0
                      ? "Как только появится заказ без рейса — помощник соберёт из него рейс."
                      : proposals.length > 0
                        ? "Вы скрыли все предложения. Нажмите «Собрать рейс», чтобы вернуть их."
                        : "Помощник не смог собрать рейс из этих заказов. Попробуйте «Собрать рейс» ещё раз."
                  }
                  action={
                    <Link
                      href="/lm/orders"
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-secondary px-4 text-[14px] font-medium text-foreground active:opacity-70"
                    >
                      К заказам
                    </Link>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {visible.map((proposal) => {
                    const { vehicle, driver } = crewFor(proposal)
                    const tooHeavy =
                      vehiclesForCargo(proposal.weightKg, proposal.volumeM3, vehicles).length === 0

                    return (
                      <Card key={proposal.id} className={proposal.urgent ? "border-warning/30" : ""}>
                        {/* Шапка рейса: направление и главная цифра — прибыль */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[16px] font-semibold leading-snug text-foreground">
                              {proposal.name}
                            </p>
                            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                              {proposalLine(proposal)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setHidden((prev) => [...prev, proposal.id])}
                            aria-label="Скрыть предложение"
                            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        {proposal.urgent ? (
                          <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-warning/10 px-2 py-1 text-[12px] text-warning">
                            <AlertTriangle className="h-3.5 w-3.5" /> {proposal.deadlineText}
                          </p>
                        ) : null}

                        {/* Деньги рейса — сразу под названием: по этой цифре
                            логист решает, брать рейс или нет */}
                        {proposal.profitRub !== null && proposal.fuelCostRub !== null ? (
                          <div
                            className={`mt-2.5 rounded-xl px-3 py-2.5 ${
                              proposal.unprofitable ? "bg-destructive/10" : "bg-success/10"
                            }`}
                          >
                            <p className="text-[18px] font-semibold text-foreground">
                              {proposal.unprofitable ? "Убыток " : "Прибыль ≈ "}
                              <span className={proposal.unprofitable ? "text-destructive" : "text-success"}>
                                {formatMoney(Math.abs(proposal.profitRub))}
                              </span>
                            </p>
                            <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                              Выручка {formatMoney(proposal.revenue)} − топливо{" "}
                              {formatMoney(proposal.fuelCostRub)}
                              {proposal.distanceKm > 0 ? ` · ${formatKm(proposal.distanceKm)}` : ""}
                            </p>
                          </div>
                        ) : null}

                        {/* Единственная главная кнопка карточки */}
                        <button
                          type="button"
                          onClick={() => void propose(proposal)}
                          disabled={busy !== null || tooHeavy}
                          className="mt-3 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
                        >
                          {busy === proposal.id ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <Truck className="h-5 w-5" />
                          )}
                          {busy === proposal.id ? "Предлагаю…" : "Предложить рейс"}
                        </button>
                        <p className="mt-1.5 text-center text-[12px] text-muted-foreground">
                          {tooHeavy
                            ? "Под этот вес машины в автопарке нет"
                            : driver
                              ? `Водителю ${driver.name.split(" ")[0]} уйдёт уведомление`
                              : "Водителя назначите в карточке рейса"}
                        </p>

                        {/* ── Подробности: свёрнуты, чтобы не мешали ── */}
                        <details className="group mt-2.5 border-t border-border pt-2">
                          <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium text-foreground/80 [&::-webkit-details-marker]:hidden">
                            Состав рейса ({proposal.orders.length})
                            <span className="text-[11px] text-muted-foreground group-open:hidden">
                              показать
                            </span>
                            <span className="hidden text-[11px] text-muted-foreground group-open:inline">
                              скрыть
                            </span>
                          </summary>
                          <div className="mt-1.5 space-y-1.5">
                            {proposal.orders.map((order) => {
                              const tel = telHref(order.clientPhone ?? order.clientContact ?? null)
                              return (
                                <div
                                  key={order.id}
                                  className="flex items-center gap-2 rounded-xl bg-card px-2.5 py-2 shadow-sm"
                                >
                                  <Link
                                    href={`/lm/orders/${order.id}`}
                                    className="flex min-w-0 flex-1 items-start gap-2 active:opacity-70"
                                  >
                                    <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[13px] text-foreground">
                                        {order.clientName?.trim() || shortCity(order.routeFrom)}
                                      </span>
                                      <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
                                        {shortCity(order.routeFrom)}
                                        <ArrowRight className="h-3 w-3" />
                                        {shortCity(order.routeTo)}
                                        {order.weight ? <span>· {formatWeightKg(order.weight)}</span> : null}
                                        {order.agreedPrice || order.price ? (
                                          <span>· {formatMoney(order.agreedPrice ?? order.price)}</span>
                                        ) : null}
                                      </span>
                                    </span>
                                  </Link>
                                  {tel ? (
                                    <a
                                      href={tel}
                                      className="flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-success/15 px-3 text-[12.5px] font-medium text-success active:opacity-70"
                                    >
                                      <Phone className="h-3.5 w-3.5" /> Позвонить
                                    </a>
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        </details>

                        <details className="group mt-1 border-t border-border pt-2">
                          <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium text-foreground/80 [&::-webkit-details-marker]:hidden">
                            <span className="flex items-center gap-1.5">
                              <Truck className="h-3.5 w-3.5" />
                              {vehicle ? vehicle.plate : "Машина не выбрана"}
                              {driver ? ` · ${driver.name.split(" ")[0]}` : " · водитель не назначен"}
                            </span>
                            <span className="text-[11px] text-muted-foreground group-open:hidden">
                              изменить
                            </span>
                          </summary>
                          <div className="mt-2 space-y-2">
                            <p className="text-[12px] text-muted-foreground">Машина</p>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => setVehicleChoice((prev) => ({ ...prev, [proposal.id]: "none" }))}
                                className={`rounded-md border px-3 py-1.5 text-[12.5px] ${
                                  !vehicle
                                    ? "border-primary/40 bg-primary/15 text-primary"
                                    : "border-border text-foreground/90"
                                }`}
                              >
                                без машины
                              </button>
                              {vehiclesForCargo(proposal.weightKg, proposal.volumeM3, vehicles).map((item) => {
                                const active = vehicle?.id === item.id
                                const owner = driverOfVehicle(item.id, drivers)
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setVehicleChoice((prev) => ({ ...prev, [proposal.id]: item.id }))}
                                    className={`rounded-md border px-3 py-1.5 text-[12.5px] ${
                                      active
                                        ? "border-primary/40 bg-primary/15 text-primary"
                                        : item.status === "available"
                                          ? "border-border text-foreground"
                                          : "border-border text-warning/70"
                                    }`}
                                  >
                                    {item.plate}
                                    {item.capacity ? ` · ${(item.capacity / 1000).toFixed(0)} т` : ""}
                                    {owner ? ` · ${owner.name.split(" ")[0]}` : ""}
                                    {item.status === "available" ? "" : " · занята"}
                                  </button>
                                )
                              })}
                            </div>

                            <p className="pt-1 text-[12px] text-muted-foreground">Водитель</p>
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => setDriverChoice((prev) => ({ ...prev, [proposal.id]: "none" }))}
                                className={`rounded-md border px-3 py-1.5 text-[12.5px] ${
                                  !driver
                                    ? "border-primary/40 bg-primary/15 text-primary"
                                    : "border-border text-foreground/90"
                                }`}
                              >
                                назначу позже
                              </button>
                              {assignableDrivers(proposal.weightKg, proposal.volumeM3, vehicles, drivers).map((item) => {
                                const active = driver?.id === item.id
                                const meta = DRIVER_STATUS_META[item.status ?? "offline"] ?? DRIVER_STATUS_META.offline
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setDriverChoice((prev) => ({ ...prev, [proposal.id]: item.id }))}
                                    className={`rounded-md border px-3 py-1.5 text-[12.5px] ${
                                      active
                                        ? "border-primary/40 bg-primary/15 text-primary"
                                        : "border-border text-foreground"
                                    }`}
                                  >
                                    {item.name.split(" ")[0]}
                                    {item.vehiclePlate ? ` · ${item.vehiclePlate}` : ""}
                                    <span className={`ml-1.5 ${active ? "" : meta.text}`}>
                                      · {meta.label.toLowerCase()}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>

                            {tooHeavy ? (
                              <p className="rounded-xl bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
                                Свободной машины под этот вес нет. Уберите часть заказов или
                                добавьте машину в автопарк.
                              </p>
                            ) : null}
                          </div>
                        </details>

                        <details className="group mt-1 border-t border-border pt-2">
                          <summary className="flex min-h-[40px] cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium text-foreground/80 [&::-webkit-details-marker]:hidden">
                            Подробности сборки
                            <span className="text-[11px] text-muted-foreground group-open:hidden">
                              показать
                            </span>
                          </summary>
                          <div className="mt-1.5 space-y-2.5">
                            <ul className="space-y-1">
                              {proposal.reasons.map((reason) => (
                                <li
                                  key={reason}
                                  className="flex items-start gap-1.5 text-[12.5px] leading-snug text-muted-foreground"
                                >
                                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-secondary" />
                                  {reason}
                                </li>
                              ))}
                            </ul>

                            {proposal.backload ? (
                              <div className="rounded-xl border border-success/25 bg-success/[0.07] px-3 py-2.5">
                                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                                  <Undo2 className="h-3.5 w-3.5 text-success" />
                                  {proposal.backload.returnsHome
                                    ? "Возврат с грузом — машина приедет домой загруженной"
                                    : "На обратном плече есть груз"}
                                </p>
                                <p className="mt-1 text-[12.5px] leading-snug text-foreground/90">
                                  {proposal.backload.orders.length}{" "}
                                  {plural(proposal.backload.orders.length, ["заказ", "заказа", "заказов"])} из{" "}
                                  {proposal.backload.fromCity} → {proposal.backload.toCity} на{" "}
                                  {formatMoney(proposal.backload.revenue)}
                                  {proposal.backload.weightKg > 0
                                    ? ` · ${formatWeightKg(proposal.backload.weightKg)}`
                                    : ""}
                                </p>
                                {!proposal.backload.fitsVehicle ? (
                                  <p className="mt-1 text-[12px] text-warning">
                                    Вместе с основным грузом в эту машину уже не влезает — нужна
                                    вторая машина или часть заказов в другой рейс.
                                  </p>
                                ) : null}
                              </div>
                            ) : null}

                            {anchorBuild &&
                            proposal.id === anchorBuild.proposal.id &&
                            anchorBuild.excluded.length > 0 ? (
                              <div className="rounded-xl bg-secondary/40 px-3 py-2.5">
                                <p className="text-[12.5px] font-medium text-foreground">
                                  Не взято ({anchorBuild.excluded.length}) — и почему:
                                </p>
                                <ul className="mt-1 space-y-1">
                                  {anchorBuild.excluded.slice(0, 5).map((entry) => (
                                    <li
                                      key={entry.order.id}
                                      className="flex items-start gap-1.5 text-[11.5px] leading-snug text-muted-foreground"
                                    >
                                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-secondary" />
                                      {shortCity(entry.order.routeFrom)} →{" "}
                                      {shortCity(entry.order.routeTo)} — {entry.reason}
                                    </li>
                                  ))}
                                </ul>
                                {anchorBuild.excluded.length > 5 ? (
                                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                                    и ещё {anchorBuild.excluded.length - 5}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}

                            <ProposalEtaComparison
                              orderIds={proposal.orders.map((order) => order.id)}
                              vehicleId={crewFor(proposal).vehicle?.id ?? null}
                            />
                          </div>
                        </details>
                      </Card>
                    )
                  })}
                </div>
              )}
            </section>

            {/* ═══════════ БЛОК 3. Биржа грузов ═══════════ */}
            {user ? (
              <section className="mt-6">
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <h2 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Грузы с биржи
                  </h2>
                  <div className="flex items-center gap-1.5">
                    <Link
                      href="/lm/search"
                      className="flex min-h-[34px] items-center rounded-lg px-2.5 text-[12.5px] font-medium text-primary active:opacity-70"
                    >
                      Все грузы
                    </Link>
                    <button
                      type="button"
                      onClick={refreshExchangeLoads}
                      disabled={refreshingLoads}
                      className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] font-medium text-foreground/90 active:bg-secondary/60 disabled:opacity-60"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${refreshingLoads ? "animate-spin" : ""}`} />
                      Обновить
                    </button>
                  </div>
                </div>

                {loadsState.error && !loadsState.data ? (
                  <ErrorState message={loadsState.error} onRetry={() => loadsState.reload()} />
                ) : loadsState.loading && !loadsState.data ? (
                  <ListSkeleton rows={3} />
                ) : exchangeSuggestions.length === 0 ? (
                  <Card>
                    <div className="px-1 py-3">
                      <p className="text-[13px] font-medium text-foreground">Подходящих грузов пока нет</p>
                      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                        Показываем грузы, которые влезают в ваши машины и с озвученной
                        ставкой. Нажмите «Обновить» — или откройте биржу и выберите груз вручную.
                      </p>
                      {loadsState.data?.refreshError ? (
                        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                          {loadsState.data.refreshError}
                        </p>
                      ) : null}
                    </div>
                  </Card>
                ) : (
                  <>
                    <p className="mb-2 px-1 text-[12px] leading-snug text-muted-foreground">
                      Позвоните фрахтователю, договоритесь — и жмите «Взять в работу»:
                      груз станет нашим заказом.
                    </p>
                    {exchangeSuggestions.map((suggestion) => (
                      <Card key={suggestion.load.id} className="mb-3">
                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-semibold text-foreground">
                                {shortCity(suggestion.load.fromCity)}
                                <ArrowRight className="mx-1 inline h-3.5 w-3.5 text-muted-foreground" />
                                {shortCity(suggestion.load.toCity)}
                              </p>
                              <p className="mt-0.5 text-[12px] text-muted-foreground">
                                {suggestion.load.firmName ?? "Фрахтователь скрыт"}
                                {suggestion.load.cargoType ? ` · ${suggestion.load.cargoType}` : ""}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-[15px] font-semibold text-primary">
                                {suggestion.load.priceWithNds != null || suggestion.load.priceRub != null
                                  ? formatMoney(suggestion.load.priceWithNds ?? suggestion.load.priceRub)
                                  : "—"}
                              </p>
                              {suggestion.ratePerKm != null ? (
                                <p className="text-[11px] text-muted-foreground">
                                  {Math.round(suggestion.ratePerKm)} ₽/км
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                            {suggestion.load.weightKg != null ? (
                              <span>{formatWeightKg(suggestion.load.weightKg)}</span>
                            ) : null}
                            {suggestion.load.distanceKm != null ? (
                              <span>{formatKm(suggestion.load.distanceKm)}</span>
                            ) : null}
                            <span className="text-foreground/70">{suggestion.vehicle.plate}</span>
                          </div>

                          <p className="rounded-lg bg-secondary/40 px-2.5 py-1.5 text-[11.5px] leading-snug text-muted-foreground">
                            {suggestion.reason}
                          </p>

                          <ActionButton
                            tone="primary"
                            full
                            onClick={() => takeExchangeLoad(suggestion.load)}
                            disabled={takingLoad === suggestion.load.id}
                          >
                            {takingLoad === suggestion.load.id ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Беру в работу…
                              </>
                            ) : (
                              <>
                                <Package className="h-4 w-4" />
                                Взять в работу
                              </>
                            )}
                          </ActionButton>
                        </div>
                      </Card>
                    ))}
                    {loadsState.data?.lastScanAt ? (
                      <p className="px-1 text-center text-[11px] text-muted-foreground">
                        Биржа обновлена:{" "}
                        {new Date(loadsState.data.lastScanAt).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    ) : null}
                  </>
                )}
              </section>
            ) : null}

            {/* Подсказка для самого начала: заказы есть, но все в рейсах */}
            {!loading && proposals.length === 0 && readyCount === 0 && orders.length > 0 ? (
              <p className="mt-4 px-1 text-center text-[12.5px] text-muted-foreground">
                Всего заказов: {orders.length}. В сборку попадают все заказы без рейса —
                на поиске и на согласовании. Помощник соберёт рейс сейчас, а условия
                согласуете в карточке заказа.
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

function plural(count: number, forms: [string, string, string]): string {
  const n = Math.abs(count) % 100
  const tail = n % 10
  if (n > 10 && n < 20) return forms[2]
  if (tail > 1 && tail < 5) return forms[1]
  if (tail === 1) return forms[0]
  return forms[2]
}
