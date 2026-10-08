// app/lm/routes/[id]/page.tsx — карточка рейса.
//
// Логист на телефоне смотрит рейс, чтобы понять: кто в машине, в каком порядке
// точки и что с заказами. Поэтому здесь список заказов по последовательности
// (как их везти) и обе кнопки связи — с водителем и с клиентом.

"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight, Clock, Loader2, MessageCircle, Phone, Truck, User } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { OrderStatusChip } from "@/components/logist-mobile/order-card"
import { Card, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
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
  formatDateTime,
  formatMoney,
  formatWeightKg,
  shortCity,
  telHref,
  whatsappHref,
  plural,
} from "@/lib/logist-mobile/format"

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

  /** Согласовать рейс: отдать водителю. Он получает уведомление, рейс — в работе. */
  async function handOver(driver: MobileDriver) {
    if (!route) return
    setBusy(true)
    const result = await apiSend(`/api/routes/${route.id}`, "PATCH", {
      driverId: driver.id,
      ...(route.status === "planned" ? { status: "active" } : {}),
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

  return (
    <>
      <LogistHeader
        title={route?.name || "Рейс"}
        subtitle={
          route ? `${meta.label}${route.driver?.name ? ` · ${route.driver.name}` : ""}` : undefined
        }
        back
        userName={user?.name}
      />

      <div className="px-4 pt-4">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading || !route ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-[16px] font-semibold leading-snug text-white">
                  {route.name || "Рейс"}
                </p>
                <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.style}`}>
                  {meta.label}
                </span>
              </div>

              {route.notes ? <p className="mt-2 text-[13px] text-zinc-400">{route.notes}</p> : null}

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Metric
                  label={plural(route.orders?.length ?? 0, ["заказ", "заказа", "заказов"])}
                  value={String(route.orders?.length ?? 0)}
                />
                <Metric label="км" value={route.stats?.totalDistance ? String(route.stats.totalDistance) : "—"} />
                <Metric label="вес" value={formatWeightKg(route.stats?.cargoWeight)} />
              </div>

              {route.economics?.revenueRub ? (
                <p className="mt-3 text-[13px] text-zinc-400">
                  Выручка рейса: <span className="text-white">{formatMoney(route.economics.revenueRub)}</span>
                </p>
              ) : null}
            </Card>

            <Card className="mt-3">
              <p className="text-[14px] font-semibold text-white">Экипаж</p>
              <div className="mt-2.5 space-y-2 text-[13.5px]">
                <div className="flex items-center gap-2.5">
                  <User className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="text-zinc-400">Водитель</span>
                  <span className="ml-auto text-right text-zinc-100">
                    {route.driver?.name || "не назначен"}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Truck className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="text-zinc-400">Машина</span>
                  <span className="ml-auto text-right text-zinc-100">
                    {route.vehicle ? `${route.vehicle.plate}${route.vehicle.type ? ` · ${route.vehicle.type}` : ""}` : "не назначена"}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Clock className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="text-zinc-400">Старт</span>
                  <span className="ml-auto text-right text-zinc-100">
                    {route.startedAt ? formatDateTime(route.startedAt) : "не начат"}
                  </span>
                </div>
              </div>

              {route.driver ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {driverTel ? (
                    <a
                      href={driverTel}
                      className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 text-[13.5px] font-medium text-emerald-200 active:bg-emerald-500/25"
                    >
                      <Phone className="h-4 w-4" /> Звонок
                    </a>
                  ) : null}
                  <Link
                    href={`/lm/chat/${route.driver.id}`}
                    className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl bg-white/8 text-[13.5px] font-medium text-white active:bg-white/12"
                  >
                    <MessageCircle className="h-4 w-4" /> Чат
                  </Link>
                  {driverWa ? (
                    <a
                      href={driverWa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl bg-white/8 text-[13.5px] font-medium text-white active:bg-white/12"
                    >
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  ) : null}
                </div>
              ) : null}
            </Card>

            {/* Согласование рейса: пока водителя нет, рейс никому не передан */}
            {needsApproval ? (
              <Card className="mt-3 border-amber-500/25 bg-amber-500/[0.06]">
                <p className="text-[15px] font-semibold text-white">Рейс собран — передайте водителю</p>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-300">
                  Выберите водителя: он получит уведомление и увидит рейс в приложении. Свободные — сверху.
                </p>
                {vehicleOwner ? (
                  <p className="mt-2 text-[12.5px] text-zinc-400">
                    {route.vehicle?.plate} закреплена за {vehicleOwner.name.split(" ")[0]} — передать можно ему.
                  </p>
                ) : null}
                {crewOptions.length === 0 ? (
                  <p className="mt-2 text-[12.5px] text-zinc-400">
                    Свободных водителей нет. Передайте рейс, когда кто-то освободится.
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {crewOptions.map((item) => {
                      const meta = DRIVER_STATUS_META[item.status] ?? DRIVER_STATUS_META.offline
                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={busy}
                          onClick={() => void handOver(item)}
                          className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-[13px] text-zinc-100 active:bg-white/10 disabled:opacity-40"
                        >
                          {item.name.split(" ")[0]}
                          {item.vehiclePlate ? ` · ${item.vehiclePlate}` : ""}
                          <span className={`ml-1.5 ${meta.text}`}>· {meta.label.toLowerCase()}</span>
                        </button>
                      )
                    })}
                </div>
                {busy ? (
                  <p className="mt-2 inline-flex items-center gap-2 text-[12.5px] text-zinc-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Передаю рейс…
                  </p>
                ) : null}
              </Card>
            ) : route.driver ? (
              <button
                type="button"
                onClick={() => setChangeDriver((value) => !value)}
                className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 text-[13px] font-medium text-orange-400"
              >
                {changeDriver ? "Отменить" : "Сменить водителя"}
              </button>
            ) : null}

            {changeDriver && route.driver ? (
              <Card className="mt-2">
                <p className="text-[12.5px] text-zinc-500">Передать рейс другому водителю</p>
                {crewOptions.filter((item) => item.id !== route.driver?.id).length === 0 ? (
                  <p className="mt-1.5 text-[12.5px] text-zinc-400">
                    {vehicleOwner
                      ? `Машина ${route.vehicle?.plate} закреплена за ${vehicleOwner.name.split(" ")[0]} — передать можно только ему.`
                      : "Свободных водителей нет."}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {crewOptions
                    .filter((item) => item.id !== route.driver?.id)
                    .map((item) => {
                      const meta = DRIVER_STATUS_META[item.status] ?? DRIVER_STATUS_META.offline
                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={busy}
                          onClick={() => void handOver(item)}
                          className="rounded-full border border-white/10 px-3 py-1.5 text-[13px] text-zinc-200 active:bg-white/10 disabled:opacity-40"
                        >
                          {item.name.split(" ")[0]}
                          <span className={`ml-1.5 ${meta.text}`}>· {meta.label.toLowerCase()}</span>
                        </button>
                      )
                    })}
                </div>
              </Card>
            ) : null}

            <h2 className="mb-2.5 mt-6 text-[15px] font-semibold text-white">
              Заказы в рейсе · {route.orders?.length ?? 0}
            </h2>
            <div className="space-y-2.5">
              {(route.orders ?? []).map((order, index) => (
                <Link
                  key={order.id}
                  href={`/lm/orders/${order.id}`}
                  className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3.5 active:bg-white/[0.06]"
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/8 text-[12px] font-semibold text-zinc-300">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-[14.5px] font-medium text-white">
                        {order.clientName || shortCity(order.routeFrom)}
                      </span>
                      <OrderStatusChip status={order.status} />
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[12.5px] text-zinc-400">
                      {shortCity(order.routeFrom)}
                      <ArrowRight className="h-3.5 w-3.5 text-zinc-600" />
                      {shortCity(order.routeTo)}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-zinc-500">
                      {order.cargoType ? <span>{order.cargoType}</span> : null}
                      {order.weight ? <span>{formatWeightKg(order.weight)}</span> : null}
                      {order.agreedPrice || order.price ? (
                        <span>{formatMoney(order.agreedPrice ?? order.price)}</span>
                      ) : null}
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
    <div className="rounded-xl bg-white/[0.04] py-2">
      <p className="text-[15px] font-semibold text-white">{value}</p>
      <p className="text-[11.5px] text-zinc-500">{label}</p>
    </div>
  )
}
