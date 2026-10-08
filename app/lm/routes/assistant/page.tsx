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
  Loader2,
  Package,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
  Truck,
  User,
  X,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, EmptyState, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import {
  assignableDrivers,
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
import { formatMoney, formatWeightKg, shortCity } from "@/lib/logist-mobile/format"

export default function RouteAssistantPage() {
  const router = useRouter()
  const { user } = useStaffSession()

  const ordersState = useJsonApi<{ orders: MobileOrder[] }>(user ? "/api/orders?limit=200" : null)
  const vehiclesState = useJsonApi<{ vehicles: AssistantVehicle[] }>(user ? "/api/vehicles" : null)
  const driversState = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)

  const [hidden, setHidden] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  /** Что логист поменял руками: своя машина и водитель на предложение */
  const [vehicleChoice, setVehicleChoice] = useState<Record<string, string>>({})
  const [driverChoice, setDriverChoice] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)

  const orders = (ordersState.data?.orders ?? []) as AssistantOrder[]
  const vehicles = vehiclesState.data?.vehicles ?? []
  const drivers = driversState.data?.drivers ?? []

  const loading = ordersState.loading || vehiclesState.loading
  const error = ordersState.error || vehiclesState.error

  const proposals = useMemo(() => buildRouteProposals(orders, vehicles), [orders, vehicles])
  const visible = proposals.filter((proposal) => !hidden.includes(proposal.id))
  const readyCount = orders.filter((order) => !order.routeId && order.status === "agreed").length
  const summary = proposalSummary(proposals, readyCount)

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
            <Card className="border-orange-500/25 bg-orange-500/[0.06]">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-white">
                <Sparkles className="h-4.5 w-4.5 text-orange-300" />
                {summary.routes > 0
                  ? `Собрал ${summary.routes} ${plural(summary.routes, ["рейс", "рейса", "рейсов"])} из ${summary.orders} ${plural(summary.orders, ["заказа", "заказов", "заказов"])}`
                  : "Собирать пока нечего"}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">
                {summary.routes > 0
                  ? `Согласованные заказы, которые ещё не в рейсе. Проверьте состав и предложите рейс — дальше назначите водителя.`
                  : readyCount === 0
                    ? "Нет согласованных заказов без рейса. Заказ попадает сюда, когда вы согласовали условия в карточке заказа."
                    : "Все согласованные заказы уже разобраны по рейсам."}
              </p>
              {summary.routes > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-zinc-400">
                  <span>
                    Заказов в предложениях: <span className="text-white">{summary.orders}</span>
                  </span>
                  <span>
                    Выручка: <span className="text-white">{formatMoney(summary.revenue)}</span>
                  </span>
                  {summary.unplaced > 0 ? (
                    <span className="text-amber-200">Не разобрано: {summary.unplaced}</span>
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
                className="mt-3 inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-white/8 px-3.5 text-[13px] font-medium text-white active:bg-white/12"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Пересобрать
              </button>
            </Card>

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
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/8 px-4 text-[14px] font-medium text-white active:bg-white/12"
                    >
                      К заказам
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {visible.map((proposal) => {
                  const { vehicle, driver } = crewFor(proposal)
                  const expanded = open === proposal.id
                  // «Не влезает» — это когда под груз нет ни одной подходящей машины
                  const tooHeavy = vehiclesForCargo(proposal.weightKg, proposal.volumeM3, vehicles).length === 0

                  return (
                    <Card key={proposal.id} className={proposal.urgent ? "border-amber-500/30" : ""}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[15.5px] font-semibold leading-snug text-white">{proposal.name}</p>
                          <p className="mt-0.5 text-[12.5px] text-zinc-400">{proposalLine(proposal)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setHidden((prev) => [...prev, proposal.id])}
                          aria-label="Скрыть предложение"
                          className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-white/8"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {proposal.urgent ? (
                        <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-[12px] text-amber-200">
                          <AlertTriangle className="h-3.5 w-3.5" /> {proposal.deadlineText}
                        </p>
                      ) : null}

                      {/* Почему собрали именно так */}
                      <ul className="mt-2.5 space-y-1">
                        {proposal.reasons.map((reason) => (
                          <li key={reason} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-zinc-400">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                            {reason}
                          </li>
                        ))}
                      </ul>

                      {/* Состав: свернуто — первые три, развёрнуто — все */}
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : proposal.id)}
                        className="mt-2.5 inline-flex min-h-[36px] items-center gap-1.5 text-[12.5px] font-medium text-orange-400"
                      >
                        {expanded ? "Свернуть состав" : `Показать заказы (${proposal.orders.length})`}
                      </button>

                      <div className="mt-1 space-y-1.5">
                        {(expanded ? proposal.orders : proposal.orders.slice(0, 3)).map((order) => (
                          <Link
                            key={order.id}
                            href={`/lm/orders/${order.id}`}
                            className="flex items-start gap-2 rounded-xl bg-white/[0.03] px-2.5 py-2 active:bg-white/[0.06]"
                          >
                            <Package className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] text-zinc-100">
                                {order.clientName?.trim() || shortCity(order.routeFrom)}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1 text-[12px] text-zinc-500">
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
                        ))}
                        {!expanded && proposal.orders.length > 3 ? (
                          <p className="px-1 text-[12px] text-zinc-500">
                            и ещё {proposal.orders.length - 3} {plural(proposal.orders.length - 3, ["заказ", "заказа", "заказов"])}
                          </p>
                        ) : null}
                      </div>

                      {tooHeavy ? (
                        <p className="mt-3 rounded-xl bg-amber-500/[0.08] px-3 py-2 text-[12.5px] text-amber-100">
                          Свободной машины под этот вес нет. Уберите часть заказов или добавьте машину в автопарк.
                        </p>
                      ) : null}

                      {/* Экипаж: помощник уже подобрал машину и водителя — можно поменять */}
                      <div className="mt-3 space-y-2 border-t border-white/8 pt-3">
                        <p className="text-[12px] text-zinc-500">Машина</p>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setVehicleChoice((prev) => ({ ...prev, [proposal.id]: "none" }))}
                            className={`rounded-full border px-3 py-1.5 text-[12.5px] ${
                              !vehicle
                                ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                                : "border-white/10 text-zinc-300"
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
                                className={`rounded-full border px-3 py-1.5 text-[12.5px] ${
                                  active
                                    ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                                    : item.status === "available"
                                      ? "border-white/10 text-zinc-200"
                                      : "border-white/10 text-amber-200/70"
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

                        <p className="text-[12px] text-zinc-500">Водитель (можно назначить потом)</p>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDriverChoice((prev) => ({ ...prev, [proposal.id]: "none" }))}
                            className={`rounded-full border px-3 py-1.5 text-[12.5px] ${
                              !driver ? "border-orange-500/40 bg-orange-500/15 text-orange-300" : "border-white/10 text-zinc-300"
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
                                className={`rounded-full border px-3 py-1.5 text-[12.5px] ${
                                  active
                                    ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                                    : "border-white/10 text-zinc-200"
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
                          <p className="rounded-xl bg-amber-500/[0.08] px-3 py-2 text-[12.5px] text-amber-100">
                            Свободной машины под этот груз сейчас нет. Рейс соберём без машины — назначите её
                            в карточке рейса, когда освободится.
                          </p>
                        ) : null}
                        {vehicle && !driver && driverOfVehicle(vehicle.id, drivers) ? (
                          <p className="rounded-xl bg-amber-500/[0.08] px-3 py-2 text-[12.5px] text-amber-100">
                            {vehicle.plate} закреплена за {driverOfVehicle(vehicle.id, drivers)?.name.split(" ")[0]} —
                            водителя назначите, когда он освободится.
                          </p>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        disabled={busy !== null || tooHeavy}
                        onClick={() => void propose(proposal)}
                        className="mt-3 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-orange-500 text-[15px] font-semibold text-white active:bg-orange-600 disabled:opacity-40"
                      >
                        {busy === proposal.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Truck className="h-4.5 w-4.5" />}
                        {busy === proposal.id ? "Предлагаю…" : "Предложить рейс"}
                      </button>
                      <p className="mt-1.5 text-center text-[12px] text-zinc-500">
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

            {/* Пусто совсем: заказов нет */}
            {!loading && proposals.length === 0 && readyCount === 0 && orders.length > 0 ? (
              <p className="mt-3 px-1 text-center text-[12.5px] text-zinc-500">
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
