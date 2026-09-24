"use client"

// components/routes/route-trip-dialog.tsx
//
// Карточка рейса у логиста (задача 7): одна вкладка на вопрос «как прошёл рейс».
//
// Внутри — итог (пробег, заработок, расход, остаток), расходы с добавлением и
// удалением, хронология (события, статусы точек, заправки), заказы рейса,
// документы и фото. Фото чека можно загрузить прямо здесь: сервер распознаёт
// его локальным OCR, а распознанная сумма подставляется в форму расхода —
// остаётся проверить и сохранить.
//
// Данные берутся из GET /api/routes/[routeId]/history — того же ответа, что
// показывает карточку у водителя, поэтому логист и водитель видят одно и то же.

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Banknote,
  Camera,
  CheckCircle2,
  Clock,
  Flag,
  Fuel,
  Loader2,
  MapPin,
  Package,
  Play,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  ScanLine,
  TrendingUp,
  Truck,
  Trash2,
  User,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EXPENSE_TYPES, EXPENSE_TYPE_LABELS } from "@/lib/trips/history"

interface RouteTripDialogProps {
  routeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Позвать родителя перечитать список после изменения расходов */
  onChanged?: () => void
}

type TripSummaryView = {
  ordersCount: number
  distanceKm: number
  odometerDistanceKm: number | null
  plannedDistanceKm: number | null
  durationDays: number | null
  revenueRub: number
  expensesRub: number
  fuelRub: number
  fuelLiters: number
  fuelPricePerLiter: number | null
  otherRub: number
  profitRub: number
  costPerKmRub: number | null
  revenuePerKmRub: number | null
  marginPercent: number | null
  fuelPer100Km: number | null
}

type TripExpense = {
  id: string
  type: string | null
  amount: number
  liters: number | null
  odometer: number | null
  vendor: string | null
  spentAt: string | null
  note: string | null
  source: string | null
  photoId: string | null
}

type TripTimelineEntry = {
  id: string
  at: string | null
  kind: "event" | "status" | "order" | "expense" | "start" | "finish"
  title: string
  description: string | null
}

type TripOrder = {
  id: string
  status: string
  statusLabel: string
  routeFrom: string
  routeTo: string
  cargoType: string
  weight: number | null
  distance: number | null
  amount: number
  isPaid: boolean
  clientName: string | null
}

type TripPhoto = {
  id: string
  url: string
  type: string
  description: string | null
  ocrData: string | null
  createdAt: string
}

type TripData = {
  route: {
    id: string
    name: string | null
    status: string
    createdAt: string | null
    startedAt: string | null
    completedAt: string | null
    startOdometer: number | null
    endOdometer: number | null
    notes: string | null
    driver: { id: string; name: string | null; phone: string | null } | null
    vehicle: { id: string; plate: string | null; brand: string | null; model: string | null } | null
  }
  summary: TripSummaryView
  timeline: TripTimelineEntry[]
  orders: TripOrder[]
  expenses: TripExpense[]
  byType: Array<{ type: string; label: string; amount: number; liters: number; count: number }>
  photos: TripPhoto[]
}

const PHOTO_TYPE_LABELS: Record<string, string> = {
  cargo_before: "Кузов до погрузки",
  cargo_after: "Кузов после погрузки",
  receipt: "Чек",
  waybill: "Накладная",
  damage: "Повреждение",
  document: "Документ",
}

const ROUTE_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает",
  in_progress: "В рейсе",
  completed: "Завершён",
  cancelled: "Отменён",
}

const TIMELINE_ICONS: Record<TripTimelineEntry["kind"], typeof Play> = {
  start: Play,
  finish: Flag,
  status: RefreshCw,
  order: Package,
  expense: Fuel,
  event: MapPin,
}

const EMPTY_EXPENSE_FORM = {
  type: "fuel",
  amount: "",
  liters: "",
  odometer: "",
  vendor: "",
  note: "",
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

function numberOrDash(value: number | null, suffix = "") {
  if (value === null || value === undefined) return "—"
  return `${value.toLocaleString("ru-RU")}${suffix}`
}

function dateTime(value: string | null) {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function toNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value.replace(",", "."))
  return Number.isFinite(parsed) ? parsed : null
}

