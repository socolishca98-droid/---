"use client"

// app/m/orders/[id]/page.tsx
//
// Карточка рейса у водителя (задача 7): маршрут, груз, расходы (топливо),
// документы и фото, итог рейса.
//
// Раньше экран ходил в штабной GET /api/orders/[id] и получал 401 —
// карточка у водителя не открывалась. Теперь всё берётся из водительского
// /api/m/orders/[id]: свои заказы, свои расходы, свои фото.
//
// Фото чека распознаётся на сервере, и распознанная сумма сразу подставляется
// в расход: водителю остаётся проверить число и нажать «Сохранить».

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import {
  Navigation,
  Phone,
  Camera,
  MapPin,
  Package,
  ChevronLeft,
  Loader2,
  Truck,
  Clock,
  Banknote,
  Weight,
  Box,
  User,
  Fuel,
  Plus,
  Trash2,
  TrendingUp,
  Receipt,
  FileText,
  RefreshCw,
  ScanLine,
} from "lucide-react"
import { toast } from "sonner"
import { uploadPhotoOrQueue } from "@/lib/offline/photo-queue"

interface Order {
  id: string
  routeId: string | null
  routeName: string | null
  routeFrom: string
  routeTo: string
  distance: number | null
  cargoType: string
  weight: number | null
  volume: number | null
  clientName: string | null
  clientContact: string
  status: string
  statusLabel?: string
  price: number | null
  agreedPrice: number | null
  loadingType: string | null
  requirements: string | null
  deadline: string | null
}

interface TripExpense {
  id: string
  type: string
  amount: number
  liters: number | null
  odometer: number | null
  vendor: string | null
  spentAt: string | null
  source: string | null
  photoId: string | null
}

interface TripSummary {
  distanceKm: number
  revenueRub: number
  expensesRub: number
  fuelRub: number
  fuelLiters: number
  profitRub: number
  ordersCount: number
}

interface TripPhoto {
  id: string
  url: string
  type: string
  createdAt: string
  ocrData: string | null
}

const EXPENSE_TYPES = [
  { id: "fuel", label: "Топливо" },
  { id: "toll", label: "Платные дороги" },
  { id: "repair", label: "Ремонт" },
  { id: "other", label: "Прочее" },
]

const PHOTO_TYPE_LABELS: Record<string, string> = {
  cargo_before: "Кузов до погрузки",
  cargo_after: "Кузов после погрузки",
  damage: "Повреждение",
  receipt: "Чек",
  waybill: "Накладная",
  document: "Документ",
}

