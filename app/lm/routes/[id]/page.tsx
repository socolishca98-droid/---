// app/lm/routes/[id]/page.tsx — карточка рейса.
//
// Логист на телефоне смотрит рейс, чтобы понять: кто в машине, в каком порядке
// точки и что с заказами. Поэтому здесь список заказов по последовательности
// (как их везти) и обе кнопки связи — с водителем и с клиентом.

"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowRight, Clock, MessageCircle, Phone, Truck, User } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { OrderStatusChip } from "@/components/logist-mobile/order-card"
import { Card, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import { ROUTE_STATUS_META, type MobileRoute } from "@/lib/logist-mobile/types"
import {
  formatDateTime,
  formatMoney,
  formatWeightKg,
  shortCity,
  telHref,
  whatsappHref,
} from "@/lib/logist-mobile/format"

export default function LogistRoutePage() {
  const params = useParams<{ id: string }>()
  const routeId = params?.id
  const { user } = useStaffSession()

  const { data, error, loading, reload } = useJsonApi<{ route: MobileRoute }>(
    routeId ? `/api/routes/${routeId}` : null,
  )
  const route = data?.route ?? null
  const meta = ROUTE_STATUS_META[route?.status ?? "planned"] ?? ROUTE_STATUS_META.planned

  const driverTel = telHref(route?.driver?.phone)
  const driverWa = whatsappHref(route?.driver?.phone)

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
                <Metric label="заказов" value={String(route.orders?.length ?? 0)} />
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

              {driverTel || driverWa ? (
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  {driverTel ? (
                    <a
                      href={driverTel}
                      className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-500/15 text-[14px] font-medium text-emerald-200 active:bg-emerald-500/25"
                    >
                      <Phone className="h-4 w-4" /> Позвонить
                    </a>
                  ) : null}
                  {driverWa ? (
                    <a
                      href={driverWa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-white/8 text-[14px] font-medium text-white active:bg-white/12"
                    >
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  ) : null}
                </div>
              ) : null}
            </Card>

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
