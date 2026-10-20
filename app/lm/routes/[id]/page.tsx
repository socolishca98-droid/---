// app/lm/routes/[id]/page.tsx — карточка рейса, собранная по блокам.
//
// Логист открывает рейс на телефоне и должен за десять секунд понять:
//   1) Дальше — что от меня требуется прямо сейчас (кнопка в один тап);
//   2) Маршрут — куда и в каком порядке едет машина;
//   3) Экипаж — кто везёт, с ним можно связаться звонком или в чате;
//   4) Деньги — сколько рейс принёс и сколько стоил, и на чём посчитано.
// Порядок блоков — это порядок работы: сначала действие, потом подробности.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  FileText,
  Fuel,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Truck,
  User,
  Wallet,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { OrderStatusChip } from "@/components/logist-mobile/order-card"
import { Card, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { RouteDocumentsDialog } from "@/components/routes/route-documents-dialog"
import {
  assignableDriversForVehicle,
  driverOfVehicle,
  sortDriversForAssignment,
} from "@/lib/logist-mobile/route-assistant"
import {
  DRIVER_STATUS_META,
  ROUTE_STATUS_META,
  type MobileDriver,
  type MobileRoute,
} from "@/lib/logist-mobile/types"
import {
  formatCount,
  formatDateTime,
  formatMoney,
  formatWeightKg,
  plural,
  routeMapsHref,
  shortCity,
  telHref,
  whatsappHref,
} from "@/lib/logist-mobile/format"
import {
  moneyBasisLabel,
  routeMoney,
  routeNextStep,
  routeOrderProgress,
  routeWaypoints,
  type RouteStep,
} from "@/lib/logist-mobile/route-flow"

/** Цвет шапки блока «Дальше»: тон готовой подсказки из route-flow. */
const STEP_TONE: Record<RouteStep["tone"], string> = {
  warn: "border-warning/40 bg-warning/10",
  accent: "border-primary/40 bg-primary/10",
  ok: "border-success/40 bg-success/10",
  muted: "",
}

const STEP_BADGE: Record<RouteStep["tone"], string> = {
  warn: "text-warning",
  accent: "text-primary",
  ok: "text-success",
  muted: "text-muted-foreground",
}

/** Значок блока «Дальше»: треугольник — мешает, стрелка — действуй, галочка — готово. */
function StepIcon({ tone }: { tone: RouteStep["tone"] }) {
  const className = "h-3.5 w-3.5 shrink-0"
  if (tone === "warn") return <AlertTriangle className={className} />
  if (tone === "ok") return <CheckCircle2 className={className} />
  if (tone === "muted") return <Ban className={className} />
  return <ArrowRight className={className} />
}

/** Деньги на километр: «200 ₽/км». */
function perKm(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽/км`
}

/** Виды расхода рейса — из EXPENSE_TYPES (lib/trips/history.ts). */
const EXPENSE_KIND_LABELS: { value: "fuel" | "toll" | "repair" | "other"; label: string }[] = [
  { value: "fuel", label: "Топливо" },
  { value: "toll", label: "Платная дорога" },
  { value: "repair", label: "Ремонт" },
  { value: "other", label: "Другое" },
]

export default function LogistRoutePage() {
  const params = useParams<{ id: string }>()
  const routeId = params?.id
  const { user } = useStaffSession()

  const { data, error, loading, reload } = useJsonApi<{ route: MobileRoute }>(
    routeId ? `/api/routes/${routeId}` : null,
  )
  const driversState = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)
  const [busy, setBusy] = useState(false)
  const [changeDriver, setChangeDriver] = useState(false)
  const [documentsOpen, setDocumentsOpen] = useState(false)
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseAmount, setExpenseAmount] = useState("")
  const [expenseType, setExpenseType] = useState<"fuel" | "toll" | "repair" | "other">("other")
  const [expenseNote, setExpenseNote] = useState("")
  const [expenseBusy, setExpenseBusy] = useState(false)

  const route = data?.route ?? null
  const drivers = driversState.data?.drivers ?? []
  const meta = ROUTE_STATUS_META[route?.status ?? "planned"] ?? ROUTE_STATUS_META.planned

  const driverTel = telHref(route?.driver?.phone)
  const driverWa = whatsappHref(route?.driver?.phone)
  const needsApproval = Boolean(route && !route.driver)
  // Машина закреплена за одним водителем: подбираем только тех, кого сервер примет
  const vehicleOwner = driverOfVehicle(route?.vehicle?.id, drivers)
  const crewOptions = route?.vehicle
    ? assignableDriversForVehicle(route.vehicle, drivers)
    : sortDriversForAssignment(drivers)

  /** Сколько точек ещё не закрыто — от этого зависит force при завершении. */
  const pendingPoints = Math.max(
    0,
    (route?.orders?.length ?? 0) - (route?.orders ?? []).filter((order) => ["delivered", "cancelled", "rejected", "expired"].includes(order.status)).length,
  )

  // Заказы, по которым согласие не достигнуто: переговоры проиграны или заказ
  // отклонён. Рейс с ними ехать не должен — рядом будет кнопка пересборки.
  const unagreedOrders = (route?.orders ?? []).filter(
    (order) =>
      order.negotiationStatus === "lost" ||
      order.status === "rejected" ||
      order.status === "cancelled",
  )

  /** Всё, что считает route-flow: шаг, маршрут, деньги, итоги. */
  const flow = useMemo(() => {
    if (!route) return null
    const input = {
      ...route,
      driverName: route.driver?.name ?? null,
      distanceKm: route.totalDistance ?? route.stats?.totalDistance ?? null,
    }
    const waypoints = routeWaypoints(route.orders ?? [], shortCity)
    return {
      step: routeNextStep(input),
      progress: routeOrderProgress(route.orders ?? []),
      waypoints,
      money: routeMoney(input),
      detailsHref: routeMapsHref(waypoints[0], waypoints[waypoints.length - 1]),
      load: formatWeightKg(route.stats?.cargoWeight),
    }
  }, [route])

  /**
   * Передать рейс водителю: он получает уведомление и видит точки в приложении.
   * Машина едет вместе с водителем — подставляем его машину, если у рейса
   * своей ещё нет. Статус не трогаем: выезд логист подтвердит отдельным шагом.
   */
  async function handOver(driver: MobileDriver) {
    if (!route) return
    setBusy(true)
    const vehicleId = route.vehicle?.id ?? driver.vehicleId ?? null
    const result = await apiSend(`/api/routes/${route.id}`, "PATCH", {
      driverId: driver.id,
      ...(vehicleId ? { vehicleId } : {}),
    })
    setBusy(false)

    if (!result.ok) {
      toast.error(result.error || "Не удалось передать рейс")
      return
    }
    toast.success(`${driver.name.split(" ")[0]} получил рейс — ушло уведомление`)
    setChangeDriver(false)
    reload()
  }

  /**
   * Кнопка следующего шага.
   *   «Подтвердить выезд» — фиксируем время старта (статус рейса «Назначен»);
   *   «Завершить рейс» — закрываем рейс тем же эндпоинтом, что и компьютерная
   *   версия: /complete закрывает незавершённые точки, освобождает водителя
   *   и машину и пишет событие в таймлайн.
   */
  /**
   * Пересборка рейса без заказов, по которым согласие не достигнуто.
   *
   * Логист собрал рейс из нескольких грузов, развёз предложения — и по части
   * из них клиенты не согласились. Рейс пересобирается сам: несогласованные
   * заказы убираются из рейса и возвращаются в общий пул, остальные
   * перенумеровываются без дыр.
   */
  async function rebuildWithoutUnagreed() {
    if (!route) return
    if (typeof window !== "undefined") {
      const names = unagreedOrders.map((order) => order.clientName || shortCity(order.routeFrom))
      const ok = window.confirm(
        `Убрать из рейса заказы без согласия (${unagreedOrders.length})?\n${names.join("\n")}\n\nОни вернутся в общий список — можно будет пересобрать.`,
      )
      if (!ok) return
    }
    setBusy(true)
    const result = await apiSend<{ removed?: unknown[]; message?: string }>(
      `/api/routes/${route.id}/rebuild`,
      "POST",
      {},
    )
    setBusy(false)

    if (!result.ok) {
      toast.error(result.error || "Не удалось пересобрать рейс")
      return
    }
    toast.success((result.data as { message?: string })?.message || "Рейс пересобран")
    reload()
  }

  /**
   * Расход рейса руками: тот же эндпоинт, что принимает чеки водителя
   * (POST /api/routes/[id]/expenses). Виды — из lib/trips/history.
   */
  async function addExpense() {
    if (!route) return
    const amount = Number(expenseAmount.replace(",", "."))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Введите сумму расхода")
      return
    }
    setExpenseBusy(true)
    const result = await apiSend<{ message?: string }>(
      `/api/routes/${route.id}/expenses`,
      "POST",
      {
        type: expenseType,
        amount,
        ...(expenseNote.trim() ? { note: expenseNote.trim() } : {}),
        source: "manual",
      },
    )
    setExpenseBusy(false)

    if (!result.ok) {
      toast.error(result.error || "Не удалось записать расход")
      return
    }
    toast.success((result.data as { message?: string })?.message || "Расход записан")
    setExpenseOpen(false)
    setExpenseAmount("")
    setExpenseNote("")
    reload()
  }

  async function runStep(step: RouteStep) {
    if (!route || !step.action) return
    if (typeof window !== "undefined" && !window.confirm(step.action.confirm)) return
    setBusy(true)

    const pending = step.action.kind === "finish" ? pendingPoints : 0
    const result =
      step.action.kind === "start"
        ? await apiSend(`/api/routes/${route.id}`, "PATCH", { status: "active" })
        : await apiSend(`/api/routes/${route.id}/complete`, "POST", { force: pending > 0 })

    setBusy(false)

    if (!result.ok) {
      toast.error(result.error || "Не получилось — попробуйте ещё раз")
      return
    }
    toast.success(step.action.done)
    reload()
  }

  return (
    <>
      <LogistHeader
        title={flow?.waypoints.length ? flow.waypoints.join(" → ") : route?.name || "Рейс"}
        subtitle={
          route ? `${meta.label}${route.driver?.name ? ` · ${route.driver.name}` : ""}` : undefined
        }
        back
        userName={user?.name}
      />

      <div className="px-4 pt-4">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading || !route || !flow ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
            {/* ── Шапка рейса: что это и на каком этапе ── */}
            <Card>
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-[16px] font-semibold leading-snug text-foreground">
                  {flow.waypoints.length > 0
                    ? flow.waypoints.join(" → ")
                    : route.name || "Рейс"}
                </p>
                <span
                  className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.style}`}
                >
                  {meta.label}
                </span>
              </div>

              {route.notes ? (
                <p className="mt-2 text-[13px] text-muted-foreground">{route.notes}</p>
              ) : null}

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Metric
                  label={plural(flow.progress.total, ["заказ", "заказа", "заказов"])}
                  value={String(flow.progress.total)}
                />
                <Metric
                  label="км"
                  value={
                    route.totalDistance ?? route.stats?.totalDistance
                      ? String(route.totalDistance ?? route.stats?.totalDistance)
                      : "—"
                  }
                />
                <Metric label="вес" value={flow.load} />
              </div>

            </Card>

            {/* ── Дальше: единственный следующий шаг и кнопка для него ── */}
            <Card className={`mt-3 ${STEP_TONE[flow.step.tone]}`}>
              <div className={`flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide ${STEP_BADGE[flow.step.tone]}`}>
                <StepIcon tone={flow.step.tone} />
                <span>Дальше</span>
              </div>
              <p className="mt-1 text-[15px] font-semibold text-foreground">{flow.step.label}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{flow.step.hint}</p>

              {flow.step.action ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runStep(flow.step)}
                  className={`mt-3 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl text-[14.5px] font-medium active:opacity-70 disabled:opacity-40 ${
                    flow.step.action.tone === "primary"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-secondary text-foreground"
                  }`}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? "Работаю…" : flow.step.action.label}
                </button>
              ) : null}

              {/* Документы рейса — открываем существующий диалог печати */}
              <button
                type="button"
                onClick={() => setDocumentsOpen(true)}
                className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary text-[13.5px] font-medium text-foreground active:opacity-70"
              >
                <FileText className="h-4 w-4" /> Документы
                <span className="text-muted-foreground">
                  ({route.orders?.length ?? 0}{" "}
                  {formatCount(route.orders?.length ?? 0, ["заказ", "заказа", "заказов"])})
                </span>
              </button>

              {/* Нет водителя — здесь же и выбор: не гоняем логиста по экрану */}
              {needsApproval ? (
                <div className="mt-3">
                  <p className="text-[12.5px] text-muted-foreground">
                    {vehicleOwner
                      ? `${route.vehicle?.plate} закреплена за ${vehicleOwner.name.split(" ")[0]} — передать можно ему.`
                      : "Выберите водителя: он получит уведомление и увидит рейс в приложении."}
                  </p>
                  {crewOptions.length === 0 ? (
                    <p className="mt-2 text-[12.5px] text-muted-foreground">
                      Свободных водителей нет. Передайте рейс, когда кто-то освободится.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {crewOptions.map((item) => {
                        const driverMeta = DRIVER_STATUS_META[item.status] ?? DRIVER_STATUS_META.offline
                        return (
                          <button
                            key={item.id}
                            type="button"
                            disabled={busy}
                            onClick={() => void handOver(item)}
                            className="rounded-md border border-border bg-secondary px-3 py-2 text-[13px] text-foreground active:opacity-70 disabled:opacity-40"
                          >
                            {item.name.split(" ")[0]}
                            {item.vehiclePlate ? ` · ${item.vehiclePlate}` : ""}
                            <span className={`ml-1.5 ${driverMeta.text}`}>· {driverMeta.label.toLowerCase()}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {busy ? (
                    <p className="mt-2 inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Передаю рейс…
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Card>

            {/* ── Маршрут: порядок точек так, как их везут ── */}
            {flow.waypoints.length > 0 ? (
              <Card className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[14px] font-semibold text-foreground">Маршрут</p>
                  <span className="text-[12px] text-muted-foreground">
                    {formatCount(flow.progress.total, ["точка", "точки", "точек"])}
                  </span>
                </div>

                <ol className="mt-2.5 space-y-2">
                  {flow.waypoints.map((point, index) => {
                    const last = index === flow.waypoints.length - 1
                    return (
                      <li key={`${point}-${index}`} className="flex items-start gap-2.5">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                            index === 0
                              ? "bg-primary/15 text-primary"
                              : last
                                ? "bg-success/15 text-success"
                                : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 text-[13.5px] text-foreground">
                          {point}
                          <span className="ml-1.5 text-[12px] text-muted-foreground">
                            {flow.waypoints.length === 1
                              ? "погрузка и выгрузка"
                              : index === 0
                                ? "погрузка"
                                : last
                                  ? "выгрузка"
                                  : "заезд"}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ol>

                <div className="mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {flow.progress.delivered === 0 && flow.progress.moving === 0
                    ? "Точки ещё не начаты — машина на погрузке"
                    : `Доставлено ${flow.progress.delivered} из ${flow.progress.total}${
                        flow.progress.moving > 0 ? ` · в пути ${flow.progress.moving}` : ""
                      }`}
                </div>

                {flow.detailsHref ? (
                  <a
                    href={flow.detailsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-secondary text-[13.5px] font-medium text-foreground active:opacity-70"
                  >
                    <Navigation className="h-4 w-4" /> Открыть маршрут в навигаторе
                  </a>
                ) : null}
              </Card>
            ) : null}

            {/* ── Экипаж: кто везёт + связь одним тапом ── */}
            <Card className="mt-3">
              <p className="text-[14px] font-semibold text-foreground">Экипаж</p>
              <div className="mt-2.5 space-y-2 text-[13.5px]">
                <div className="flex items-center gap-2.5">
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Водитель</span>
                  <span className="ml-auto text-right text-foreground">
                    {route.driver?.name || "не назначен"}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Машина</span>
                  <span className="ml-auto text-right text-foreground">
                    {route.vehicle
                      ? `${route.vehicle.plate}${route.vehicle.type ? ` · ${route.vehicle.type}` : ""}`
                      : "не назначена"}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">Старт</span>
                  <span className="ml-auto text-right text-foreground">
                    {route.startedAt ? formatDateTime(route.startedAt) : "не начат"}
                  </span>
                </div>
                {route.completedAt ? (
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    <span className="text-muted-foreground">Закрыт</span>
                    <span className="ml-auto text-right text-foreground">
                      {formatDateTime(route.completedAt)}
                    </span>
                  </div>
                ) : null}
              </div>

              {route.driver ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {driverTel ? (
                    <a
                      href={driverTel}
                      className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl bg-success/15 text-[13.5px] font-medium text-success active:opacity-70"
                    >
                      <Phone className="h-4 w-4" /> Звонок
                    </a>
                  ) : null}
                  <Link
                    href={`/lm/chat/${route.driver.id}`}
                    className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl bg-secondary text-[13.5px] font-medium text-foreground active:opacity-70"
                  >
                    <MessageCircle className="h-4 w-4" /> Чат
                  </Link>
                  {driverWa ? (
                    <a
                      href={driverWa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl bg-secondary text-[13.5px] font-medium text-foreground active:opacity-70"
                    >
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  ) : null}
                </div>
              ) : null}
            </Card>

            {/* Смена водителя у уже назначенного рейса */}
            {route.driver ? (
              <>
                <button
                  type="button"
                  onClick={() => setChangeDriver((value) => !value)}
                  className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 text-[13px] font-medium text-primary"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  {changeDriver ? "Отменить" : "Сменить водителя"}
                </button>

                {changeDriver ? (
                  <Card className="mt-2">
                    <p className="text-[12.5px] text-muted-foreground">Передать рейс другому водителю</p>
                    {crewOptions.filter((item) => item.id !== route.driver?.id).length === 0 ? (
                      <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                        {vehicleOwner
                          ? `Машина ${route.vehicle?.plate} закреплена за ${vehicleOwner.name.split(" ")[0]} — передать можно только ему.`
                          : "Свободных водителей нет."}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {crewOptions
                        .filter((item) => item.id !== route.driver?.id)
                        .map((item) => {
                          const driverMeta = DRIVER_STATUS_META[item.status] ?? DRIVER_STATUS_META.offline
                          return (
                            <button
                              key={item.id}
                              type="button"
                              disabled={busy}
                              onClick={() => void handOver(item)}
                              className="rounded-md border border-border px-3 py-1.5 text-[13px] text-foreground active:opacity-70 disabled:opacity-40"
                            >
                              {item.name.split(" ")[0]}
                              <span className={`ml-1.5 ${driverMeta.text}`}>· {driverMeta.label.toLowerCase()}</span>
                            </button>
                          )
                        })}
                    </div>
                  </Card>
                ) : null}
              </>
            ) : null}

            {/* ── Деньги: сколько принёс, сколько стоил, на чём посчитано ── */}
            <Card
              className={`mt-3 ${flow.money.unprofitable ? "border-destructive/40 bg-destructive/[0.06]" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-2 text-[14px] font-semibold text-foreground">
                  <Wallet className="h-4 w-4 text-muted-foreground" /> Деньги рейса
                </p>
                {flow.money.basis ? (
                  <span className="text-[11.5px] text-muted-foreground">
                    {moneyBasisLabel(flow.money.basis)}
                  </span>
                ) : null}
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
                <MoneyRow label="Выручка" value={formatMoney(flow.money.revenue)} />
                <MoneyRow
                  label="Расходы"
                  value={flow.money.cost === null ? "—" : formatMoney(flow.money.cost)}
                />
                <MoneyRow
                  label="Прибыль"
                  value={flow.money.profit === null ? "—" : formatMoney(flow.money.profit)}
                  tone={
                    flow.money.profit === null
                      ? "muted"
                      : flow.money.profit < 0
                        ? "destructive"
                        : "success"
                  }
                />
                <MoneyRow
                  label="На километр"
                  value={
                    flow.money.revenuePerKm === null
                      ? "—"
                      : `${perKm(flow.money.revenuePerKm)}${
                          flow.money.costPerKm === null ? "" : ` / ${perKm(flow.money.costPerKm)}`
                        }`
                  }
                />
              </div>

              {flow.money.unprofitable ? (
                <p className="mt-2.5 flex items-start gap-2 rounded-lg bg-destructive/12 px-2.5 py-1.5 text-[12.5px] font-medium text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Рейс убыточный: расходы больше выручки — проверьте чек и цену заказа
                </p>
              ) : null}

              {flow.money.withoutPrice > 0 ? (
                <p className="mt-2 text-[12.5px] text-warning">
                  {formatCount(flow.money.withoutPrice, ["заказ", "заказа", "заказов"])} без цены — в
                  выручку не попали
                </p>
              ) : null}

              {Array.isArray(route.expenses) && route.expenses.length > 0 ? (
                <p className="mt-2 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <Fuel className="h-3.5 w-3.5 shrink-0" />
                  Чеки водителя: {formatCount(route.expenses.length, ["чек", "чека", "чеков"])}
                  {route.fuelExpense ? ` · топливо ${formatMoney(route.fuelExpense)}` : ""}
                </p>
              ) : (
                <Link
                  href="/lm/fuel"
                  className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-primary active:opacity-70"
                >
                  <Fuel className="h-3.5 w-3.5" /> Расходов пока нет — открыть топливо и чеки
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}

              {/* Расход рейса руками — тот же эндпоинт, что и чеки водителя */}
              {expenseOpen ? (
                <div className="mt-2.5 space-y-2 rounded-lg border border-border p-2.5">
                  <div className="flex gap-1.5">
                    {EXPENSE_KIND_LABELS.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setExpenseType(item.value)}
                        className={`min-h-[36px] flex-1 rounded-md border px-2 text-[12.5px] font-medium active:opacity-70 ${
                          expenseType === item.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-secondary text-foreground"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      inputMode="decimal"
                      value={expenseAmount}
                      onChange={(event) => setExpenseAmount(event.target.value)}
                      placeholder="Сумма, ₽"
                      className="min-h-[44px] flex-1 rounded-lg border border-border bg-background px-3 text-[14px] text-foreground outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      disabled={expenseBusy}
                      onClick={() => void addExpense()}
                      className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
                    >
                      {expenseBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Записать
                    </button>
                  </div>
                  <input
                    value={expenseNote}
                    onChange={(event) => setExpenseNote(event.target.value)}
                    placeholder="Комментарий (необязательно)"
                    className="min-h-[40px] w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-primary"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setExpenseOpen(true)}
                  className="mt-2.5 flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-border text-[13.5px] font-medium text-foreground active:opacity-70"
                >
                  <Receipt className="h-4 w-4" /> Добавить расход
                </button>
              )}
            </Card>

            <RouteDocumentsDialog
              routeId={route.id}
              ordersCount={route.orders?.length ?? 0}
              open={documentsOpen}
              onOpenChange={setDocumentsOpen}
            />

            {/* ── Несогласованные заказы: рейс пересобирается без них ── */}
            {unagreedOrders.length > 0 ? (
              <div className="mt-6 rounded-xl border border-warning/30 bg-warning/[0.07] p-3.5">
                <p className="flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  Без согласия: {unagreedOrders.length}
                </p>
                <p className="mt-1 text-[12.5px] leading-snug text-foreground/90">
                  По этим заказам условия не согласованы. Рейс с ними ехать не должен —
                  пересоберите без них, заказы вернутся в общий список.
                </p>
                <ul className="mt-2 space-y-1">
                  {unagreedOrders.map((order) => (
                    <li key={order.id} className="text-[12.5px] text-foreground/90">
                      · {order.clientName || shortCity(order.routeFrom)} —{" "}
                      {shortCity(order.routeFrom)} → {shortCity(order.routeTo)}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void rebuildWithoutUnagreed()}
                  className="mt-2.5 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-warning text-[14px] font-semibold text-warning-foreground active:opacity-70 disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4.5 w-4.5" />
                  )}
                  Пересобрать без несогласованных
                </button>
              </div>
            ) : null}

            {/* ── Заказы в рейсе: в том порядке, в каком их везут ── */}
            <h2 className="mb-2.5 mt-6 text-[15px] font-semibold text-foreground">
              Заказы в рейсе · {flow.progress.total}
            </h2>
            <div className="space-y-2.5">
              {(route.orders ?? []).map((order, index) => (
                <Link
                  key={order.id}
                  href={`/lm/orders/${order.id}`}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card shadow-sm p-3.5 active:opacity-70"
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold text-foreground/90">
                    {order.routeSequence ?? index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-[14.5px] font-medium text-foreground">
                        {order.clientName || shortCity(order.routeFrom)}
                      </span>
                      <OrderStatusChip status={order.status} />
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                      {shortCity(order.routeFrom)}
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/80" />
                      {shortCity(order.routeTo)}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted-foreground">
                      {order.cargoType ? <span>{order.cargoType}</span> : null}
                      {order.weight ? <span>{formatWeightKg(order.weight)}</span> : null}
                      {order.agreedPrice || order.price ? (
                        <span>{formatMoney(order.agreedPrice ?? order.price)}</span>
                      ) : (
                        <span className="text-warning">цена не указана</span>
                      )}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary py-2">
      <p className="text-[15px] font-semibold text-foreground">{value}</p>
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
    </div>
  )
}

function MoneyRow({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "success" | "destructive" | "muted"
}) {
  const tones: Record<string, string> = {
    default: "text-foreground",
    success: "text-success",
    destructive: "text-destructive",
    muted: "text-muted-foreground",
  }
  return (
    <div>
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className={`text-[15px] font-semibold ${tones[tone]}`}>{value}</p>
    </div>
  )
}
