"use client"

// components/clients/client-card-dialog.tsx
//
// Карточка клиента (задача 5): контакты, статистика оплат и надёжности,
// история заказов и свежие фото по его заказам.

import { useCallback, useEffect, useState } from "react"
import { Loader2, Pencil, Phone } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { orderStatusLabel } from "@/lib/orders/stages"

import { ClientFormDialog, clientToForm } from "./client-form-dialog"

type Stats = {
  total: number
  delivered: number
  cancelled: number
  active: number
  revenueRub: number
  paidRub: number
  unpaidRub: number
  overdueRub: number
  overdueCount: number
  avgPaymentDays: number | null
  reliabilityPercent: number | null
  lastOrderAt: string | null
}

type CardOrder = {
  id: string
  status: string
  routeFrom: string
  routeTo: string
  price: number | null
  agreedPrice: number | null
  isPaid: boolean
  createdAt: string
  deadline: string | null
  routeId: string | null
  driverName: string | null
}

type Card = {
  client: Record<string, any>
  stats: Stats
  orders: CardOrder[]
  photos: Array<{ id: string; url: string; type: string; createdAt: string }>
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "наличные",
  bank: "безнал",
  card: "карта",
}

const VAT_LABELS: Record<string, string> = {
  none: "без НДС",
  vat20: "НДС 20%",
  vat10: "НДС 10%",
  included: "НДС включён",
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

function date(value: string | null | undefined) {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleDateString("ru-RU")
}

function reliabilityTone(percent: number | null) {
  if (percent === null) return "secondary" as const
  if (percent >= 90) return "default" as const
  if (percent >= 70) return "secondary" as const
  return "destructive" as const
}

interface ClientCardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId: string | null
  onChanged: () => void
}

export function ClientCardDialog({ open, onOpenChange, clientId, onChanged }: ClientCardDialogProps) {
  const [card, setCard] = useState<Card | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)

  const load = useCallback(async () => {
    if (!clientId) return

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/clients/${clientId}`)
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось открыть карточку")
      }

      setCard(data as Card)
    } catch (e: any) {
      setError(e?.message || "Не удалось открыть карточку")
    } finally {
      setIsLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    if (open && clientId) void load()
    if (!open) setCard(null)
  }, [open, clientId, load])

  const client = card?.client
  const stats = card?.stats

  const contactRows: Array<[string, string | null]> = client
    ? [
        ["Контактное лицо", client.contactName],
        ["Телефон", client.phone],
        ["E-mail", client.email],
        ["Адрес", client.address],
        ["ИНН", client.inn],
        ["КПП", client.kpp],
        ["Оплата", client.paymentType ? PAYMENT_LABELS[client.paymentType] ?? client.paymentType : null],
        ["НДС", client.vatType ? VAT_LABELS[client.vatType] ?? client.vatType : null],
        ["Отсрочка", client.deferredDays !== null ? `${client.deferredDays} дн.` : null],
        ["Примечание", client.notes],
      ]
    : []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle>{client?.name ?? "Карточка клиента"}</DialogTitle>
                <DialogDescription>
                  {stats
                    ? stats.total > 0
                      ? `Заказов: ${stats.total}, последний — ${date(stats.lastOrderAt)}`
                      : "По этому клиенту заказов ещё нет"
                    : "История, оплаты и надёжность"}
                </DialogDescription>
              </div>
              {client && (
                <Button variant="outline" size="sm" onClick={() => setIsEditOpen(true)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Изменить
                </Button>
              )}
            </div>
          </DialogHeader>

          {isLoading && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем карточку…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {card && stats && (
            <div className="space-y-5">
              {/* Статистика: деньги и надёжность — то, ради чего карточка и нужна */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Заказов</div>
                  <div className="text-lg font-semibold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">
                    выполнено {stats.delivered}
                    {stats.active > 0 ? `, в работе ${stats.active}` : ""}
                    {stats.cancelled > 0 ? `, отменено ${stats.cancelled}` : ""}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Выручка</div>
                  <div className="text-lg font-semibold">{money(stats.revenueRub)}</div>
                  <div className="text-xs text-muted-foreground">
                    без отменённых заказов
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Получено</div>
                  <div className="text-lg font-semibold text-emerald-600">{money(stats.paidRub)}</div>
                  <div className="text-xs text-muted-foreground">
                    {stats.avgPaymentDays !== null
                      ? `в среднем за ${stats.avgPaymentDays} дн.`
                      : "срок оплаты пока не набрался"}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Долг</div>
                  <div
                    className={
                      stats.overdueRub > 0
                        ? "text-lg font-semibold text-destructive"
                        : "text-lg font-semibold"
                    }
                  >
                    {money(stats.unpaidRub)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {stats.overdueRub > 0
                      ? `просрочено ${money(stats.overdueRub)} (${stats.overdueCount})`
                      : "просрочек нет"}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={reliabilityTone(stats.reliabilityPercent)}>
                  {stats.reliabilityPercent === null
                    ? "Надёжность: нет данных"
                    : `Надёжность: ${stats.reliabilityPercent}%`}
                </Badge>
                {client?.phone && (
                  <a
                    href={`tel:${client.phone}`}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-muted"
                  >
                    <Phone className="h-3 w-3" />
                    {client.phone}
                  </a>
                )}
                {client?.source === "import" && <Badge variant="outline">из импорта</Badge>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1 rounded-lg border p-3 text-sm">
                  <div className="text-xs font-medium text-muted-foreground">Реквизиты и контакты</div>
                  {contactRows.map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="text-right">{value || "—"}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">История заказов</div>
                  {card.orders.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                      Заказов пока нет. При импорте базы заказы привязываются к карточкам
                      по названию клиента.
                    </div>
                  ) : (
                    <ScrollArea className="h-48 rounded-lg border">
                      <div className="divide-y">
                        {card.orders.map((order) => (
                          <div key={order.id} className="p-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium">
                                {order.routeFrom} — {order.routeTo}
                              </span>
                              <span className="shrink-0">{money(order.agreedPrice ?? order.price ?? 0)}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                              <span>{date(order.createdAt)}</span>
                              <span>{orderStatusLabel(order.status)}</span>
                              {order.driverName && <span>{order.driverName}</span>}
                              <Badge
                                variant={order.isPaid ? "secondary" : "outline"}
                                className="text-[10px]"
                              >
                                {order.isPaid ? "оплачен" : "не оплачен"}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </div>

              {card.photos.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">Фото по заказам</div>
                  <div className="grid grid-cols-4 gap-2">
                    {card.photos.map((photo) => (
                      <a
                        key={photo.id}
                        href={`/photos?clientId=${clientId}`}
                        className="group relative aspect-square overflow-hidden rounded-lg border"
                        title={`${photo.type} · ${date(photo.createdAt)}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt={photo.type}
                          className="h-full w-full object-cover transition group-hover:scale-105"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {client && (
        <ClientFormDialog
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          clientId={clientId}
          initial={clientToForm(client)}
          onSaved={() => {
            void load()
            onChanged()
          }}
        />
      )}
    </>
  )
}
