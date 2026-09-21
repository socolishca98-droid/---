"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { PhotoUpload } from "@/components/photos/photo-upload"
import { PhotoGallery } from "@/components/photos/photo-gallery"
import { ReceiptSummary } from "@/components/photos/receipt-summary"
import { CargoAnalysisCard } from "@/components/photos/cargo-analysis-card"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

export default function PhotosPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  // Используем any[], чтобы не воевать с расширенными полями (aiClassification, ocrData, uploadedAt)
  const [photos, setPhotos] = useState<any[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [activeRoute, setActiveRoute] = useState<any | null>(null)

  // Авторизация / роль
  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/")
    }
    if (!isLoading && user?.role === "driver") {
      router.push("/m")
    }
  }, [user, isLoading, router])

  // Загрузка фото и активных рейсов из бэкенда
  useEffect(() => {
    if (!user || isLoading) return

    const load = async () => {
      setLoadingPhotos(true)
      try {
        const [photosRes, ordersRes] = await Promise.all([
          fetch("/api/photos"),
          fetch("/api/orders?status=in_transit,assigned&limit=10"),
        ])

        if (photosRes.ok) {
          const data = await photosRes.json()
          if (data.success && Array.isArray(data.photos)) {
            setPhotos(data.photos)
          }
        }

        if (ordersRes.ok) {
          const ordersData = await ordersRes.json()
          if (ordersData.success && Array.isArray(ordersData.orders) && ordersData.orders.length > 0) {
            const first = ordersData.orders[0]
            setActiveRoute({
              id: first.routeId || first.id,
              name: `${first.routeFrom} → ${first.routeTo}`,
              origin: first.routeFrom,
              destination: first.routeTo,
              status: "active",
              cargo: first.cargo,
              vehiclePlate: first.vehicle?.plate || "Транспорт назначен",
              driverName: first.driver?.name || "Водитель в рейсе",
            })
          }
        }
      } catch (error) {
        console.error("[PhotosPage] load error:", error)
      } finally {
        setLoadingPhotos(false)
      }
    }

    void load()
  }, [user, isLoading])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // Обработка сохранения фото из PhotoUpload
  const handleUpload = async (uploads: any[]) => {
    const completed = uploads.filter((u) => u.result)
    if (!completed.length) return

    if (!user) {
      toast.error("Пользователь не определён")
      return
    }

    // useAuth().user может не иметь driverId в своём типе, поэтому берём через any
    const effectiveDriverId =
      (user as any)?.driverId || user.id || "backoffice"

    const created: any[] = []

    for (const u of completed) {
      const r = u.result
      try {
        const res = await fetch("/api/photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: r.url,
            type: r.type, // cargo_before, cargo_after, receipt, waybill, damage
            driverId: effectiveDriverId,
            orderId: r.orderId || null,
            description:
              r.aiClassification?.description ||
              r.description ||
              null,
            aiClassification: r.aiClassification,
            ocrData: r.ocrData,
          }),
        })

        const data = await res.json()
        if (res.ok && data.success && data.photo) {
          created.push(data.photo)
        } else {
          console.error("[PhotosPage] upload error:", data.error || data)
        }
      } catch (error) {
        console.error("[PhotosPage] upload error:", error)
        toast.error("Не удалось сохранить фото")
      }
    }

    if (created.length) {
      setPhotos((prev) => [...created, ...prev])
      toast.success(`Сохранено фото: ${created.length}`)
    }
  }

  // Последнее фото кузова после погрузки с оценкой заполнения
  const latestCargoPhoto = photos.find(
    (p) =>
      (p.type as string) === "cargo_after" &&
      p.aiClassification?.cargoFillPercent !== undefined,
  )

  const pendingSuggestions: any[] = []

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className="transition-all duration-300 ease-in-out"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <main className="p-6 space-y-6">
          {/* Заголовок */}
          <div>
            <h1 className="text-2xl font-bold">Фотографии</h1>
            <p className="text-muted-foreground">
              AI-классификация фото кузова и OCR-распознавание чеков
            </p>
          </div>

          {/* Карточка анализа загрузки кузова (если есть подходящее фото) */}
          {latestCargoPhoto && (
            <CargoAnalysisCard
              photo={latestCargoPhoto}
              route={activeRoute}
              suggestions={pendingSuggestions}
            />
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Загрузка и сводка чеков */}
            <div className="space-y-6">
              <PhotoUpload onUpload={handleUpload} />
              <ReceiptSummary photos={photos} />
            </div>

            {/* Галерея */}
            <div className="lg:col-span-2">
              {/* Можно учесть loadingPhotos, но сейчас просто покажем галерею */}
              <PhotoGallery photos={photos} />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}