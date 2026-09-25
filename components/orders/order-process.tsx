"use client"

// components/orders/order-process.tsx
//
// Карточка заказа как процесса: этапы, согласование (лента переговоров и торг
// по цене), перевод по этапам, возврат груза в базу.
//
// Один компонент используется в двух местах (решение пользователя — «и то, и
// другое»):
//   * app/orders/[id]/page.tsx — полная страница заказа;
//   * песочница /orders — выдвижная панель быстрых действий.
//
// Правила, которые здесь важны:
//   * статус меняется только на разрешённый каноническим переходом
//     (lib/orders/stages.ts) — сервер всё равно проверяет, но и в интерфейсе
//     нет кнопок, которые заведомо упрутся в ошибку;
//   * цена и статус меняются — запись в ленте согласования появляется сама
//     (её пишет сервер), поэтому история торга не теряется;
//   * деньги и даты отправляются числами/ISO-строками, организация — из сессии.

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  BadgeRussianRuble,
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  Phone,
  PhoneCall,
  Plus,
  RotateCcw,
  StickyNote,
  Truck,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  NEGOTIATION_KIND_LABELS,
  NEGOTIATION_STATUS_LABELS,
  ORDER_STAGES,
  ORDER_STAGE_LABELS,
  allowedOrderStatuses,
  isNegotiationStatus,
  isOrderClosed,
  normalizeOrderStatus,
  orderStageOf,
  orderStatusLabel,
  type NegotiationStatus,
  type OrderStage,
  type OrderStatus,
} from "@/lib/orders/stages"

/** Виды записей, которые логист добавляет руками (остальные пишет сервер). */
const MANUAL_KINDS = ["note", "price_offer", "call", "email", "document"] as const

const KIND_ICONS: Record<string, typeof StickyNote> = {
  note: StickyNote,
  price_offer: BadgeRussianRuble,
  price_change: BadgeRussianRuble,
  call: PhoneCall,
  email: Mail,
  document: FileText,
  status_change: Truck,
}

/** Этапы, которые показываются в степпере (closed — отдельное состояние). */
const PROCESS_STAGES: OrderStage[] = [
  "search",
  "negotiation",
  "route",
  "documents",
  "assignment",
  "control",
]

type OrderRecord = {
  id: string
  status: string
  routeFrom: string
  routeTo: string
  distance: number | null
  weight: number | null
  volume: number | null
  cargoType: string | null
  price: number | null
  agreedPrice: number | null
  priceNegotiable: boolean
  negotiationStatus: string | null
  nextFollowUpAt: string | Date | null
  clientName: string | null
  clientContact: string | null
  routeId: string | null
  routeSequence: number | null
  assignedDriverId: string | null
  assignedVehicleId: string | null
  atiCacheId: string | null
  source: string | null
  takenAt: string | Date | null
  takenById: string | null
  deadline: string | Date | null
  requirements: string | null
  isAdditionalLoad?: boolean
  driver?: { id: string; name: string } | null
  vehicle?: { id: string; plate: string } | null
}

type FeedEntry = {
  id: string
  orderId: string
  kind: string
  kindLabel: string
  text: string | null
  priceOffer: number | null
  authorId: string | null
  authorName: string | null
  createdAt: string | null
}

const money = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? "не указана"
    : `${Number(value).toLocaleString("ru-RU")} ₽`

const dateTime = (value: string | Date | null | undefined): string => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const dateOnly = (value: string | Date | null | undefined): string => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("ru-RU")
}

