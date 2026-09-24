"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { BottomNav } from "@/components/driver-mobile/bottom-nav"
import {
  Camera,
  ImageIcon,
  Truck,
  Receipt,
  FileText,
  AlertCircle,
  Loader2,
  X,
  ChevronDown,
  Package,
  ChevronLeft,
  Trash2,
  Check,
} from "lucide-react"
import { toast } from "sonner"
import { getPhotoQueue, uploadPhotoOrQueue } from "@/lib/offline/photo-queue"

// Этот экспорт всё равно оставим для надёжности
export const dynamic = "force-dynamic"

type PhotoCategory =
  | "cargo_before"
  | "cargo_after"
  | "receipt"
  | "waybill"
  | "damage"
  | "document"

type PhotoContext =
  | "loading"
  | "unloading"
  | "fueling"
  | "damage"
  | "document"
  | "generic"

interface DriverSession {
  id: string
  name: string
}

interface Order {
  id: string
  routeFrom: string
  routeTo: string
  cargoType: string
  status: string
  createdAt?: string
}

interface Photo {
  id: string
  url: string
  type: PhotoCategory
  orderId?: string | null
  description?: string | null
  createdAt: string
}

const CATEGORIES: {
  id: PhotoCategory
  label: string
  shortLabel: string
  icon: typeof Truck
}[] = [
  {
    id: "cargo_before",
    label: "До погрузки",
    shortLabel: "До",
    icon: Truck,
  },
  {
    id: "cargo_after",
    label: "После погрузки/выгрузки",
    shortLabel: "После",
    icon: Truck,
  },
  {
    id: "receipt",
    label: "Чек",
    shortLabel: "Чек",
    icon: Receipt,
  },
  {
    id: "waybill",
    label: "Накладная",
    shortLabel: "ТТН",
    icon: FileText,
  },
  {
    id: "document",
    label: "Документ",
    shortLabel: "Док",
    icon: FileText,
  },
  {
    id: "damage",
    label: "Повреждение",
    shortLabel: "Дефект",
    icon: AlertCircle,
  },
]

function mapContextToCategory(context: PhotoContext): PhotoCategory {
  switch (context) {
    case "loading":
      return "cargo_before"
    case "unloading":
      return "cargo_after"
    case "fueling":
      return "receipt"
    case "damage":
      return "damage"
    case "document":
      return "document"
    default:
      return "cargo_before"
  }
}

