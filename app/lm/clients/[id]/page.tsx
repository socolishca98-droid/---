// app/lm/clients/[id]/page.tsx — карточка клиента.
//
// Что нужно логисту перед звонком клиенту: как зовут контактное лицо, телефон,
// как платят (отсрочка), сколько должны и что везли последний раз.

"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { Building2, ChevronRight, Mail, MapPin, MessageCircle, Phone, User } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, ErrorState, ListSkeleton, SectionTitle } from "@/components/logist-mobile/ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"
import type { MobileClient, MobileClientStats, MobileOrder } from "@/lib/logist-mobile/types"
import { ORDER_STATUS_STYLES } from "@/lib/logist-mobile/types"
import { ORDER_STATUS_LABELS } from "@/lib/orders/stages"
import {
  formatCount,
  formatDateShort,
  formatMoney,
  formatRelative,
  routeTitle,
  shortRef,
  telHref,
  whatsappHref,
} from "@/lib/logist-mobile/format"

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank: "На расчётный счёт",
  card: "Карта",
  cashless: "Безналичный расчёт",
}

const VAT_LABELS: Record<string, string> = {
  with_vat: "С НДС",
  no_vat: "Без НДС",
}

interface ClientDetail {
  success: boolean
  client: MobileClient
  stats: MobileClientStats
  orders: MobileOrder[]
}

export default function LogistClientPage() {
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === "string" ? params.id : null
  const { user } = useStaffSession()
  const { data, error, loading, reload } = useJsonApi<ClientDetail>(id ? `/api/clients/${id}` : null)

  const client = data?.client
  const stats = data?.stats
  const tel = telHref(client?.phone)
  const wa = whatsappHref(client?.phone)

  return (
    <>
      <LogistHeader title={client?.name ?? "Клиент"} subtitle={client?.inn ? `ИНН ${client.inn}` : undefined} back userName={user?.name} />

      <div className="px-4 pt-4">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : loading && !client ? (
          <ListSkeleton rows={4} />
        ) : !client ? (
          <Card>Клиент не найден</Card>
        ) : (
          <>
            {tel ? (
              <div className="grid grid-cols-2 gap-2.5">
                <a
                  href={tel}
                  className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-success/15 text-[14px] font-medium text-success active:opacity-70"
                >
                  <Phone className="h-4 w-4" /> Позвонить
                </a>
                {wa ? (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-secondary text-[14px] font-medium text-foreground active:opacity-70"
                  >
                    <MessageCircle className="h-4 w-4" /> WhatsApp
                  </a>
                ) : (
                  <Link
                    href="/lm/orders"
                    className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-secondary text-[14px] font-medium text-foreground active:opacity-70"
                  >
                    Заказы клиента
                  </Link>
                )}
              </div>
            ) : null}

            <Card className="mt-3 space-y-2">
              {client.contactName ? (
                <Line icon={<User className="h-4 w-4" />} label="Контакт" value={client.contactName} />
              ) : null}
              {client.phone ? <Line icon={<Phone className="h-4 w-4" />} label="Телефон" value={client.phone} /> : null}
              {client.email ? <Line icon={<Mail className="h-4 w-4" />} label="Почта" value={client.email} /> : null}
              {client.address ? (
                <Line icon={<MapPin className="h-4 w-4" />} label="Адрес" value={client.address} />
              ) : null}
              <Line
                icon={<Building2 className="h-4 w-4" />}
                label="Оплата"
                value={[
                  client.paymentType ? PAYMENT_TYPE_LABELS[client.paymentType] ?? client.paymentType : null,
                  client.vatType ? VAT_LABELS[client.vatType] ?? client.vatType : null,
                  client.deferredDays ? `отсрочка ${client.deferredDays} дн.` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </Card>

            {stats ? (
              <>
                <SectionTitle title="Деньги" />
                <div className="grid grid-cols-2 gap-2.5">
                  <Metric label="Выручка" value={formatMoney(stats.revenueRub)} />
                  <Metric label="Оплачено" value={formatMoney(stats.paidRub)} tone="good" />
                  <Metric
                    label={stats.overdueRub > 0 ? "Просрочено" : "Не оплачено"}
                    value={formatMoney(stats.overdueRub > 0 ? stats.overdueRub : stats.unpaidRub)}
                    tone={stats.overdueRub > 0 ? "bad" : "warn"}
                  />
                  <Metric
                    label="Платят в среднем"
                    value={stats.avgPaymentDays != null ? `${stats.avgPaymentDays} дн.` : "—"}
                  />
                </div>

                <p className="mt-2.5 text-[12.5px] text-muted-foreground">
                  {formatCount(stats.total, ["заказ", "заказа", "заказов"])} всего · {stats.active} в работе ·{" "}
                  {stats.delivered} доставлено
                  {stats.lastOrderAt ? ` · последний ${formatRelative(stats.lastOrderAt)}` : ""}
                </p>
              </>
            ) : null}

            <SectionTitle
              title="Заказы клиента"
              action={<Link href="/lm/orders" className="text-primary">Все заказы</Link>}
            />

            <div className="space-y-2.5">
              {(data?.orders ?? []).slice(0, 12).map((order) => (
                <Link
                  key={order.id}
                  href={`/lm/orders/${order.id}`}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card shadow-sm p-3.5 active:opacity-70"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-medium text-foreground">
                      {routeTitle(order.routeFrom, order.routeTo)}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                      № {shortRef(order.id)}
                      {order.deadline ? ` · до ${formatDateShort(order.deadline)}` : ""}
                      {order.agreedPrice || order.price ? ` · ${formatMoney(order.agreedPrice ?? order.price)}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-[11.5px] ${
                      ORDER_STATUS_STYLES[order.status] ?? "border-border bg-secondary text-foreground/90"
                    }`}
                  >
                    {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status}
                  </span>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/80" />
                </Link>
              ))}
            </div>

            {client.notes ? (
              <Card className="mt-3">
                <p className="text-[12px] uppercase tracking-wide text-muted-foreground">Заметки</p>
                <p className="mt-1 text-[13.5px] text-foreground/90">{client.notes}</p>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

function Line({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-muted-foreground">{label}</span>
        <span className="block break-words text-[14px] text-foreground">{value || "—"}</span>
      </span>
    </div>
  )
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "good" | "warn" | "bad"
}) {
  const tones: Record<string, string> = {
    default: "text-foreground",
    good: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
  }
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-3.5">
      <p className={`text-[16px] font-semibold ${tones[tone]}`}>{value}</p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{label}</p>
    </div>
  )
}
