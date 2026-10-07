// app/lm/orders/[id]/page.tsx — карточка заказа с действиями.
//
// Ключевая идея: всё, что логист делает по заказу с телефона, доступно на этом
// экране — позвонить клиенту, сменить этап, назначить водителя и машину.
// Разрешённые переходы берутся из lib/orders/stages.ts (тот же источник правды,
// что и на сервере), поэтому кнопки не предлагают заведомо невозможных действий.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowRight,
  Banknote,
  Building2,
  CalendarClock,
  Check,
  MessageCircle,
  Package,
  Phone,
  Truck,
  User,
  Weight,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { OrderStatusChip } from "@/components/logist-mobile/order-card"
import { ActionButton, Card, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { allowedOrderStatuses, orderStageLabel, orderStatusLabel } from "@/lib/orders/stages"
import {
  LOADING_TYPE_LABELS,
  PAYMENT_TYPE_LABELS,
  type MobileDriver,
  type MobileOrder,
  type MobileVehicle,
} from "@/lib/logist-mobile/types"
import { formatDateShort, formatDateTime, formatDeadline, formatMoney, formatWeightKg, shortCity, shortRef, telHref, whatsappHref } from "@/lib/logist-mobile/format"

/** Что означает переход — чтобы кнопка была понятной, а не «статус 7». */
function transitionLabel(status: string): string {
  const labels: Record<string, string> = {
    negotiation: "На согласование",
    agreed: "Согласован",
    in_route: "В рейс",
    documents: "На документы",
    assigned: "Назначить",
    control: "На контроль",
    delivered: "Доставлен",
    cancelled: "Отменить",
    rejected: "Отклонить",
    expired: "Неактуален",
    search: "Вернуть в поиск",
  }
  return labels[status] ?? orderStatusLabel(status)
}

function isFinal(status: string): boolean {
  return ["delivered", "cancelled", "rejected", "expired"].includes(status)
}

export default function LogistOrderPage() {
  const params = useParams<{ id: string }>()
  const orderId = params?.id
  const { user } = useStaffSession()

  const orderState = useJsonApi<{ order: MobileOrder }>(orderId ? `/api/orders/${orderId}` : null)
  const driversState = useJsonApi<{ drivers: MobileDriver[] }>(user ? "/api/drivers" : null)
  const vehiclesState = useJsonApi<{ vehicles: MobileVehicle[] }>(user ? "/api/vehicles" : null)

  const [busy, setBusy] = useState<string | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)

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

  const transitions = order ? allowedOrderStatuses(order.status) : []
  const forward = transitions.filter((status) => !["cancelled", "rejected", "expired"].includes(status))
  const closing = transitions.filter((status) => ["cancelled", "rejected"].includes(status))

  const deadline = formatDeadline(order?.deadline)

  async function changeStatus(status: string) {
    if (!orderId) return
    if (["cancelled", "rejected"].includes(status)) {
      const label = status === "cancelled" ? "Отменить заказ?" : "Отклонить заказ?"
      if (!window.confirm(`${label}\nДействие можно будет отменить только сменой статуса вручную.`)) return
    }
    setBusy(status)
    const result = await apiSend(`/api/orders/${orderId}`, "PATCH", { status })
    setBusy(null)
    if (!result.ok) {
      toast.error(result.error || "Не удалось изменить статус")
      return
    }
    toast.success(`Статус: ${orderStatusLabel(status)}`)
    orderState.reload()
  }

  async function assign(driverId: string | null, vehicleId: string | null) {
    if (!orderId) return
    setBusy("assign")
    const result = await apiSend(`/api/orders/${orderId}`, "PATCH", {
      assignedDriverId: driverId ?? "",
      assignedVehicleId: vehicleId ?? "",
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

  const clientPhone = order?.clientContact?.match(/\+?[\d\s()-]{10,}/)?.[0]?.trim() || null
  const tel = telHref(clientPhone)
  const wa = whatsappHref(clientPhone)

  return (
    <>
      <LogistHeader
        title={order ? shortCity(order.routeTo) : "Заказ"}
        subtitle={order ? orderStageLabel(order.status) : undefined}
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
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-white">
                    {order.clientName?.trim() || "Клиент не указан"}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-zinc-500">№ {shortRef(order.id)}</p>
                </div>
                <OrderStatusChip status={order.status} />
              </div>

              <div className="mt-3 flex items-center gap-2 text-[15px] font-medium text-white">
                <span className="truncate">{shortCity(order.routeFrom)}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />
                <span className="truncate">{shortCity(order.routeTo)}</span>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">
                {order.routeFrom} → {order.routeTo}
              </p>
              {order.distance ? <p className="mt-1 text-[12.5px] text-zinc-500">{order.distance} км</p> : null}
            </Card>

            {tel || wa ? (
              <div className="mt-3 grid grid-cols-2 gap-2.5">
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
            ) : null}

            {order.clientContact ? (
              <p className="mt-2 px-1 text-[12.5px] text-zinc-500">Контакт: {order.clientContact}</p>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Card>
                <p className="text-[12px] text-zinc-500">Цена</p>
                <p className="mt-0.5 text-[16px] font-semibold text-white">
                  {formatMoney(order.agreedPrice ?? order.price)}
                </p>
                {order.paymentType && PAYMENT_TYPE_LABELS[order.paymentType] ? (
                  <p className="mt-0.5 text-[12px] text-zinc-500">{PAYMENT_TYPE_LABELS[order.paymentType]}</p>
                ) : null}
              </Card>
              <Card>
                <p className="text-[12px] text-zinc-500">Срок</p>
                <p
                  className={`mt-0.5 text-[16px] font-semibold ${
                    deadline.overdue ? "text-red-300" : deadline.soon ? "text-amber-300" : "text-white"
                  }`}
                >
                  {deadline.text}
                </p>
                <p className="mt-0.5 text-[12px] text-zinc-500">{formatDateShort(order.deadline)}</p>
              </Card>
            </div>

            <Card className="mt-3">
              <div className="space-y-2.5 text-[13.5px]">
                <Row icon={<Package className="h-4 w-4" />} label="Груз" value={order.cargoType || "—"} />
                <Row icon={<Weight className="h-4 w-4" />} label="Вес" value={formatWeightKg(order.weight)} />
                {order.volume ? <Row icon={<Package className="h-4 w-4" />} label="Объём" value={`${order.volume} м³`} /> : null}
                {order.requirements ? (
                  <Row icon={<Building2 className="h-4 w-4" />} label="Требования" value={order.requirements} />
                ) : null}
                <Row
                  icon={<CalendarClock className="h-4 w-4" />}
                  label="Создан"
                  value={formatDateTime(order.createdAt)}
                />
                <Row
                  icon={<Banknote className="h-4 w-4" />}
                  label="Оплата"
                  value={order.isPaid ? "оплачен" : "не оплачен"}
                />
              </div>
            </Card>

            <Card className="mt-3">
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
                <a
                  href={telHref(driver.phone) || "#"}
                  className="mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white/8 text-[14px] font-medium text-white active:bg-white/12"
                >
                  <Phone className="h-4 w-4" /> Позвонить водителю
                </a>
              ) : null}

              {assignOpen ? (
                <div className="mt-3 space-y-3 border-t border-white/8 pt-3">
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
                      {drivers
                        .filter((item) => item.status !== "offline")
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

            {!isFinal(order.status) ? (
              <div className="mt-5">
                <p className="mb-2 text-[14px] font-semibold text-white">Что дальше</p>
                <div className="flex flex-wrap gap-2">
                  {forward.map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void changeStatus(status)}
                      className={`inline-flex min-h-[46px] items-center gap-2 rounded-xl px-4 text-[14px] font-medium disabled:opacity-40 ${
                        status === "delivered"
                          ? "bg-emerald-500/20 text-emerald-200"
                          : "bg-orange-500 text-white active:bg-orange-600"
                      }`}
                    >
                      {status === "delivered" ? <Check className="h-4 w-4" /> : null}
                      {busy === status ? "…" : transitionLabel(status)}
                    </button>
                  ))}
                </div>

                {closing.length > 0 ? (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {closing.map((status) => (
                      <ActionButton
                        key={status}
                        tone="danger"
                        disabled={busy !== null}
                        onClick={() => void changeStatus(status)}
                      >
                        {busy === status ? "…" : transitionLabel(status)}
                      </ActionButton>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-5 rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-[13px] text-zinc-500">
                Заказ закрыт: {orderStatusLabel(order.status)}. Вернуть в работу можно сменой статуса в полной версии.
              </p>
            )}

            <Link
              href={`/orders/${order.id}`}
              className="mt-3 block rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 text-center text-[13px] text-zinc-400"
            >
              Открыть в полной версии
            </Link>
          </>
        )}
      </div>
    </>
  )
}

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
