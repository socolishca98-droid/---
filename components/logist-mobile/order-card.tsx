// components/logist-mobile/order-card.tsx
//
// Карточка заказа для списков. Главное для логиста на телефоне: куда едем,
// чей груз, за сколько, какой срок и на каком этапе — всё без перехода внутрь.

"use client"

import Link from "next/link"
import { AlertTriangle, ArrowRight, CircleDollarSign, Clock } from "lucide-react"
import { orderStatusLabel } from "@/lib/orders/stages"
import {
  ORDER_STATUS_STYLES,
  PAYMENT_TYPE_LABELS,
  type MobileOrder,
} from "@/lib/logist-mobile/types"
import {
  formatDeadline,
  formatMoney,
  formatWeightKg,
  orderTitle,
  routeTitle,
  shortCity,
} from "@/lib/logist-mobile/format"

/** Цветной чип статуса заказа. */
export function OrderStatusChip({ status, className = "" }: { status: string; className?: string }) {
  const style = ORDER_STATUS_STYLES[status] ?? ORDER_STATUS_STYLES.search
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${style} ${className}`}
    >
      {orderStatusLabel(status)}
    </span>
  )
}

export function OrderCard({ order }: { order: MobileOrder }) {
  const deadline = formatDeadline(order.deadline)
  const price = order.agreedPrice ?? order.price
  const isClosed = ["delivered", "cancelled", "rejected", "expired"].includes(order.status)

  return (
    <Link
      href={`/lm/orders/${order.id}`}
      className="block rounded-2xl border border-white/8 bg-white/[0.03] p-4 active:bg-white/[0.06]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate text-[15px] font-semibold ${isClosed ? "text-zinc-400" : "text-white"}`}>
            {orderTitle(order)}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-zinc-400">
            {shortCity(order.routeFrom)}
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
            {shortCity(order.routeTo)}
          </p>
        </div>
        <OrderStatusChip status={order.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <CircleDollarSign className="h-3.5 w-3.5 text-zinc-500" />
          {price ? formatMoney(price) : "цена не задана"}
        </span>
        <span>{order.cargoType || "груз"}</span>
        {order.weight ? <span>{formatWeightKg(order.weight)}</span> : null}
        {order.distance ? <span>{order.distance} км</span> : null}
      </div>

      {!isClosed ? (
        <div
          className={`mt-2.5 inline-flex items-center gap-1.5 text-[12px] ${
            deadline.overdue ? "text-red-300" : deadline.soon ? "text-amber-300" : "text-zinc-500"
          }`}
        >
          {deadline.overdue ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
          {deadline.text}
          {order.paymentType && PAYMENT_TYPE_LABELS[order.paymentType] ? (
            <span className="text-zinc-600">· {PAYMENT_TYPE_LABELS[order.paymentType]}</span>
          ) : null}
        </div>
      ) : null}
    </Link>
  )
}