export function RouteTripDialog({ routeId, open, onOpenChange, onChanged }: RouteTripDialogProps) {
  const [data, setData] = useState<TripData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_EXPENSE_FORM })
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!routeId) return

    setIsLoading(true)
    try {
      const res = await fetch(`/api/routes/${routeId}/history`)
      const payload = await res.json().catch(() => ({}))

      if (res.ok && payload.success) {
        setData(payload as TripData)
        setError(null)
      } else {
        setData(null)
        setError(payload?.error || `Не удалось открыть рейс (код ${res.status})`)
      }
    } catch {
      setData(null)
      setError("Не удалось связаться с сервером")
    } finally {
      setIsLoading(false)
    }
  }, [routeId])

  useEffect(() => {
    if (!open) return
    setIsFormOpen(false)
    setForm({ ...EMPTY_EXPENSE_FORM })
    void load()
  }, [open, load])

  const handleAddExpense = async () => {
    const amount = toNumber(form.amount)
    if (amount === null || amount <= 0) {
      toast.error("Укажите сумму расхода")
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch(`/api/routes/${routeId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type,
          amount,
          liters: toNumber(form.liters),
          odometer: toNumber(form.odometer),
          vendor: form.vendor.trim() || null,
          note: form.note.trim() || null,
          source: "manual",
        }),
      })
      const payload = await res.json().catch(() => ({}))

      if (!res.ok || !payload.success) {
        throw new Error(payload?.error || "Не удалось записать расход")
      }

      toast.success(`Расход записан: ${money(amount)}`)
      setForm({ ...EMPTY_EXPENSE_FORM })
      setIsFormOpen(false)
      await load()
      onChanged?.()
    } catch (caught: any) {
      toast.error(caught?.message || "Не удалось записать расход")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteExpense = async (expenseId: string) => {
    if (!window.confirm("Удалить расход? Фото чека останется в истории рейса.")) return

    try {
      const res = await fetch(`/api/expenses/${expenseId}`, { method: "DELETE" })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || !payload.success) {
        throw new Error(payload?.error || "Не удалось удалить расход")
      }

      toast.success("Расход удалён")
      await load()
      onChanged?.()
    } catch (caught: any) {
      toast.error(caught?.message || "Не удалось удалить расход")
    }
  }

  /**
   * Фото чека (или накладной) прямо из карточки рейса. Чек распознаётся на
   * сервере, распознанная сумма попадает в форму — её видно и можно поправить.
   */
  const handleUpload = async (file: File, type: string) => {
    const driverId = data?.route.driver?.id
    if (!driverId) {
      toast.error("У рейса нет водителя — фото чека некуда привязать")
      return
    }

    setIsUploading(true)
    try {
      const body = new FormData()
      body.append("file", file)
      body.append("type", type)
      body.append("driverId", driverId)

      const res = await fetch("/api/photos/upload", { method: "POST", body })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok || !payload.success) {
        throw new Error(payload?.error || "Не удалось загрузить фото")
      }

      await load()

      if (type === "receipt" && payload.ocr?.total) {
        setForm({
          ...EMPTY_EXPENSE_FORM,
          amount: String(payload.ocr.total),
          liters: payload.ocr.liters ? String(payload.ocr.liters) : "",
          odometer: payload.ocr.odometer ? String(payload.ocr.odometer) : "",
          vendor: payload.ocr.vendor ?? "",
        })
        setIsFormOpen(true)
        toast.success(`Чек распознан: ${money(payload.ocr.total)}`, {
          description: "Проверьте сумму и сохраните расход",
        })
      } else if (type === "waybill" && payload.ocr?.number) {
        toast.success(`Накладная № ${payload.ocr.number} распознана`, {
          description: "Документ привязан к заказу",
        })
      } else {
        toast.success("Фото загружено")
      }

      if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
        toast.info("Проверьте данные", { description: payload.warnings.join("; ") })
      }
    } catch (caught: any) {
      toast.error(caught?.message || "Не удалось загрузить фото")
    } finally {
      setIsUploading(false)
    }
  }

  const summary = data?.summary
  const expenses = data?.expenses ?? []
  const timeline = data?.timeline ?? []
  const photos = data?.photos ?? []
  const waybills = photos.filter((photo) => photo.type === "waybill")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Рейс {data?.route.name ? `№ ${data.route.name}` : ""}
            {data?.route.status && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {ROUTE_STATUS_LABELS[data.route.status] ?? data.route.status}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Хронология, расходы, документы и итог рейса — глазами логиста и водителя одинаково
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-12 text-center space-y-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        ) : data && summary ? (
          <div className="space-y-5">
            {/* Кто везёт и на чём */}
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {data.route.driver?.name ?? "Водитель не назначен"}
                {data.route.driver?.phone ? ` · ${data.route.driver.phone}` : ""}
              </span>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
                <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                {data.route.vehicle
                  ? `${data.route.vehicle.plate ?? ""} ${data.route.vehicle.brand ?? ""} ${
                      data.route.vehicle.model ?? ""
                    }`.trim()
                  : "Машина не назначена"}
              </span>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {dateTime(data.route.startedAt ?? data.route.createdAt)}
                {data.route.completedAt ? ` → ${dateTime(data.route.completedAt)}` : ""}
              </span>
            </div>

            {/* Итог рейса */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Пробег</p>
                <p className="text-lg font-bold">{numberOrDash(summary.distanceKm, " км")}</p>
                {summary.odometerDistanceKm !== null && (
                  <p className="text-[11px] text-muted-foreground">
                    по одометру · {summary.plannedDistanceKm} км по плану
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Заработок</p>
                <p className="text-lg font-bold text-green-600">{money(summary.revenueRub)}</p>
                <p className="text-[11px] text-muted-foreground">{summary.ordersCount} точек рейса</p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Расходы</p>
                <p className="text-lg font-bold text-orange-600">{money(summary.expensesRub)}</p>
                <p className="text-[11px] text-muted-foreground">
                  топливо {money(summary.fuelRub)} · прочее {money(summary.otherRub)}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Остаток</p>
                <p
                  className={`text-lg font-bold ${
                    summary.profitRub >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {money(summary.profitRub)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  маржа {summary.marginPercent === null ? "—" : `${summary.marginPercent}%`}
                  {summary.durationDays ? ` · ${summary.durationDays} дн.` : ""}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Топливо</p>
                <p className="text-lg font-bold">{numberOrDash(summary.fuelLiters, " л")}</p>
                <p className="text-[11px] text-muted-foreground">
                  {summary.fuelPricePerLiter === null
                    ? "цена не определена"
                    : `${summary.fuelPricePerLiter} ₽/л`}
                  {summary.fuelPer100Km === null ? "" : ` · ${summary.fuelPer100Km} л/100 км`}
                </p>
              </div>
              <div className="rounded-xl border border-border p-3">
                <p className="text-xs text-muted-foreground">Себестоимость</p>
                <p className="text-lg font-bold">
                  {summary.costPerKmRub === null ? "—" : `${summary.costPerKmRub} ₽/км`}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  выручка{" "}
                  {summary.revenuePerKmRub === null ? "—" : `${summary.revenuePerKmRub} ₽/км`}
                </p>
              </div>
            </div>

            {/* Расходы: добавить, посмотреть, удалить */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium flex items-center gap-2">
                  <Fuel className="h-4 w-4 text-muted-foreground" />
                  Расходы рейса
                </h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Receipt className="h-3.5 w-3.5" />
                    )}
                    Фото чека
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setIsFormOpen((prev) => !prev)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Добавить
                  </Button>
                </div>
              </div>

              {data.byType.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {data.byType.map((group) => (
                    <span
                      key={group.type}
                      className="px-2 py-1 rounded-lg bg-muted/50 text-muted-foreground"
                    >
                      {group.label}: <b className="text-foreground">{money(group.amount)}</b>
                      {group.liters > 0 ? ` · ${group.liters} л` : ""}
                    </span>
                  ))}
                </div>
              )}

              {isFormOpen && (
                <div className="rounded-xl bg-muted/30 p-3 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {EXPENSE_TYPES.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, type }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          form.type === type
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        {EXPENSE_TYPE_LABELS[type]}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <input
                      value={form.amount}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, amount: event.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="Сумма, ₽"
                      className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                    />
                    <input
                      value={form.liters}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, liters: event.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="Литры"
                      className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                    />
                    <input
                      value={form.odometer}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, odometer: event.target.value }))
                      }
                      inputMode="numeric"
                      placeholder="Одометр, км"
                      className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                    />
                    <input
                      value={form.vendor}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, vendor: event.target.value }))
                      }
                      placeholder="АЗС / контрагент"
                      className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      value={form.note}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, note: event.target.value }))
                      }
                      placeholder="Примечание"
                      className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
                    />
                    <Button size="sm" disabled={isSaving} onClick={() => void handleAddExpense()}>
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Сохранить"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setIsFormOpen(false)}>
                      Отмена
                    </Button>
                  </div>

                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ScanLine className="h-3.5 w-3.5" />
                    Одометр из первого расхода задаёт начало пробега, из последнего — конец
                  </p>
                </div>
              )}

              {expenses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Расходов пока нет. Сфотографируйте чек — сумму распознает локальный OCR.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {expenses.map((expense) => (
                    <div key={expense.id} className="flex items-center gap-3 py-2">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Fuel className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {EXPENSE_TYPE_LABELS[expense.type ?? "other"] ?? expense.type}
                          {expense.source === "ocr" ? " · распознано" : ""}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[
                            dateTime(expense.spentAt),
                            expense.liters ? `${expense.liters} л` : null,
                            expense.odometer ? `одометр ${expense.odometer}` : null,
                            expense.vendor,
                            expense.note,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span className="font-medium">{money(expense.amount)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => void handleDeleteExpense(expense.id)}
                        title="Удалить расход"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleUpload(file, "receipt")
                  event.target.value = ""
                }}
              />
            </div>

            {/* Хронология: что и когда случилось */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Хронология
                <span className="text-xs font-normal text-muted-foreground">
                  {timeline.length} записей
                </span>
              </h3>

              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">Событий по рейсу пока нет.</p>
              ) : (
                <div className="space-y-0 max-h-80 overflow-y-auto pr-1">
                  {timeline.map((entry, index) => {
                    const Icon = TIMELINE_ICONS[entry.kind] ?? MapPin
                    const isLast = index === timeline.length - 1
                    return (
                      <div key={entry.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                              entry.kind === "finish"
                                ? "bg-green-500/15 text-green-600"
                                : entry.kind === "expense"
                                  ? "bg-orange-500/15 text-orange-600"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          {!isLast && <div className="w-px flex-1 bg-border" />}
                        </div>
                        <div className="pb-3 min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <p className="text-sm font-medium truncate">{entry.title}</p>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {dateTime(entry.at)}
                            </span>
                          </div>
                          {entry.description && (
                            <p className="text-xs text-muted-foreground">{entry.description}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Точки рейса: заказы, которые в нём везли */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <h3 className="font-medium flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                Точки рейса
              </h3>

              {data.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">В рейсе нет заказов.</p>
              ) : (
                <div className="divide-y divide-border">
                  {data.orders.map((order) => (
                    <div key={order.id} className="flex items-center gap-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {order.routeFrom} → {order.routeTo}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[
                            order.cargoType,
                            order.weight ? `${(order.weight / 1000).toFixed(1)} т` : null,
                            order.clientName,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-lg bg-muted/60 text-muted-foreground shrink-0">
                        {order.statusLabel}
                      </span>
                      <span className="text-sm font-medium shrink-0">{money(order.amount)}</span>
                      {order.isPaid ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                      ) : (
                        <Banknote className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Документы и фото рейса */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium flex items-center gap-2">
                  <Camera className="h-4 w-4 text-muted-foreground" />
                  Документы и фото
                  <span className="text-xs font-normal text-muted-foreground">
                    {photos.length}
                  </span>
                </h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => window.open(`/print/route/${routeId}`, "_blank")}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Печать документов
                </Button>
              </div>

              {waybills.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Накладных распознано: {waybills.length} — документы привязаны к заказам рейса
                </p>
              )}

              {photos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Фотографий по рейсу нет. Чек можно сфотографировать в блоке расходов выше.
                </p>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                  {photos.map((photo) => (
                    <a
                      key={photo.id}
                      href={photo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="relative aspect-square rounded-lg overflow-hidden border border-border group"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={PHOTO_TYPE_LABELS[photo.type] ?? photo.type}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] px-1.5 py-0.5 truncate">
                        {PHOTO_TYPE_LABELS[photo.type] ?? photo.type}
                        {photo.ocrData ? " · распознано" : ""}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {data.route.notes && (
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-medium mb-2">Заметки по рейсу</h3>
                <p className="text-sm text-muted-foreground">{data.route.notes}</p>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Одометр рейса: {numberOrDash(data.route.startOdometer)} →{" "}
                {numberOrDash(data.route.endOdometer)}
              </span>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()}>
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
                Обновить
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