// Внутренний компонент с логикой
function PhotoPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [driver, setDriver] = useState<DriverSession | null>(null)
  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [recentOrders, setRecentOrders] = useState<Order[]>([])
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [selectedCategory, setSelectedCategory] =
    useState<PhotoCategory>("cargo_before")
  const [isUploading, setIsUploading] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [showOrderPicker, setShowOrderPicker] = useState(false)
  const [previewPhoto, setPreviewPhoto] = useState<Photo | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem("driver_session")
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as DriverSession
        if (!parsed?.id) throw new Error("Invalid session")
        setDriver(parsed)
      } catch {
        router.push("/m/login")
      }
    } else {
      router.push("/m/login")
    }
  }, [router])

  useEffect(() => {
    const ctxRaw = searchParams?.get("context") ?? "generic"
    const ctx = ctxRaw as PhotoContext
    setSelectedCategory(mapContextToCategory(ctx))
  }, [searchParams])

  const fetchOrders = useCallback(async () => {
    if (!driver?.id) return

    try {
      const [activeRes, historyRes] = await Promise.all([
        fetch(`/api/m/orders?driverId=${driver.id}&status=active`),
        fetch(`/api/m/orders?driverId=${driver.id}&status=history`),
      ])

      const activeData = await activeRes.json()
      const historyData = await historyRes.json()

      let active: Order[] = []
      let recent: Order[] = []

      if (activeData.success) {
        active = activeData.orders as Order[]
        setActiveOrders(active)
      }

      if (historyData.success) {
        const allHistory = historyData.orders as Order[]
        const now = new Date()
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
        recent = allHistory.filter((o: any) => {
          if (!o.createdAt) return false
          return new Date(o.createdAt) >= twoWeeksAgo
        })
        setRecentOrders(recent)
      }

      if (!selectedOrder && active.length > 0) {
        setSelectedOrder(active[0])
      }
    } catch (error) {
      console.error("Failed to fetch orders:", error)
    }
  }, [driver?.id, selectedOrder])

  const fetchPhotos = useCallback(async () => {
    if (!driver?.id) return

    try {
      const url = selectedOrder
        ? `/api/m/photos?driverId=${driver.id}&orderId=${selectedOrder.id}`
        : `/api/m/photos?driverId=${driver.id}`

      const res = await fetch(url)
      const data = await res.json()
      if (data.success) {
        setPhotos(data.photos as Photo[])
      }
    } catch (error) {
      console.error("Failed to fetch photos:", error)
    } finally {
      setIsLoading(false)
    }
  }, [driver?.id, selectedOrder])

  useEffect(() => {
    if (driver?.id) {
      fetchOrders()
      fetchPhotos()
    }
  }, [driver?.id, fetchOrders, fetchPhotos])

  // Очередь может отправить фото сама (связь вернулась) — тогда список
  // обновляем без участия водителя, а о распознанном чеке сообщаем тостом
  useEffect(() => {
    const queue = getPhotoQueue()
    if (!queue) return

    const unsubscribe = queue.onUploaded((_item, result) => {
      void fetchPhotos()

      const ocr = result.ocr as { total?: number | null } | null
      if (ocr?.total) {
        toast.success(`Чек распознан: ${ocr.total.toLocaleString("ru-RU")} ₽`, {
          description: "Расход можно записать в карточке рейса",
        })
      } else {
        toast.success("Фото из очереди загружено")
      }
    })

    return unsubscribe
  }, [fetchPhotos])

  /**
   * Загрузка фото (задача 7).
   *
   * Раньше файл превращался в data:image/...;base64 и целиком уезжал в базу —
   * ни файла на диске, ни распознавания чека, ни события рейса. Теперь файл
   * уходит на сервер (multipart), чек и накладная распознаются на месте, а
   * если связи нет — фото кладётся в очередь и уходит само, когда связь
   * вернётся: чек, снятый на трассе, не теряется.
   */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length || !driver?.id) return

    setIsUploading(true)

    let sentCount = 0
    let queuedCount = 0
    let recognizedSum = 0

    for (const file of Array.from(files)) {
      try {
        const result = await uploadPhotoOrQueue({
          blob: file,
          fileName: file.name || "photo.jpg",
          photoType: selectedCategory,
          orderId: selectedOrder?.id ?? null,
        })

        if (result.sent) {
          sentCount++

          // Чек: сервер уже распознал сумму — показываем её водителю
          const ocr = result.ocr as { total?: number | null; number?: string | null } | null
          if (selectedCategory === "receipt" && ocr?.total) recognizedSum += ocr.total

          if (selectedCategory === "waybill" && ocr?.number) {
            toast.success(`Накладная № ${ocr.number} распознана`, {
              description: "Документ привязан к заказу",
            })
          }
        } else if (result.queued) {
          queuedCount++
        } else {
          toast.error(result.error || "Не удалось загрузить фото")
        }
      } catch (error) {
        console.error("Upload failed:", error)
        toast.error("Не удалось загрузить фото")
      }
    }

    if (sentCount > 0) {
      toast.success(`Загружено фото: ${sentCount}`, {
        icon: <Check className="h-4 w-4" />,
        description: recognizedSum > 0 ? `Чек распознан: ${recognizedSum.toLocaleString("ru-RU")} ₽` : undefined,
      })
      await fetchPhotos()
    }

    if (queuedCount > 0) {
      toast.info(`Фото сохранено: ${queuedCount}`, {
        description: "Связи нет — фото уйдёт само, когда появится сеть",
      })
    }

    setIsUploading(false)
    e.target.value = ""
  }

  const handleDelete = async (photoId: string) => {
    if (!confirm("Удалить фото?")) return

    try {
      const res = await fetch(`/api/m/photos?id=${photoId}`, {
        method: "DELETE",
      })
      const data = await res.json()
      if (data.success) {
        setPhotos((prev) => prev.filter((p: any) => p.id !== photoId))
        setPreviewPhoto(null)
        toast.success("Фото удалено")
      } else {
        toast.error(data.error || "Ошибка удаления")
      }
    } catch (error) {
      console.error("Delete failed:", error)
      toast.error("Ошибка удаления")
    }
  }

  const getCategoryInfo = (type: string) => {
    return CATEGORIES.find((c: any) => c.id === type) || CATEGORIES[0]
  }

  if (!driver) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  const hasOrders = activeOrders.length > 0 || recentOrders.length > 0

  return (
    <div className="min-h-screen bg-[#09090b] text-white pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#09090b]/95 backdrop-blur-lg border-b border-gray-800/50">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-2 rounded-xl hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="h-5 w-5 text-gray-400" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold">Фото отчёты</h1>
            <p className="text-xs text-gray-500">
              {photos.length > 0 ? `${photos.length} фото` : "Нет фото"}
            </p>
          </div>
        </div>

        {/* Выбор заказа */}
        <div className="px-4 pb-3">
          <button
            onClick={() => setShowOrderPicker(true)}
            className="w-full p-3 bg-[#151518] border border-gray-800 rounded-xl flex items-center justify-between hover:border-gray-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Package className="h-5 w-5 text-gray-500" />
              <div className="text-left">
                {selectedOrder ? (
                  <>
                    <p className="text-sm font-medium truncate max-w-[200px]">
                      {selectedOrder.routeFrom} → {selectedOrder.routeTo}
                    </p>
                    <p className="text-xs text-gray-500">
                      {selectedOrder.cargoType}
                    </p>
                  </>
                ) : hasOrders ? (
                  <p className="text-sm text-gray-400">Выберите рейс</p>
                ) : (
                  <p className="text-sm text-gray-500">Без привязки к рейсу</p>
                )}
              </div>
            </div>
            <ChevronDown className="h-5 w-5 text-gray-500" />
          </button>
        </div>
      </header>

      <main className="p-4 space-y-5">
        {/* Категории */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
            Тип фото
          </p>
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map((cat: any) => {
              const isSelected = selectedCategory === cat.id
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`p-3 rounded-xl border transition-all flex flex-col items-center gap-2 ${
                    isSelected
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-gray-800 bg-[#151518] hover:border-gray-700"
                  }`}
                >
                  <cat.icon
                    className={`h-5 w-5 ${
                      isSelected ? "text-orange-400" : "text-gray-500"
                    }`}
                  />
                  <span
                    className={`text-[11px] font-medium ${
                      isSelected ? "text-orange-400" : "text-gray-400"
                    }`}
                  >
                    {cat.shortLabel}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Кнопки загрузки */}
        <div className="grid grid-cols-2 gap-3">
          <label
            className={`h-14 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 ${
              isUploading
                ? "bg-gray-800 text-gray-500"
                : "bg-orange-500 hover:bg-orange-600 text-white"
            }`}
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Camera className="h-5 w-5" />
            )}
            <span className="font-medium">Камера</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isUploading}
            />
          </label>

          <label
            className={`h-14 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 border ${
              isUploading
                ? "bg-gray-900 border-gray-800 text-gray-500"
                : "bg-[#151518] border-gray-800 hover:border-gray-700 text-gray-300"
            }`}
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImageIcon className="h-5 w-5" />
            )}
            <span className="font-medium">Галерея</span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
              disabled={isUploading}
            />
          </label>
        </div>

        {/* Галерея фото */}
        {photos.length > 0 ? (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
              Загруженные фото
            </p>
            <div className="grid grid-cols-3 gap-2">
              {photos.map((photo: any) => {
                const catInfo = getCategoryInfo(photo.type)
                return (
                  <button
                    key={photo.id}
                    onClick={() => setPreviewPhoto(photo)}
                    className="relative aspect-square rounded-xl overflow-hidden bg-gray-900 group"
                  >
                    <img
                      src={photo.url}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm">
                      <catInfo.icon className="h-3 w-3 text-gray-300" />
                    </div>
                    <p className="absolute bottom-2 left-2 right-2 text-[10px] text-white/80 truncate">
                      {catInfo.label}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          !isLoading && (
            <div className="flex flex-col items-center justify-center py-12">
              <Camera className="h-16 w-16 text-gray-800 mb-4" />
              <p className="text-gray-400 font-medium mb-1">Нет фото</p>
              <p className="text-gray-600 text-sm text-center max-w-xs">
                Сфотографируйте груз, документы или повреждения
              </p>
            </div>
          )
        )}

        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
          </div>
        )}
      </main>

      {/* Модал выбора заказа */}
      {showOrderPicker && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-end">
          <div className="w-full max-w-md mx-auto bg-[#151518] rounded-t-3xl max-h-[75vh] overflow-hidden">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <h3 className="font-bold">Выберите рейс</h3>
              <button
                onClick={() => setShowOrderPicker(false)}
                className="p-2 hover:bg-gray-800 rounded-lg"
              >
                <X className="h-5 w-5 text-gray-400" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[65vh]">
              <button
                onClick={() => {
                  setSelectedOrder(null)
                  setShowOrderPicker(false)
                }}
                className={`w-full p-4 text-left border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                  !selectedOrder ? "bg-orange-500/10" : ""
                }`}
              >
                <p className="font-medium">Без привязки к рейсу</p>
                <p className="text-sm text-gray-500">
                  Общие фото (ТС, документы)
                </p>
              </button>

              {activeOrders.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-[#0c0c0e] text-xs text-gray-500 uppercase tracking-wider">
                    Активные рейсы
                  </div>
                  {activeOrders.map((order: any) => (
                    <button
                      key={order.id}
                      onClick={() => {
                        setSelectedOrder(order)
                        setShowOrderPicker(false)
                      }}
                      className={`w-full p-4 text-left border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                        selectedOrder?.id === order.id ? "bg-orange-500/10" : ""
                      }`}
                    >
                      <p className="font-medium truncate">
                        {order.routeFrom} → {order.routeTo}
                      </p>
                      <p className="text-sm text-gray-500">{order.cargoType}</p>
                    </button>
                  ))}
                </>
              )}

              {recentOrders.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-[#0c0c0e] text-xs text-gray-500 uppercase tracking-wider">
                    Недавние (14 дней)
                  </div>
                  {recentOrders.map((order: any) => (
                    <button
                      key={order.id}
                      onClick={() => {
                        setSelectedOrder(order)
                        setShowOrderPicker(false)
                      }}
                      className={`w-full p-4 text-left border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${
                        selectedOrder?.id === order.id ? "bg-orange-500/10" : ""
                      }`}
                    >
                      <p className="font-medium truncate">
                        {order.routeFrom} → {order.routeTo}
                      </p>
                      <p className="text-sm text-gray-500">{order.cargoType}</p>
                    </button>
                  ))}
                </>
              )}

              {!hasOrders && (
                <div className="p-8 text-center text-gray-500">
                  Нет рейсов за последние 2 недели
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Просмотр фото */}
      {previewPhoto && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between p-4">
            <button
              onClick={() => setPreviewPhoto(null)}
              className="p-2 hover:bg-gray-800 rounded-lg"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <p className="text-sm text-gray-400">
              {getCategoryInfo(previewPhoto.type).label}
            </p>
            <button
              onClick={() => handleDelete(previewPhoto.id)}
              className="p-2 hover:bg-red-500/20 rounded-lg"
            >
              <Trash2 className="h-5 w-5 text-red-400" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <img
              src={previewPhoto.url}
              alt=""
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>
          <div className="p-4 text-center">
            <p className="text-xs text-gray-500">
              {new Date(previewPhoto.createdAt).toLocaleString("ru-RU")}
            </p>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}

// Обертка Suspense для безопасного useSearchParams
export default function PhotoPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    }>
      <PhotoPageContent />
    </Suspense>
  )
}