// app/lm/routes/assistant/page.tsx — помощник сборки рейсов.
//
// Экран открывается одной кнопкой из «Рейсов»: помощник уже посмотрел
// согласованные заказы и сам собрал из них рейсы. Логист не ищет заказы
// руками — он читает предложение, при желании меняет машину и водителя
// и нажимает «Предложить рейс».
//
// После этого рейс создаётся (POST /api/routes) и открывается его карточка:
// там остаётся назначить водителя и отправить рейс — то есть согласовать.

"use client"

import { useMemo, useState } from "react"
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
  Package,
  Phone,
  RefreshCw,
  Route as RouteIcon,
  Fuel,
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
  const [open, setOpen] = useState<string | null>(null)
  /**
   * Опорный заказ: рейс строится вокруг него. Пусто — помощник сам раскладывает
   * все согласованные заказы по направлениям.
   */
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [anchorPanel, setAnchorPanel] = useState(false)
  /** Радиус сборки, км. Ноль — только по направлению (общий город). */
  const [radiusKm, setRadiusKm] = useState(0)

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

  /**
   * Сборка от опорного заказа. Возвращает предложение и список того, что
   * осталось за бортом, — с причиной по каждому.
   */
  const anchorBuild = useMemo(() => {
    if (!anchorId) return null
    return buildRouteFromAnchor(ordersWithPoints, vehicles, {
      anchorOrderId: anchorId,
      radiusKm: radiusKm > 0 ? radiusKm : null,
    })
  }, [anchorId, radiusKm, ordersWithPoints, vehicles])

  // Когда выбран опорный заказ — показываем сборку вокруг него одной карточкой:
  // логист пришёл с конкретным грузом, ему не нужен весь список направлений.
  // Общую сборку он всегда вернёт кнопкой «Сбросить».
  const visible = anchorBuild
    ? [anchorBuild.proposal]
    : proposals.filter((proposal) => !hidden.includes(proposal.id))
  const readyCount = orders.filter((order) => !order.routeId && order.status === "agreed").length
  const summary = proposalSummary(proposals, readyCount)
  const anchorOrder = anchorId ? orders.find((order) => order.id === anchorId) ?? null : null

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
   * Экипаж предложения: машина и водитель подставляются помощником, логист может
   * поменять любого. Связка всегда допустимая — машина в базе закреплена
   * за одним водителем, и сервер не примет чужого.
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

    const result = await apiSend<{ route?: { id: string } }>("/api/routes", "POST", {
      orderIds: proposal.orders.map((order) => order.id),
      vehicleId: vehicle?.id ?? null,
      driverId: driver?.id ?? null,
      name: proposal.name,
      notes: `Собрано помощником: ${proposal.orders.length} ${plural(proposal.orders.length, ["заказ", "заказа", "заказов"])}, ${(proposal.weightKg / 1000).toFixed(1)} т${
        vehicle ? `, ${vehicle.plate}` : ""
      }`,
    })
    setBusy(null)

    if (!result.ok) {
      toast.error(result.error || "Не удалось предложить рейс")
      return
    }

    const created = (result.data as { route?: { id: string } } | null)?.route?.id
    toast.success(driver ? "Рейс предложен — водителю ушло уведомление" : "Рейс предложен — назначьте водителя")
    router.push(created ? `/lm/routes/${created}` : "/lm/routes")
  }

  return (
    <>
      <LogistHeader title="Помощник сборки" subtitle="Готовые рейсы из согласованных заказов" back userName={user?.name} />

      <div className="px-4 pt-4">
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
            {/* Итог: что помощник нашёл и собрал */}
            <Card className="border-primary/25 bg-primary/[0.06]">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
                <Sparkles className="h-4.5 w-4.5 text-primary" />
                {summary.routes > 0
                  ? `Собрал ${summary.routes} ${plural(summary.routes, ["рейс", "рейса", "рейсов"])} из ${summary.orders} ${plural(summary.orders, ["заказа", "заказов", "заказов"])}`
                  : "Собирать пока нечего"}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">
                {summary.routes > 0
                  ? `Согласованные заказы, которые ещё не в рейсе. Проверьте состав и предложите рейс — дальше назначите водителя.`
                  : readyCount === 0
                    ? "Нет согласованных заказов без рейса. Заказ попадает сюда, когда вы согласовали условия в карточке заказа."
                    : "Все согласованные заказы уже разобраны по рейсам."}
              </p>

              {/* Порядок работы тремя шагами. Логисту не нужно разбираться,
                  куда нажимать: шаги видны до того, как он тронет экран. */}
              {summary.routes > 0 ? (
                <ol className="mt-2.5 space-y-1.5">
                  {[
                    "Проверьте состав рейса и прибыль — помощник уже посчитал",
                    "Позвоните клиентам кнопкой «Позвонить» и согласуйте, что именно везём",
                    "Нажмите «Предложить рейс» — водителю уйдёт уведомление",
                  ].map((step, index) => (
                    <li key={step} className="flex items-start gap-2 text-[12.5px] leading-snug text-foreground/90">
                      <span className="mt-px flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10.5px] font-semibold text-primary">
                        {index + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              ) : null}
              {summary.routes > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
                  <span>
                    Заказов в предложениях: <span className="text-foreground">{summary.orders}</span>
                  </span>
                  <span>
                    Выручка: <span className="text-foreground">{formatMoney(summary.revenue)}</span>
                  </span>
                  {summary.profitRub !== null ? (
                    <span>
                      Прибыль ≈{" "}
                      <span className={summary.profitRub < 0 ? "text-destructive" : "text-success"}>
                        {formatMoney(summary.profitRub)}
                      </span>
                    </span>
                  ) : null}
                  {summary.unplaced > 0 ? (
                    <span className="text-warning">Не разобрано: {summary.unplaced}</span>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setHidden([])
                  ordersState.reload()
                  vehiclesState.reload()
                  driversState.reload()
                }}
                className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-secondary px-3.5 text-[13px] font-medium text-foreground active:opacity-70"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Пересобрать
              </button>
            </Card>

            {/* Сборка от конкретного заказа.
                Логист обычно начинает с груза («вот этот повезём»), а не с
                направления. Здесь он выбирает опорный заказ — и помощник
                строит рейс вокруг него, подбирая попутные по направлению
                или в заданном радиусе. */}
            {readyCount > 0 ? (
              <Card className="mt-3">
                <button
                  type="button"
                  onClick={() => setAnchorPanel((value) => !value)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold text-foreground">
                      Собрать вокруг заказа
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                      {anchorOrder
                        ? `${anchorOrder.clientName?.trim() || shortCity(anchorOrder.routeFrom)} · ${shortCity(anchorOrder.routeFrom)} → ${shortCity(anchorOrder.routeTo)}`
                        : "Выберите груз — рейс строится от него"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-primary">
                    {anchorId ? "Изменить" : "Выбрать"}
                    {anchorPanel ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </span>
                </button>

                {anchorPanel ? (
                  <div className="mt-2.5 space-y-2.5 border-t border-border pt-3">
                    <p className="text-[12px] text-muted-foreground">
                      Опорный заказ ({readyCount} на выбор)
                    </p>
                    <div className="max-h-[220px] space-y-1.5 overflow-y-auto overscroll-contain">
                      {orders
                        .filter((order) => !order.routeId && order.status === "agreed")
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
                                  {order.agreedPrice || order.price ? (
                                    <span>· {formatMoney(order.agreedPrice ?? order.price)}</span>
                                  ) : null}
                                </span>
                              </span>
                              {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                            </button>
                          )
                        })}
                    </div>

                    {/* Радиус: сколько километров от опорного маршрута можно
                        брать попутные грузы. Ноль — только по направлению. */}
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
                          ? "Берём грузы с общим городом погрузки или выгрузки — без замера расстояний."
                          : "Берём грузы, у которых город рядом с вашим маршрутом, плюс все с общим направлением."}
                      </p>
                      {radiusKm > 0 && geoState.loading ? (
                        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Считаю расстояния…
                        </p>
                      ) : null}
                      {radiusKm > 0 && geoPoints && Object.values(geoPoints).every((v) => v === null) ? (
                        <p className="mt-1.5 text-[11.5px] text-warning">
                          Города не распознаны — соберу по направлению.
                        </p>
                      ) : null}
                    </div>

                  </div>
                ) : null}
              </Card>
            ) : null}

            {visible.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  icon={<RouteIcon className="h-6 w-6" />}
                  title={proposals.length > 0 ? "Предложения разобраны" : "Предложений нет"}
                  description={
                    proposals.length > 0
                      ? "Вы скрыли все предложения. Нажмите «Пересобрать», чтобы вернуть их."
                      : "Как только появятся согласованные заказы без рейса, помощник соберёт из них рейсы."
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
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {anchorBuild ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2">
                    <p className="text-[12.5px] text-foreground/90">
                      Собрано вокруг:{" "}
                      <span className="font-medium">
                        {anchorOrder?.clientName?.trim() || shortCity(anchorOrder?.routeFrom)}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setAnchorId(null)
                        setRadiusKm(0)
                        setAnchorPanel(false)
                      }}
                      className="shrink-0 text-[12.5px] font-medium text-primary"
                    >
                      Сбросить
                    </button>
                  </div>
                ) : null}
                {visible.map((proposal) => {
                  const { vehicle, driver } = crewFor(proposal)
                  const expanded = open === proposal.id
                  // «Не влезает» — это когда под груз нет ни одной подходящей машины
                  const tooHeavy = vehiclesForCargo(proposal.weightKg, proposal.volumeM3, vehicles).length === 0

                  return (
                    <Card key={proposal.id} className={proposal.urgent ? "border-warning/30" : ""}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[15.5px] font-semibold leading-snug text-foreground">{proposal.name}</p>
                          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{proposalLine(proposal)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setHidden((prev) => [...prev, proposal.id])}
                          aria-label="Скрыть предложение"
                          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground active:opacity-70"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {proposal.urgent ? (
                        <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-warning/10 px-2 py-1 text-[12px] text-warning">
                          <AlertTriangle className="h-3.5 w-3.5" /> {proposal.deadlineText}
                        </p>
                      ) : null}

                      {/* Деньги рейса: выручка, топливо, прибыль.
                          Логист решает «взять или отказаться» по этой строке,
                          поэтому она идёт сразу после названия, а не внизу. */}
                      {proposal.profitRub !== null && proposal.fuelCostRub !== null ? (
                        <div
                          className={`mt-2.5 rounded-xl px-3 py-2 ${
                            proposal.unprofitable ? "bg-destructive/10" : "bg-success/10"
                          }`}
                        >
                          <p className="text-[14px] font-semibold text-foreground">
                            {proposal.unprofitable ? "Убыток " : "Прибыль ≈ "}
                            <span className={proposal.unprofitable ? "text-destructive" : "text-success"}>
                              {formatMoney(Math.abs(proposal.profitRub))}
                            </span>
                          </p>
                          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                            Выручка {formatMoney(proposal.revenue)} − топливо{" "}
                            {formatMoney(proposal.fuelCostRub)}
                            {proposal.fuelLiters !== null ? ` (${proposal.fuelLiters} л` : ""}
                            {proposal.distanceKm > 0 ? ` на ${proposal.distanceKm} км)` : ")"}
                            {proposal.profitPerKm !== null ? ` · ${proposal.profitPerKm} ₽/км` : ""}
                          </p>
                        </div>
                      ) : proposal.needsFuelSetup ? (
                        <div className="mt-2.5 rounded-xl bg-secondary/50 px-3 py-2">
                          <p className="text-[12px] leading-snug text-muted-foreground">
                            Прибыль не считаем: у машины {crewFor(proposal).vehicle?.plate ?? ""} не заполнен
                            расход топлива.
                          </p>
                          <Link
                            href="/lm/fleet"
                            className="mt-1.5 inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-[12.5px] font-medium text-primary active:opacity-70"
                          >
                            <Fuel className="h-3.5 w-3.5" /> Заполнить расход
                          </Link>
                        </div>
                      ) : null}

                      {/* Что осталось за бортом и почему — только для сборки
                          от опорного заказа: молча пропадать ничего не должно. */}
                      {anchorBuild && proposal.id === anchorBuild.proposal.id && anchorBuild.excluded.length > 0 ? (
                        <div className="mt-2.5 rounded-xl bg-secondary/40 px-3 py-2.5">
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
                                {shortCity(entry.order.routeFrom)} → {shortCity(entry.order.routeTo)} —{" "}
                                {entry.reason}
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

                      {/* Обратная загрузка: чем занять машину на обратном плече.
                          Без неё машина возвращается пустой — это чистый убыток. */}
                      {proposal.backload ? (
                        <div className="mt-2.5 rounded-xl border border-success/25 bg-success/[0.07] px-3 py-2.5">
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
                              Вместе с основным грузом в эту машину уже не влезает — нужна вторая машина
                              или часть заказов в другой рейс.
                            </p>
                          ) : null}
                          <div className="mt-1.5 space-y-1">
                            {proposal.backload.orders.map((order) => {
                              const tel = telHref(order.clientPhone ?? order.clientContact ?? null)
                              return (
                                <div
                                  key={order.id}
                                  className="flex items-center gap-2 rounded-lg bg-card shadow-sm px-2.5 py-2"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[12.5px] text-foreground">
                                      {order.clientName?.trim() || shortCity(order.routeFrom)}
                                    </span>
                                    <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                                      {shortCity(order.routeFrom)}
                                      <ArrowRight className="h-3 w-3" />
                                      {shortCity(order.routeTo)}
                                      {order.weight ? <span>· {formatWeightKg(order.weight)}</span> : null}
                                      {order.agreedPrice || order.price ? (
                                        <span>· {formatMoney(order.agreedPrice ?? order.price)}</span>
                                      ) : null}
                                    </span>
                                  </span>
                                  {tel ? (
                                    <a
                                      href={tel}
                                      className="flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-success/15 px-3 text-[12.5px] font-medium text-success active:opacity-70"
                                    >
                                      <Phone className="h-3.5 w-3.5" /> Позвонить
                                    </a>
                                  ) : (
                                    <Link
                                      href={`/lm/orders/${order.id}`}
                                      className="flex min-h-[38px] shrink-0 items-center rounded-xl bg-secondary px-3 text-[12.5px] text-foreground/90 active:opacity-70"
                                    >
                                      Открыть
                                    </Link>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                            Позвоните клиентам и согласуйте груз на обратную дорогу — потом добавьте заказы
                            в рейс из его карточки.
                          </p>
                        </div>
                      ) : null}

                      {/* Почему собрали именно так */}
                      <ul className="mt-2.5 space-y-1">
                        {proposal.reasons.map((reason) => (
                          <li key={reason} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-muted-foreground">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-secondary" />
                            {reason}
                          </li>
                        ))}
                      </ul>

                      {/* Состав: свернуто — первые три, развёрнуто — все */}
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : proposal.id)}
                        className="mt-2.5 inline-flex min-h-[36px] items-center gap-1.5 text-[12.5px] font-medium text-primary"
                      >
                        {expanded ? "Свернуть состав" : `Показать заказы (${proposal.orders.length})`}
                      </button>

                      <div className="mt-1 space-y-1.5">
                        {(expanded ? proposal.orders : proposal.orders.slice(0, 3)).map((order) => {
                          const tel = telHref(order.clientPhone ?? order.clientContact ?? null)
                          return (
                            <div
                              key={order.id}
                              className="flex items-center gap-2 rounded-xl bg-card shadow-sm px-2.5 py-2"
                            >
                              <Link href={`/lm/orders/${order.id}`} className="flex min-w-0 flex-1 items-start gap-2 active:opacity-70">
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
                                  aria-label={`Позвонить: ${order.clientName || shortCity(order.routeFrom)}`}
                                  className="flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-success/15 px-3 text-[12.5px] font-medium text-success active:opacity-70"
                                >
                                  <Phone className="h-3.5 w-3.5" /> Позвонить
                                </a>
                              ) : null}
                            </div>
                          )
                        })}
                        {!expanded && proposal.orders.length > 3 ? (
                          <p className="px-1 text-[12px] text-muted-foreground">
                            и ещё {proposal.orders.length - 3} {plural(proposal.orders.length - 3, ["заказ", "заказа", "заказов"])}
                          </p>
                        ) : null}
                      </div>

                      {tooHeavy ? (
                        <p className="mt-3 rounded-xl bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
                          Свободной машины под этот вес нет. Уберите часть заказов или добавьте машину в автопарк.
                        </p>
                      ) : null}

                      {/* Экипаж: помощник уже подобрал машину и водителя — можно поменять */}
                      <div className="mt-3 space-y-2 border-t border-border pt-3">
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

                        <p className="text-[12px] text-muted-foreground">Водитель (можно назначить потом)</p>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDriverChoice((prev) => ({ ...prev, [proposal.id]: "none" }))}
                            className={`rounded-md border px-3 py-1.5 text-[12.5px] ${
                              !driver ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-foreground/90"
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
                                <span className={`ml-1.5 ${active ? "" : meta.text}`}>· {meta.label.toLowerCase()}</span>
                              </button>
                            )
                          })}
                        </div>

                        {!vehicle && !driver ? (
                          <p className="rounded-xl bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
                            Свободной машины под этот груз сейчас нет. Рейс соберём без машины — назначите её
                            в карточке рейса, когда освободится.
                          </p>
                        ) : null}
                        {vehicle && !driver && driverOfVehicle(vehicle.id, drivers) ? (
                          <p className="rounded-xl bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
                            {vehicle.plate} закреплена за {driverOfVehicle(vehicle.id, drivers)?.name.split(" ")[0]} —
                            водителя назначите, когда он освободится.
                          </p>
                        ) : null}
                      </div>

                      {/* Сравнение «до/после» считается сервером и ничего не пишет в базу */}
                      <ProposalEtaComparison
                        orderIds={proposal.orders.map((order) => order.id)}
                        vehicleId={crewFor(proposal).vehicle?.id ?? null}
                      />

                      <button
                        type="button"
                        disabled={busy !== null || tooHeavy}
                        onClick={() => void propose(proposal)}
                        className="mt-3 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
                      >
                        {busy === proposal.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Truck className="h-4.5 w-4.5" />}
                        {busy === proposal.id ? "Предлагаю…" : "Предложить рейс"}
                      </button>
                      <p className="mt-1.5 text-center text-[12px] text-muted-foreground">
                        {tooHeavy
                          ? "Под этот вес машины в автопарке нет"
                          : driver
                            ? `Рейс создастся${vehicle ? ` на машине ${vehicle.plate}` : " без машины"} — водителю ${driver.name.split(" ")[0]} уйдёт уведомление`
                            : `Рейс создастся со статусом «Запланирован»${vehicle ? ` на машине ${vehicle.plate}` : " без машины"} — водителя назначите в карточке`}
                      </p>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* Биржа грузов: три примерно подходящих груза. ATI не отдаёт
                контакты под автоматическую сборку — показываем варианты,
                логист сам договаривается и берёт груз в работу. */}
            {user ? (
              <section className="mt-6 space-y-3">
                <div className="flex items-center justify-between gap-2 px-1">
                  <h2 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Грузы с биржи
                  </h2>
                  <button
                    type="button"
                    onClick={refreshExchangeLoads}
                    disabled={refreshingLoads}
                    className="flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] font-medium text-foreground/90 active:bg-secondary/60 disabled:opacity-60"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshingLoads ? "animate-spin" : ""}`} />
                    Обновить
                  </button>
                </div>

                {loadsState.error && !loadsState.data ? (
                  <ErrorState
                    message={loadsState.error}
                    onRetry={() => loadsState.reload()}
                  />
                ) : loadsState.loading && !loadsState.data ? (
                  <ListSkeleton rows={3} />
                ) : exchangeSuggestions.length === 0 ? (
                  <Card>
                    <div className="px-1 py-3">
                      <p className="text-[13px] font-medium text-foreground">
                        Подходящих грузов пока нет
                      </p>
                      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                        Помощник показывает грузы, которые влезают в ваши машины и
                        с озвученной ставкой. Попробуйте обновить биржу или загляните
                        позже — грузы на площадках меняются быстро.
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
                    <p className="px-1 text-[12px] leading-snug text-muted-foreground">
                      Три варианта «примерно подходящих» грузов: ATI не даёт
                      контакты под автоматическую сборку — позвоните фрахтователю,
                      договоритесь и возьмите груз в работу.
                    </p>
                    {exchangeSuggestions.map((suggestion) => (
                      <Card key={suggestion.load.id}>
                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[13.5px] font-semibold text-foreground">
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
                              <p className="text-[14px] font-semibold text-primary">
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
                            onClick={() => takeExchangeLoad(suggestion.load)}
                            disabled={takingLoad === suggestion.load.id}
                            full
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

            {/* Пусто совсем: заказов нет */}
            {!loading && proposals.length === 0 && readyCount === 0 && orders.length > 0 ? (
              <p className="mt-3 px-1 text-center text-[12.5px] text-muted-foreground">
                Всего заказов: {orders.length}. В сборку попадают только согласованные — те, где вы договорились
                о цене и условиях.
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