/** Значение для <input type="datetime-local"> из даты заказа. */
const toLocalInput = (value: string | Date | null | undefined): string => {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export function OrderProcess({
  orderId,
  compact = false,
  onChanged,
}: {
  orderId: string
  /** Панель в песочнице: меньше заголовков, плотнее раскладка. */
  compact?: boolean
  /** Вызывается после любого успешного изменения (списки можно обновить). */
  onChanged?: () => void
}) {
  const [order, setOrder] = useState<OrderRecord | null>(null)
  const [entries, setEntries] = useState<FeedEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // форма записи в ленту
  const [kind, setKind] = useState<string>("note")
  const [text, setText] = useState("")
  const [priceOffer, setPriceOffer] = useState("")

  // форма итога переговоров
  const [agreedPriceInput, setAgreedPriceInput] = useState("")
  const [followUpInput, setFollowUpInput] = useState("")
  const [statusTarget, setStatusTarget] = useState<string>("")
  /** Какое опасное действие подтверждает пользователь (AlertDialog, не window.confirm). */
  const [confirmAction, setConfirmAction] = useState<"reject" | "return" | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [orderRes, feedRes] = await Promise.all([
        fetch(`/api/orders/${orderId}`, { cache: "no-store" }),
        fetch(`/api/orders/${orderId}/negotiation`, { cache: "no-store" }),
      ])
      const orderData = await orderRes.json()
      if (!orderRes.ok || !orderData.success) {
        setLoadError(orderData.error || "Заказ не найден")
        return
      }
      const feedData = await feedRes.json()
      setOrder(orderData.order as OrderRecord)
      setEntries(Array.isArray(feedData.entries) ? feedData.entries : [])
      setAgreedPriceInput(
        orderData.order?.agreedPrice != null ? String(orderData.order.agreedPrice) : "",
      )
      setFollowUpInput(toLocalInput(orderData.order?.nextFollowUpAt))
    } catch {
      setLoadError("Не удалось загрузить заказ")
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    void load()
  }, [load])

  const status = useMemo(() => normalizeOrderStatus(order?.status) ?? null, [order])
  const stage = status ? orderStageOf(status) : null
  const closed = status ? isOrderClosed(status) : false
  const nextStatuses = useMemo<OrderStatus[]>(
    () => (order ? allowedOrderStatuses(order.status) : []),
    [order],
  )
  const negotiationStatus = isNegotiationStatus(order?.negotiationStatus)
    ? (order!.negotiationStatus as unknown as NegotiationStatus)
    : "new"

  /** Общий вызов изменения заказа с понятными ошибками. */
  const patchOrder = async (payload: Record<string, unknown>, successMessage: string) => {
    if (!order) return false
    setSaving(true)
    try {
      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        toast.error(data.error || "Не удалось изменить заказ")
        return false
      }
      toast.success(successMessage)
      await load()
      onChanged?.()
      return true
    } catch {
      toast.error("Ошибка связи с сервером")
      return false
    } finally {
      setSaving(false)
    }
  }

  const addEntry = async () => {
    if (!order) return
    const trimmed = text.trim()
    const offer = priceOffer.trim() === "" ? null : Number(priceOffer)
    if (kind === "price_offer" && (offer === null || !Number.isFinite(offer))) {
      toast.error("Для предложения цены укажите сумму")
      return
    }
    if (!trimmed && offer === null) {
      toast.error("Пустая запись: нужен текст или сумма")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/orders/${order.id}/negotiation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text: trimmed || null, priceOffer: offer }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        toast.error(data.error || "Не удалось добавить запись")
        return
      }
      setText("")
      setPriceOffer("")
      setKind("note")
      toast.success("Запись добавлена в согласование")
      await load()
    } catch {
      toast.error("Ошибка связи с сервером")
    } finally {
      setSaving(false)
    }
  }

  const returnToBase = async () => {
    if (!order) return
    setSaving(true)
    try {
      const res = await fetch("/api/ati/sandbox", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        toast.error(data.error || "Не удалось вернуть груз в базу")
        return
      }
      toast.success("Груз возвращён в базу, заказ удалён")
      onChanged?.()
    } catch {
      toast.error("Ошибка связи с сервером")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Загрузка заказа…
      </div>
    )
  }

  if (loadError || !order) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-destructive" />
        {loadError || "Заказ не найден"}
      </div>
    )
  }

  const currentStageIndex = stage ? PROCESS_STAGES.indexOf(stage) : -1

  return (
    <div className="space-y-4">
      {/* ── Шапка: направление и текущий этап ─────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <Truck className="h-5 w-5 text-primary flex-shrink-0" />
            <span className="truncate">
              {order.routeFrom} → {order.routeTo}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {order.cargoType || "Груз"}
            {order.weight ? ` · ${(order.weight / 1000).toFixed(1)} т` : ""}
            {order.distance ? ` · ${Number(order.distance).toLocaleString("ru-RU")} км` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={closed ? "secondary" : "default"}>
            {orderStatusLabel(order.status)}
          </Badge>
          {stage && <span className="text-xs text-muted-foreground">этап «{ORDER_STAGE_LABELS[stage]}»</span>}
        </div>
      </div>

      {/* ── Степпер этапов ────────────────────────────────────────────────── */}
      {closed ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <XCircle className="h-4 w-4 text-destructive" />
          Заказ закрыт: {orderStatusLabel(order.status)}. Дальнейшие изменения
          статуса недоступны.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {PROCESS_STAGES.map((item, index) => {
            const done = currentStageIndex > index
            const active = currentStageIndex === index
            return (
              <div key={item} className="flex items-center gap-1">
                <div
                  className={[
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                    active
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : done
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-border text-muted-foreground",
                  ].join(" ")}
                  title={ORDER_STAGE_LABELS[item]}
                >
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <span className="text-[10px]">{index + 1}</span>
                  )}
                  {ORDER_STAGE_LABELS[item]}
                </div>
                {index < PROCESS_STAGES.length - 1 && (
                  <Separator orientation="vertical" className="h-4" />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Сводка ────────────────────────────────────────────────────────── */}
      <Card>
        {!compact && (
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Сводка</CardTitle>
          </CardHeader>
        )}
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Клиент</p>
            <p className="text-sm font-medium">{order.clientName || "не указан"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Телефон</p>
            {order.clientContact ? (
              <a
                href={`tel:${order.clientContact}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                {order.clientContact}
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">не указан</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Цена</p>
            <p className="text-sm font-medium">
              {money(order.price)}
              {order.priceNegotiable && (
                <span className="ml-1 text-xs text-muted-foreground">(торг)</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Согласованная цена</p>
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {money(order.agreedPrice)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Переговоры</p>
            <p className="text-sm font-medium">{NEGOTIATION_STATUS_LABELS[negotiationStatus]}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Вернуться к клиенту</p>
            <p className="text-sm font-medium">{dateTime(order.nextFollowUpAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Срок погрузки</p>
            <p className="text-sm font-medium">{dateOnly(order.deadline)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Рейс</p>
            {order.routeId ? (
              <Link href="/routes" className="text-sm text-primary hover:underline">
                в рейсе{order.routeSequence ? ` (точка ${order.routeSequence})` : ""} → рейсы
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">не собран</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Источник</p>
            <p className="text-sm font-medium">
              {order.source === "ATI" ? "база ATI" : order.source || "вручную"}
              {order.takenAt ? ` · взят ${dateTime(order.takenAt)}` : ""}
            </p>
          </div>
          {order.requirements && (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Требования</p>
              <p className="text-sm">{order.requirements}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Согласование ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BadgeRussianRuble className="h-4 w-4 text-primary" />
            Согласование и торг
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="agreed-price">Согласованная цена, ₽</Label>
              <Input
                id="agreed-price"
                inputMode="numeric"
                value={agreedPriceInput}
                onChange={(event) => setAgreedPriceInput(event.target.value)}
                placeholder={order.price ? String(order.price) : "0"}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="follow-up">Вернуться к клиенту</Label>
              <Input
                id="follow-up"
                type="datetime-local"
                value={followUpInput}
                onChange={(event) => setFollowUpInput(event.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={saving || closed}
              onClick={() => {
                const price = agreedPriceInput.trim() === "" ? null : Number(agreedPriceInput)
                if (price !== null && (!Number.isFinite(price) || price < 0)) {
                  toast.error("Цена должна быть числом не меньше нуля")
                  return
                }
                void patchOrder(
                  {
                    agreedPrice: price,
                    negotiationStatus: "agreed",
                    nextFollowUpAt: followUpInput ? new Date(followUpInput).toISOString() : null,
                  },
                  "Договорились: заказ согласован",
                )
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Договорились
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={saving || closed}
              onClick={() =>
                void patchOrder(
                  {
                    nextFollowUpAt: followUpInput ? new Date(followUpInput).toISOString() : null,
                  },
                  "Изменения сохранены",
                )
              }
            >
              <CalendarClock className="h-4 w-4 mr-1.5" />
              Сохранить цену и срок
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={saving || closed || negotiationStatus === "lost"}
              onClick={() => setConfirmAction("reject")}
            >
              <XCircle className="h-4 w-4 mr-1.5" />
              Не договорились
            </Button>

            {order.atiCacheId && !order.routeId && !closed && (
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => setConfirmAction("return")}
              >
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Вернуть в базу
              </Button>
            )}
          </div>

          {!closed && nextStatuses.length > 0 && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-1.5 min-w-[220px] flex-1">
                <Label htmlFor="next-status">Перевести на этап</Label>
                <Select value={statusTarget} onValueChange={setStatusTarget}>
                  <SelectTrigger id="next-status">
                    <SelectValue placeholder="Выберите статус" />
                  </SelectTrigger>
                  <SelectContent>
                    {nextStatuses.map((value) => (
                      <SelectItem key={value} value={value}>
                        {orderStatusLabel(value)} · {ORDER_STAGE_LABELS[orderStageOf(value) as OrderStage]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                disabled={saving || !statusTarget}
                onClick={() => {
                  if (!statusTarget) return
                  void patchOrder({ status: statusTarget }, `Статус: ${orderStatusLabel(statusTarget)}`).then(
                    (ok) => {
                      if (ok) setStatusTarget("")
                    },
                  )
                }}
              >
                Перевести
              </Button>
              <p className="w-full text-xs text-muted-foreground">
                Доступные переходы определяет канон процесса; смена статуса
                автоматически попадает в ленту ниже.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Лента согласования ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Лента согласования{entries.length > 0 ? ` · ${entries.length}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!closed && (
            <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap gap-2">
                <div className="min-w-[190px] flex-1">
                  <Select value={kind} onValueChange={setKind}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MANUAL_KINDS.map((value) => (
                        <SelectItem key={value} value={value}>
                          {NEGOTIATION_KIND_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {kind === "price_offer" && (
                  <Input
                    className="w-40"
                    inputMode="numeric"
                    placeholder="Сумма, ₽"
                    value={priceOffer}
                    onChange={(event) => setPriceOffer(event.target.value)}
                    disabled={saving}
                  />
                )}
              </div>
              <Textarea
                rows={2}
                placeholder={
                  kind === "call"
                    ? "О чём договорились по телефону"
                    : kind === "price_offer"
                      ? "Комментарий к предложению цены"
                      : "Заметка по согласованию"
                }
                value={text}
                onChange={(event) => setText(event.target.value)}
                disabled={saving}
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void addEntry()} disabled={saving}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Добавить запись
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Записи «Изменение цены» и «Смена статуса» сервер добавляет сам —
                их нельзя подделать вручную.
              </p>
            </div>
          )}

          {entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Записей пока нет. Добавьте первую — звонок, письмо или предложение цены.
            </p>
          ) : (
            <ol className="space-y-2">
              {entries.map((entry) => {
                const Icon = KIND_ICONS[entry.kind] ?? StickyNote
                const automatic = entry.kind === "price_change" || entry.kind === "status_change"
                return (
                  <li
                    key={entry.id}
                    className="flex gap-3 rounded-lg border bg-card p-3"
                  >
                    <Icon
                      className={[
                        "h-4 w-4 mt-0.5 flex-shrink-0",
                        automatic ? "text-muted-foreground" : "text-primary",
                      ].join(" ")}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{entry.kindLabel}</span>
                        {entry.priceOffer !== null && entry.priceOffer !== undefined && (
                          <Badge variant="outline">{money(entry.priceOffer)}</Badge>
                        )}
                        {automatic && (
                          <span className="text-[11px] text-muted-foreground">автоматически</span>
                        )}
                      </div>
                      {entry.text && <p className="text-sm whitespace-pre-wrap">{entry.text}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {entry.authorName || "система"} · {dateTime(entry.createdAt)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Phone className="h-3.5 w-3.5" />
        Звонки и письма клиенту система сама не делает: все контакты — только
        действия логиста.
      </div>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "reject" ? "Отклонить заказ?" : "Вернуть груз в базу?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "reject"
                ? "Переговоры будут помечены как «не договорились», заказ получит статус «Отклонён». История согласования сохранится."
                : "Заказ будет удалён, а груз снова станет доступен в накопленной базе — его сможет взять любой логист организации."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={() => {
                if (confirmAction === "reject") {
                  void patchOrder({ negotiationStatus: "lost" }, "Заказ отклонён")
                } else {
                  void returnToBase()
                }
                setConfirmAction(null)
              }}
            >
              {confirmAction === "reject" ? "Отклонить" : "Вернуть в базу"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