function money(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`
}

function dateTime(value: string | null) {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export default function OrderDetailsPage() {
  const router = useRouter()
  const params = useParams()
  const orderId = params?.id as string

  const [order, setOrder] = useState<Order | null>(null)
  const [summary, setSummary] = useState<TripSummary | null>(null)
  const [expenses, setExpenses] = useState<TripExpense[]>([])
  const [photos, setPhotos] = useState<TripPhoto[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Форма расхода
  const [isExpenseFormOpen, setIsExpenseFormOpen] = useState(false)
  const [expenseType, setExpenseType] = useState("fuel")
  const [expenseAmount, setExpenseAmount] = useState("")
  const [expenseLiters, setExpenseLiters] = useState("")
  const [expenseOdometer, setExpenseOdometer] = useState("")
  const [expenseVendor, setExpenseVendor] = useState("")
  const [expensePhotoId, setExpensePhotoId] = useState<string | null>(null)
  const [isSavingExpense, setIsSavingExpense] = useState(false)

  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (quiet = false) => {
      if (!orderId) return

      if (quiet) setIsRefreshing(true)

      try {
        const res = await fetch(`/api/m/orders/${orderId}`)
        const data = await res.json().catch(() => ({}))

        if (data.success && data.order) {
          setOrder(data.order as Order)
          setSummary(data.summary ?? null)
          setExpenses((data.expenses ?? []) as TripExpense[])
          setPhotos((data.photos ?? []) as TripPhoto[])
          setErrorMessage(null)
        } else {
          setOrder(null)
          setErrorMessage(data?.error || `Заказ не загружен (код ${res.status})`)
        }
      } catch (error) {
        console.error("Failed to load order:", error)
        setOrder(null)
        setErrorMessage("Не удалось связаться с сервером")
      } finally {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    },
    [orderId],
  )

  useEffect(() => {
    void load()
  }, [load])

  const openNavigator = (address: string) => {
    window.open(`https://yandex.ru/maps/?rtext=~${encodeURIComponent(address)}&rtt=auto`, "_blank")
  }

  const handleSaveExpense = async () => {
    const amount = Number(expenseAmount.replace(",", "."))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Укажите сумму расхода")
      return
    }

    setIsSavingExpense(true)

    try {
      const res = await fetch("/api/m/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: expenseType,
          amount,
          liters: expenseLiters ? Number(expenseLiters.replace(",", ".")) : null,
          odometer: expenseOdometer ? Number(expenseOdometer) : null,
          vendor: expenseVendor || null,
          photoId: expensePhotoId,
          source: expensePhotoId ? "ocr" : "manual",
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        throw new Error(data?.error || "Не удалось сохранить расход")
      }

      toast.success(`Расход записан: ${money(amount)}`)
      setIsExpenseFormOpen(false)
      setExpenseAmount("")
      setExpenseLiters("")
      setExpenseOdometer("")
      setExpenseVendor("")
      setExpensePhotoId(null)
      await load(true)
    } catch (error: any) {
      toast.error(error?.message || "Не удалось сохранить расход")
    } finally {
      setIsSavingExpense(false)
    }
  }

  const handleDeleteExpense = async (expenseId: string) => {
    try {
      const res = await fetch(`/api/m/expenses/${expenseId}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        throw new Error(data?.error || "Не удалось удалить расход")
      }

      toast.success("Расход удалён")
      await load(true)
    } catch (error: any) {
      toast.error(error?.message || "Не удалось удалить расход")
    }
  }

  /**
   * Фото чека → сервер распознаёт его и возвращает сумму.
   *
   * Если связи нет, файл не теряется: он уходит в очередь (IndexedDB) и
   * отправится сам, когда сеть вернётся, — чек с трассы не пропадёт.
   */
  const handlePhotoUpload = async (file: File, type: string) => {
    setIsUploading(true)

    try {
      const outcome = await uploadPhotoOrQueue({
        blob: file,
        fileName: file.name || "photo.jpg",
        photoType: type,
        orderId,
      })

      if (outcome.queued) {
        toast.info("Связи нет — фото сохранено", {
          description: "Чек уйдёт на сервер сам и распознается при появлении сети",
        })
        return
      }

      if (!outcome.sent) {
        throw new Error(outcome.error || "Не удалось загрузить фото")
      }

      // После отправки перечитываем карточку: фото и распознавание с сервера
      await load(true)

      const ocr = outcome.ocr as {
        total?: number | null
        liters?: number | null
        odometer?: number | null
        vendor?: string | null
        number?: string | null
      } | null
      const uploaded = outcome.photo as { id?: string } | null
      const data = { ocr, warnings: [] as string[], photo: { id: uploaded?.id ?? "" } }

      if (type === "receipt" && data.ocr?.total) {
        // Распознанную сумму не записываем молча: водитель проверяет её глазами
        setExpenseType("fuel")
        setExpenseAmount(String(data.ocr.total))
        setExpenseLiters(data.ocr.liters ? String(data.ocr.liters) : "")
        setExpenseOdometer(data.ocr.odometer ? String(data.ocr.odometer) : "")
        setExpenseVendor(data.ocr.vendor ?? "")
        setExpensePhotoId(data.photo.id)
        setIsExpenseFormOpen(true)

        toast.success(`Чек распознан: ${money(data.ocr.total)}`, {
          description: "Проверьте сумму и сохраните расход",
        })
      } else if (type === "waybill" && data.ocr?.number) {
        toast.success(`Накладная № ${data.ocr.number} распознана`, {
          description: "Документ привязан к заказу",
        })
      } else {
        toast.success("Фото загружено")
      }

      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        toast.info("Проверьте данные", { description: data.warnings.join("; ") })
      }
    } catch (error: any) {
      toast.error(error?.message || "Не удалось загрузить фото")
    } finally {
      setIsUploading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center gap-4 p-4">
        <Package className="h-16 w-16 text-gray-700" />
        <p className="text-gray-400 text-center">{errorMessage || "Заказ не найден"}</p>
        <button
          onClick={() => router.push("/m/orders")}
          className="px-6 py-3 rounded-xl bg-orange-500 text-white font-medium"
        >
          К списку рейсов
        </button>
      </div>
    )
  }

  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0)

  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-24">
      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold truncate">Рейс</h1>
            <p className="text-xs text-gray-500">{order.statusLabel ?? order.status}</p>
          </div>
          <button
            onClick={() => void load(true)}
            className="p-2 rounded-xl hover:bg-gray-800 transition-colors"
            title="Обновить"
          >
            <RefreshCw className={`h-5 w-5 text-gray-400 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="p-4 space-y-4">
        {/* Итог рейса: что уже заработано и потрачено */}
        {summary && (
          <div className="bg-[#1a1a1f] border border-gray-800 rounded-2xl p-5">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5" />
              Итог рейса
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#111114] rounded-xl p-3">
                <p className="text-xs text-gray-500">Пробег</p>
                <p className="text-lg font-bold">{summary.distanceKm} км</p>
              </div>
              <div className="bg-[#111114] rounded-xl p-3">
                <p className="text-xs text-gray-500">Заработок</p>
                <p className="text-lg font-bold text-green-400">{money(summary.revenueRub)}</p>
              </div>
              <div className="bg-[#111114] rounded-xl p-3">
                <p className="text-xs text-gray-500">Расходы</p>
                <p className="text-lg font-bold text-orange-400">{money(summary.expensesRub)}</p>
              </div>
              <div className="bg-[#111114] rounded-xl p-3">
                <p className="text-xs text-gray-500">Остаток</p>
                <p
                  className={`text-lg font-bold ${
                    summary.profitRub >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {money(summary.profitRub)}
                </p>
              </div>
            </div>

            {summary.fuelLiters > 0 && (
              <p className="mt-3 text-xs text-gray-500">
                Топливо: {summary.fuelRub.toLocaleString("ru-RU")} ₽ · {summary.fuelLiters} л
              </p>
            )}
          </div>
        )}

        {/* Маршрут */}
        <div className="bg-[#1a1a1f] border border-gray-800 rounded-2xl p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">Маршрут</h3>

          <div className="relative pl-8 pb-6">
            <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <div className="absolute left-[11px] top-6 w-0.5 h-full bg-gray-700" />

            <div className="text-xs text-green-400 font-medium mb-1">Погрузка</div>
            <p className="font-medium text-white mb-3">{order.routeFrom}</p>

            <button
              onClick={() => openNavigator(order.routeFrom)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-medium transition-colors"
            >
              <Navigation className="h-4 w-4" />
              Маршрут
            </button>
          </div>

          <div className="relative pl-8">
            <div className="absolute left-0 top-0 w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-red-500" />
            </div>

            <div className="text-xs text-red-400 font-medium mb-1">Выгрузка</div>
            <p className="font-medium text-white mb-3">{order.routeTo}</p>

            <button
              onClick={() => openNavigator(order.routeTo)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-medium transition-colors"
            >
              <Navigation className="h-4 w-4" />
              Маршрут
            </button>
          </div>
        </div>

        {/* Быстрые действия */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => router.push("/m/photo")}
            className="bg-[#1a1a1f] border border-gray-800 hover:border-gray-700 p-4 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <Camera className="h-6 w-6 text-orange-400" />
            </div>
            <span className="text-sm font-medium">Фото</span>
          </button>

          {order.clientContact ? (
            <a
              href={`tel:${order.clientContact}`}
              className="bg-[#1a1a1f] border border-gray-800 hover:border-gray-700 p-4 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                <Phone className="h-6 w-6 text-green-400" />
              </div>
              <span className="text-sm font-medium">Позвонить</span>
            </a>
          ) : (
            <button
              onClick={() => setIsExpenseFormOpen(true)}
              className="bg-[#1a1a1f] border border-gray-800 hover:border-gray-700 p-4 rounded-2xl flex flex-col items-center gap-2 active:scale-95 transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Fuel className="h-6 w-6 text-blue-400" />
              </div>
              <span className="text-sm font-medium">Расход</span>
            </button>
          )}
        </div>

        {/* Расходы рейса: топливо в первую очередь */}
        {order.routeId && (
          <div className="bg-[#1a1a1f] border border-gray-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                <Fuel className="h-3.5 w-3.5" />
                Расходы рейса
              </h3>
              <span className="text-sm font-bold text-orange-400">{money(totalExpenses)}</span>
            </div>

            {expenses.length === 0 ? (
              <p className="text-sm text-gray-500">
                Пока пусто. Сфотографируйте чек — сумма распознается сама.
              </p>
            ) : (
              <div className="space-y-2">
                {expenses.slice(0, 8).map((expense) => (
                  <div
                    key={expense.id}
                    className="flex items-center justify-between gap-3 bg-[#111114] rounded-xl p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {EXPENSE_TYPES.find((type) => type.id === expense.type)?.label ?? expense.type}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {[
                          expense.liters ? `${expense.liters} л` : null,
                          expense.vendor,
                          dateTime(expense.spentAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-medium">{money(expense.amount)}</span>
                      <button
                        onClick={() => void handleDeleteExpense(expense.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                        title="Удалить расход"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isExpenseFormOpen ? (
              <div className="mt-4 space-y-3 border-t border-gray-800 pt-4">
                <div className="grid grid-cols-4 gap-2">
                  {EXPENSE_TYPES.map((type) => (
                    <button
                      key={type.id}
                      onClick={() => setExpenseType(type.id)}
                      className={`py-2 px-2 rounded-xl text-xs font-medium transition-colors ${
                        expenseType === type.id
                          ? "bg-orange-500 text-white"
                          : "bg-[#111114] text-gray-400"
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={expenseAmount}
                    onChange={(event) => setExpenseAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="Сумма, ₽"
                    className="bg-[#111114] border border-gray-800 rounded-xl px-3 py-2.5 text-sm"
                  />
                  <input
                    value={expenseLiters}
                    onChange={(event) => setExpenseLiters(event.target.value)}
                    inputMode="decimal"
                    placeholder="Литры"
                    className="bg-[#111114] border border-gray-800 rounded-xl px-3 py-2.5 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={expenseOdometer}
                    onChange={(event) => setExpenseOdometer(event.target.value)}
                    inputMode="numeric"
                    placeholder="Одометр, км"
                    className="bg-[#111114] border border-gray-800 rounded-xl px-3 py-2.5 text-sm"
                  />
                  <input
                    value={expenseVendor}
                    onChange={(event) => setExpenseVendor(event.target.value)}
                    placeholder="АЗС"
                    className="bg-[#111114] border border-gray-800 rounded-xl px-3 py-2.5 text-sm"
                  />
                </div>

                {expensePhotoId && (
                  <p className="flex items-center gap-1.5 text-xs text-green-400">
                    <ScanLine className="h-3.5 w-3.5" />
                    Сумма взята из распознанного чека — проверьте её перед сохранением
                  </p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => void handleSaveExpense()}
                    disabled={isSavingExpense}
                    className="flex-1 py-3 rounded-xl bg-orange-500 text-white font-medium disabled:opacity-60"
                  >
                    {isSavingExpense ? "Сохраняем…" : "Сохранить расход"}
                  </button>
                  <button
                    onClick={() => {
                      setIsExpenseFormOpen(false)
                      setExpensePhotoId(null)
                    }}
                    className="px-4 py-3 rounded-xl bg-[#111114] text-gray-400"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setIsExpenseFormOpen(true)}
                  className="flex-1 py-3 rounded-xl bg-[#111114] border border-gray-800 text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Добавить вручную
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex-1 py-3 rounded-xl bg-blue-600 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Receipt className="h-4 w-4" />
                  )}
                  Чек на топливо
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handlePhotoUpload(file, "receipt")
                event.target.value = ""
              }}
            />
          </div>
        )}

        {/* Документы и фото по заказу */}
        <div className="bg-[#1a1a1f] border border-gray-800 rounded-2xl p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" />
            Документы и фото
          </h3>

          {photos.length === 0 ? (
            <p className="text-sm text-gray-500">Фотографий по заказу пока нет.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden border border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.type} className="w-full h-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] px-1.5 py-0.5 truncate">
                    {PHOTO_TYPE_LABELS[photo.type] ?? photo.type}
                    {photo.ocrData ? " · распознано" : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => router.push("/m/photo")}
            className="mt-4 w-full py-3 rounded-xl bg-[#111114] border border-gray-800 text-sm font-medium flex items-center justify-center gap-2"
          >
            <Camera className="h-4 w-4" />
            Все фотоотчёты
          </button>
        </div>

        {/* Информация о грузе */}
        <div className="bg-[#1a1a1f] border border-gray-800 rounded-2xl p-5">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-4">
            Информация о грузе
          </h3>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                <Package className="h-5 w-5 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Груз</p>
                <p className="font-medium">{order.cargoType}</p>
              </div>
            </div>

            <div className="flex gap-4">
              {order.weight && (
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                    <Weight className="h-5 w-5 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Вес</p>
                    <p className="font-medium">{(order.weight / 1000).toFixed(1)} т</p>
                  </div>
                </div>
              )}
              {order.volume && (
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                    <Box className="h-5 w-5 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Объём</p>
                    <p className="font-medium">{order.volume} м³</p>
                  </div>
                </div>
              )}
            </div>

            {order.distance && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <MapPin className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Расстояние</p>
                  <p className="font-medium">{order.distance} км</p>
                </div>
              </div>
            )}

            {(order.agreedPrice || order.price) && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <Banknote className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Стоимость</p>
                  <p className="font-medium text-orange-400">
                    {money(order.agreedPrice ?? order.price ?? 0)}
                  </p>
                </div>
              </div>
            )}

            {order.clientName && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Клиент</p>
                  <p className="font-medium">{order.clientName}</p>
                </div>
              </div>
            )}

            {order.loadingType && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <Truck className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Тип загрузки</p>
                  <p className="font-medium">{order.loadingType}</p>
                </div>
              </div>
            )}

            {order.deadline && (
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Срок доставки</p>
                  <p className="font-medium">
                    {new Date(order.deadline).toLocaleDateString("ru-RU", {
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {order.requirements && (
          <div className="bg-[#1a1a1f] border border-gray-800 rounded-2xl p-5">
            <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
              Особые требования
            </h3>
            <p className="text-sm text-gray-300 leading-relaxed">{order.requirements}</p>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  )
}
