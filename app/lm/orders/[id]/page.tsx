// app/lm/orders/[id]/page.tsx — карточка заказа, которая ведёт за руку.
//
// Порядок экрана повторяет порядок работы логиста:
//   1. «Что дальше» — один понятный шаг с объяснением; остальные переходы
//      спрятаны в «другие действия», чтобы не выбирать из семи равных кнопок;
//   2. «Что мешает» — подсказки с кнопкой «исправить» (нет водителя, цены,
//      телефона или срока): каждая подсказка — это тап, а не упрёк;
//   3. этапы — где заказ в процессе, словами;
//   4. клиент — звонок, WhatsApp, адрес в навигатор и копирование адреса;
//   5. груз, деньги, исполнение и назначение машины.
//
// Разрешённые переходы берутся из lib/orders/stages.ts (тот же источник правды,
// что и на сервере), а тексты шагов — из lib/logist-mobile/order-flow.ts.

"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Info,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Pencil,
  Phone,
  Truck,
  User,
  Weight,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { OrderStatusChip } from "@/components/logist-mobile/order-card"
import { ConfirmSheet, Sheet } from "@/components/logist-mobile/sheet"
import { ActionButton, Card, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import {
  allowedOrderStatuses,
  orderStageLabel,
  orderStatusLabel,
  type OrderStatus,
} from "@/lib/orders/stages"
import {
  MOBILE_STAGE_TITLES,
  STATUS_CHANGE_HINTS,
  nextStep,
  orderChecks,
  orderSteps,
  progressLabel,
  type CheckFix,
} from "@/lib/logist-mobile/order-flow"
import {
  PAYMENT_TYPE_LABELS,
  type MobileDriver,
  type MobileOrder,
  type MobileVehicle,
} from "@/lib/logist-mobile/types"
import {
  formatDateShort,
  formatDateTime,
  formatDeadline,
  formatMoney,
  formatWeightKg,
  mapsHref,
  routeMapsHref,
  shortCity,
  shortRef,
  telHref,
  whatsappHref,
} from "@/lib/logist-mobile/format"

const FINAL = ["delivered", "cancelled", "rejected", "expired"]

function isFinal(status: string): boolean {
  return FINAL.includes(status)
}

export default function LogistOrderPage() {
  const params = useParams<{ id: string }>()
  const orderId = params?.id
  const { user } = useStaffSession()

  const orderState = useJsonApi<{ order: MobileOrder }>(orderId ? `/api/orders/${orderId}` : null)
  const driversState = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)
  const vehiclesState = useJsonApi<{ vehicles: MobileVehicle[] }>(user ? "/api/vehicles" : null)

  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<OrderStatus | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const order = orderState.data?.order ?? null
  const drivers = driversState.data?.drivers ?? []
  const vehicles = vehiclesState.data?.vehicles ?? []

  const driver = useMemo(
    () => drivers.find((item) => item.id === order?.assignedDriverId) ?? null,
    [drivers, order?.assignedDriverId],
  )
  const vehicle = useMemo(
    () => vehicles.find((item) => item.id === order?.assignedVehicleId) ?? null,
    [vehicles, order?.assignedVehicleId],
  )

  const step = order ? nextStep(order.status) : null
  const checks = order ? orderChecks(order) : []
  const transitions = order ? allowedOrderStatuses(order.status) : []
  const others = transitions.filter((item) => item !== step?.status && !["cancelled", "rejected"].includes(item))
  const closing = transitions.filter((item) => ["cancelled", "rejected"].includes(item))

  const steps = order ? orderSteps(order.status) : []
  const currentStep = steps.find((item) => item.state === "current")
  const deadline = formatDeadline(order?.deadline)
  const clientPhone = order?.clientContact?.match(/\+?[\d\s()-]{10,}/)?.[0]?.trim() || null
  const tel = telHref(clientPhone)
  const wa = whatsappHref(clientPhone)
  const fromMaps = mapsHref(order?.routeFrom)
  const toMaps = mapsHref(order?.routeTo)
  const routeMaps = routeMapsHref(order?.routeFrom, order?.routeTo)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function changeStatus(target: OrderStatus) {
    if (!orderId) return
    setBusy(target)
    const result = await apiSend(`/api/orders/${orderId}`, "PATCH", { status: target })
    setBusy(null)
    setConfirm(null)

    if (!result.ok) {
      toast.error(result.error || "Не удалось изменить статус")
      return
    }
    // После смены сразу говорим, что делать дальше — чтобы не искать глазами
    const after = nextStep(target)
    toast.success(
      after ? `${orderStatusLabel(target)} · дальше: ${after.title.toLowerCase()}` : `${orderStatusLabel(target)} — работа закрыта`,
    )
    orderState.reload()
  }

  async function assign(driverId: string | null, vehicleId: string | null) {
    if (!orderId) return
    setBusy("assign")
    const result = await apiSend(`/api/orders/${orderId}`, "PATCH", {
      assignedDriverId: driverId ?? null,
      assignedVehicleId: vehicleId ?? null,
    })
    setBusy(null)
    if (!result.ok) {
      toast.error(result.error || "Не удалось назначить")
      return
    }
    toast.success("Назначение обновлено")
    setAssignOpen(false)
    orderState.reload()
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
    } catch {
      toast.error("Не удалось скопировать")
    }
  }

  /** Куда ведёт подсказка «чего не хватает». */
  function applyFix(fix: CheckFix) {
    if (fix === "assign") {
      setAssignOpen(true)
      document.getElementById("assign-block")?.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }
    setEditOpen(true)
  }

  return (
    <>
      <LogistHeader
        title={order ? `${shortCity(order.routeFrom)} → ${shortCity(order.routeTo)}` : "Заказ"}
        subtitle={
          order
            ? `${order.clientName?.trim() || "клиент не указан"} · № ${shortRef(order.id)}`
            : undefined
        }
        back
        userName={user?.name}
      />

      <div className="px-4 pt-4">
        {orderState.error ? (
          <ErrorState message={orderState.error} onRetry={orderState.reload} />
        ) : orderState.loading || !order ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
            {/* 1. Что дальше — главное действие экрана */}
            {isFinal(order.status) ? (
              <Card className="border-emerald-500/25 bg-emerald-500/[0.06]">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-emerald-200">
                  <CheckCircle2 className="h-4.5 w-4.5" />
                  Заказ закрыт: {orderStatusLabel(order.status).toLowerCase()}
                </p>
                <p className="mt-1 text-[13px] text-emerald-100/70">
                  Вернуть в работу можно из полной версии — на телефоне закрытые заказы не правят.
                </p>
              </Card>
            ) : step ? (
              <Card className="border-orange-500/25 bg-orange-500/[0.06]">
                <p className="text-[12px] uppercase tracking-wide text-orange-200/70">Что дальше</p>
                <p className="mt-1 text-[15px] font-semibold leading-snug text-white">{step.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">{step.why}</p>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirm(step.status)}
                  className={`mt-3 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold disabled:opacity-50 ${
                    step.tone === "success"
                      ? "bg-emerald-500/90 text-white active:bg-emerald-600"
                      : "bg-orange-500 text-white active:bg-orange-600"
                  }`}
                >
                  {step.tone === "success" ? <Check className="h-5 w-5" /> : null}
                  {step.title}
                </button>

                {others.length > 0 || closing.length > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setMoreOpen((value) => !value)}
                      aria-expanded={moreOpen}
                      className="mt-2 flex min-h-[40px] w-full items-center justify-center gap-1.5 text-[13px] font-medium text-zinc-400 active:text-zinc-200"
                    >
                      Другие действия
                      <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
                    </button>

                    {moreOpen ? (
                      <div className="mt-1 space-y-2 border-t border-white/8 pt-3">
                        {others.map((item) => (
                          <button
                            key={item}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setConfirm(item)}
                            className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-white/6 px-3.5 text-left text-[14px] text-zinc-100 active:bg-white/10 disabled:opacity-40"
                          >
                            {orderStatusLabel(item)}
                            <ArrowRight className="h-4 w-4 text-zinc-500" />
                          </button>
                        ))}
                        {closing.map((item) => (
                          <button
                            key={item}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setConfirm(item)}
                            className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-red-500/10 px-3.5 text-left text-[14px] text-red-200 active:bg-red-500/20 disabled:opacity-40"
                          >
                            {orderStatusLabel(item)}
                            <ArrowRight className="h-4 w-4 text-red-300/60" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </Card>
            ) : null}

            {/* 2. Что мешает — каждая подсказка с кнопкой «исправить» */}
            {checks.length > 0 ? (
              <div className="mt-3 space-y-2">
                {checks.map((check) => (
                  <div
                    key={check.id}
                    className={`flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 ${
                      check.tone === "warn"
                        ? "border-amber-500/25 bg-amber-500/[0.07]"
                        : "border-white/8 bg-white/[0.03]"
                    }`}
                  >
                    {check.tone === "warn" ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    ) : (
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                    )}
                    <p className={`flex-1 text-[13px] leading-snug ${check.tone === "warn" ? "text-amber-100" : "text-zinc-300"}`}>
                      {check.text}
                    </p>
                    {check.fix ? (
                      <button
                        type="button"
                        onClick={() => applyFix(check.fix as CheckFix)}
                        className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12.5px] font-medium text-white active:bg-white/15"
                      >
                        Исправить
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {/* 3. Этапы: где заказ сейчас */}
            <Card className="mt-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[14px] font-semibold text-white">Ход заказа</p>
                <p className="text-[12.5px] text-zinc-500">{progressLabel(order.status)}</p>
              </div>
              <ol className="mt-3 flex items-center">
                {steps.map((item, index) => (
                  <li key={item.stage} className="flex flex-1 items-center last:flex-none">
                    <span
                      title={item.title}
                      aria-label={item.title}
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                        item.state === "done"
                          ? "border-orange-500/40 bg-orange-500/20 text-orange-200"
                          : item.state === "current"
                            ? "border-orange-500 bg-orange-500 text-white"
                            : item.state === "closed"
                              ? "border-white/10 bg-white/5 text-zinc-500"
                              : "border-white/10 bg-white/[0.03] text-zinc-600"
                      }`}
                    >
                      {item.state === "done" ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    {index < 5 ? (
                      <span
                        className={`h-px flex-1 ${item.state === "done" ? "bg-orange-500/40" : "bg-white/10"}`}
                      />
                    ) : null}
                  </li>
                ))}
              </ol>
              <p className="mt-2.5 text-[12.5px] text-zinc-500">
                {currentStep
                  ? `Этап «${currentStep.title}» — дальше: ${step ? step.title.toLowerCase() : "работа завершена"}`
                  : "Заказ закрыт — этапы пройдены"}
              </p>
            </Card>

            {/* 4. Клиент: звонок, WhatsApp, навигатор */}
            <Card className="mt-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-white">
                    {order.clientName?.trim() || "Клиент не указан"}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-zinc-400">
                    {order.clientContact?.trim() || "контакт не указан"}
                  </p>
                </div>
                <OrderStatusChip status={order.status} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {tel ? (
                  <a
                    href={tel}
                    className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500/15 text-[14px] font-medium text-emerald-200 active:bg-emerald-500/25"
                  >
                    <Phone className="h-4 w-4" /> Позвонить
                  </a>
                ) : null}
                {wa ? (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-white/8 text-[14px] font-medium text-white active:bg-white/12"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                ) : null}
              </div>

              <div className="mt-3 space-y-2 border-t border-white/8 pt-3">
                <AddressRow
                  label="Откуда"
                  address={order.routeFrom}
                  maps={fromMaps}
                  copied={copied === "from"}
                  onCopy={() => void copy(order.routeFrom, "from")}
                />
                <AddressRow
                  label="Куда"
                  address={order.routeTo}
                  maps={toMaps}
                  copied={copied === "to"}
                  onCopy={() => void copy(order.routeTo, "to")}
                />
                <div className="border-t border-white/8 pt-3">
                  {routeMaps ? (
                    <a
                      href={routeMaps}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-sky-500/15 text-[14px] font-medium text-sky-200 active:bg-sky-500/25"
                    >
                      <Navigation className="h-4 w-4" /> Маршрут в навигаторе
                    </a>
                  ) : null}
                  {order.distance ? (
                    <p className="mt-1.5 text-[12.5px] text-zinc-500">Расстояние: {order.distance} км</p>
                  ) : null}
                </div>
              </div>
            </Card>

            {/* 5. Груз и деньги */}
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Card>
                <p className="text-[12px] text-zinc-500">Цена</p>
                <p className="mt-0.5 text-[16px] font-semibold text-white">
                  {formatMoney(order.agreedPrice ?? order.price)}
                </p>
                {order.paymentType && PAYMENT_TYPE_LABELS[order.paymentType] ? (
                  <p className="mt-0.5 text-[12px] text-zinc-500">{PAYMENT_TYPE_LABELS[order.paymentType]}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-orange-400"
                >
                  <Pencil className="h-3 w-3" /> Изменить
                </button>
              </Card>
              <Card>
                <p className="text-[12px] text-zinc-500">Срок выгрузки</p>
                <p
                  className={`mt-0.5 text-[16px] font-semibold ${
                    deadline.overdue ? "text-red-300" : deadline.soon ? "text-amber-300" : "text-white"
                  }`}
                >
                  {deadline.text}
                </p>
                <p className="mt-0.5 text-[12px] text-zinc-500">{formatDateShort(order.deadline)}</p>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-orange-400"
                >
                  <Pencil className="h-3 w-3" /> Изменить
                </button>
              </Card>
            </div>

            <Card className="mt-3">
              <div className="space-y-2.5 text-[13.5px]">
                <Row icon={<Package className="h-4 w-4" />} label="Груз" value={order.cargoType || "—"} />
                <Row icon={<Weight className="h-4 w-4" />} label="Вес" value={formatWeightKg(order.weight)} />
                {order.volume ? <Row icon={<Package className="h-4 w-4" />} label="Объём" value={`${order.volume} м³`} /> : null}
                {order.requirements ? (
                  <Row icon={<ClipboardList className="h-4 w-4" />} label="Требования" value={order.requirements} />
                ) : null}
                <Row icon={<CalendarClock className="h-4 w-4" />} label="Создан" value={formatDateTime(order.createdAt)} />
                <Row icon={<Banknote className="h-4 w-4" />} label="Оплата" value={order.isPaid ? "оплачен" : "не оплачен"} />
                <Row icon={<Package className="h-4 w-4" />} label="Этап" value={orderStageLabel(order.status)} />
              </div>
            </Card>

            {/* 6. Исполнение: водитель, машина, рейс */}
            <div id="assign-block" className="mt-3">
            <Card>
              <div className="flex items-center justify-between">
                <p className="text-[14px] font-semibold text-white">Исполнение</p>
                <button
                  type="button"
                  onClick={() => setAssignOpen((value) => !value)}
                  className="text-[13px] font-medium text-orange-400"
                >
                  {assignOpen ? "Закрыть" : "Изменить"}
                </button>
              </div>

              <div className="mt-2.5 space-y-2 text-[13.5px]">
                <Row
                  icon={<User className="h-4 w-4" />}
                  label="Водитель"
                  value={driver?.name || (order.assignedDriverId ? "назначен" : "не назначен")}
                />
                <Row
                  icon={<Truck className="h-4 w-4" />}
                  label="Машина"
                  value={vehicle?.plate || (order.assignedVehicleId ? "назначена" : "не назначена")}
                />
                {order.routeId ? (
                  <Row icon={<Package className="h-4 w-4" />} label="Рейс" value={`№ ${shortRef(order.routeId)}`} />
                ) : null}
              </div>

              {driver?.phone ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <a
                    href={telHref(driver.phone) || "#"}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white/8 text-[14px] font-medium text-white active:bg-white/12"
                  >
                    <Phone className="h-4 w-4" /> Водителю
                  </a>
                  <Link
                    href={`/lm/chat/${driver.id}`}
                    className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white/8 text-[14px] font-medium text-white active:bg-white/12"
                  >
                    <MessageCircle className="h-4 w-4" /> В чат
                  </Link>
                </div>
              ) : null}

              {assignOpen ? (
                <div className="mt-3 space-y-3 border-t border-white/8 pt-3">
                  <p className="text-[12.5px] leading-relaxed text-zinc-500">
                    Свободные водители сверху. Машина подставляется вместе с водителем, но её можно
                    выбрать отдельно.
                  </p>
                  <div>
                    <p className="mb-1.5 text-[12.5px] text-zinc-500">Водитель</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void assign(null, order.assignedVehicleId)}
                        className="rounded-full border border-white/10 px-3 py-1.5 text-[13px] text-zinc-300"
                      >
                        снять
                      </button>
                      {[...drivers]
                        .sort((a, b) => Number(a.status === "offline") - Number(b.status === "offline"))
                        .map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => void assign(item.id, order.assignedVehicleId)}
                            className={`rounded-full border px-3 py-1.5 text-[13px] ${
                              item.id === order.assignedDriverId
                                ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                                : "border-white/10 text-zinc-200"
                            }`}
                          >
                            {item.name.split(" ")[0]}
                            {item.vehiclePlate ? ` · ${item.vehiclePlate}` : ""}
                            {item.status === "offline" ? " · не на связи" : ""}
                          </button>
                        ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-[12.5px] text-zinc-500">Машина</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void assign(order.assignedDriverId, null)}
                        className="rounded-full border border-white/10 px-3 py-1.5 text-[13px] text-zinc-300"
                      >
                        снять
                      </button>
                      {vehicles
                        .filter((item) => item.status !== "maintenance")
                        .map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => void assign(order.assignedDriverId, item.id)}
                            className={`rounded-full border px-3 py-1.5 text-[13px] ${
                              item.id === order.assignedVehicleId
                                ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                                : "border-white/10 text-zinc-200"
                            }`}
                          >
                            {item.plate}
                          </button>
                        ))}
                    </div>
                  </div>
                  {busy === "assign" ? <p className="text-[12.5px] text-zinc-500">Сохраняю…</p> : null}
                </div>
              ) : null}
            </Card>
            </div>

            <Link
              href={`/orders/${order.id}`}
              className="mt-3 block rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-center text-[13px] text-zinc-400"
            >
              Открыть в полной версии
            </Link>
          </>
        )}
      </div>

      {/* Подтверждение перехода — словами о последствиях, а не «изменить статус?» */}
      <ConfirmSheet
        open={confirm !== null}
        title={confirm ? `Перевести в «${orderStatusLabel(confirm)}»?` : ""}
        description={confirm ? STATUS_CHANGE_HINTS[confirm] : undefined}
        confirmLabel="Да, перевести"
        tone={confirm && ["cancelled", "rejected"].includes(confirm) ? "danger" : confirm === "delivered" ? "success" : "primary"}
        busy={busy !== null}
        onConfirm={() => confirm && void changeStatus(confirm)}
        onClose={() => setConfirm(null)}
      />

      {/* Быстрая правка: цена, телефон клиента и срок — то, из-за чего заказ стоит */}
      {order ? (
        <EditSheet
          key={editOpen ? "open" : "closed"}
          open={editOpen}
          order={order}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false)
            orderState.reload()
          }}
        />
      ) : null}
    </>
  )
}

function AddressRow({
  label,
  address,
  maps,
  copied,
  onCopy,
}: {
  label: string
  address: string
  maps: string | null
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[12px] text-zinc-500">
        <MapPin className="h-3.5 w-3.5" /> {label}
      </p>
      {/* Адрес на всю ширину: он должен читаться целиком, а кнопки — под ним */}
      <p className="mt-0.5 text-[14px] leading-snug text-zinc-100">{address}</p>
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Скопировать адрес: ${label}`}
          className="flex h-9 items-center rounded-lg bg-white/8 px-3 text-[12.5px] font-medium text-zinc-200 active:bg-white/12"
        >
          {copied ? "Скопировано" : "Копировать"}
        </button>
        {maps ? (
          <a
            href={maps}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Открыть в навигаторе: ${label}`}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 text-[12.5px] font-medium text-sky-200 active:bg-sky-500/25"
          >
            <Navigation className="h-3.5 w-3.5" /> Навигатор
          </a>
        ) : null}
      </div>
    </div>
  )
}

/** Шторка правки: цена, телефон клиента, срок. Сохраняем только изменённое. */
function EditSheet({
  open,
  order,
  onClose,
  onSaved,
}: {
  open: boolean
  order: MobileOrder
  onClose: () => void
  onSaved: () => void
}) {
  const [price, setPrice] = useState(String(order.agreedPrice ?? order.price ?? ""))
  const [contact, setContact] = useState(order.clientContact ?? "")
  const [deadline, setDeadline] = useState(
    order.deadline ? new Date(order.deadline).toISOString().slice(0, 10) : "",
  )
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const payload: Record<string, unknown> = {
      clientContact: contact.trim(),
    }
    const priceValue = price.replace(/[^\d]/g, "")
    if (priceValue) payload.price = Number(priceValue)
    if (deadline) payload.deadline = new Date(`${deadline}T18:00:00`).toISOString()

    const result = await apiSend(`/api/orders/${order.id}`, "PATCH", payload)
    setSaving(false)

    if (!result.ok) {
      toast.error(result.error || "Не удалось сохранить")
      return
    }
    toast.success("Заказ обновлён")
    onSaved()
  }

  return (
    <Sheet
      open={open}
      title="Уточнить заказ"
      description="Заполните то, чего не хватает: цена, телефон клиента, срок выгрузки."
      onClose={onClose}
    >
      <div className="space-y-2.5">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-zinc-500">Цена, ₽</span>
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder="38000"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-zinc-500">Телефон клиента</span>
          <input
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            inputMode="tel"
            placeholder="Петрова Ольга, +7 495 123-45-67"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-zinc-500">Выгрузить до</span>
          <input
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            className={`${inputClass} [color-scheme:dark]`}
          />
        </label>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-3 flex min-h-[50px] w-full items-center justify-center rounded-2xl bg-orange-500 text-[15px] font-semibold text-white active:bg-orange-600 disabled:opacity-50"
      >
        {saving ? "Сохраняю…" : "Сохранить"}
      </button>
    </Sheet>
  )
}

const inputClass =
  "min-h-[48px] w-full rounded-xl border border-white/8 bg-white/[0.04] px-3.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-orange-500/50 focus:outline-none"

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0 text-zinc-500">{icon}</span>
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="ml-auto min-w-0 text-right text-zinc-100">{value}</span>
    </div>
  )
}
