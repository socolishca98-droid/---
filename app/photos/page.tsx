"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { PhotoUpload } from "@/components/photos/photo-upload"
import { PhotoGallery } from "@/components/photos/photo-gallery"
import { ReceiptSummary } from "@/components/photos/receipt-summary"
import { CargoAnalysisCard } from "@/components/photos/cargo-analysis-card"
import { Filter, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export default function PhotosPage() {
  const { user, isLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  // Используем any[], чтобы не воевать с расширенными полями (aiClassification, ocrData, uploadedAt)
  const [photos, setPhotos] = useState<any[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [activeRoute, setActiveRoute] = useState<any | null>(null)

  // Фильтры галереи (задача 5): по клиенту, машине и рейсу. Одно и то же фото
  // попадает в разные срезы — логист смотрит то, что нужно в конкретный момент.
  const [filters, setFilters] = useState<{ clientId: string; vehicleId: string; routeId: string }>({
    clientId: "",
    vehicleId: "",
    routeId: "",
  })
  const [filterOptions, setFilterOptions] = useState<{
    clients: Array<{ id: string; name: string }>
    vehicles: Array<{ id: string; plate: string; brand?: string | null }>
    routes: Array<{ id: string; name: string }>
  }>({ clients: [], vehicles: [], routes: [] })

  const hasFilters = Boolean(filters.clientId || filters.vehicleId || filters.routeId)

  // Авторизация / роль
  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/")
    }
    if (!isLoading && user?.role === "driver") {
      router.push("/m")
    }
  }, [user, isLoading, router])

  // Списки для фильтров: клиенты, машины, рейсы своей организации
  useEffect(() => {
    if (!user || isLoading) return

    const loadOptions = async () => {
      try {
        const [clientsRes, fleetRes, routesRes] = await Promise.all([
          fetch("/api/clients?limit=500"),
          fetch("/api/fleet"),
          fetch("/api/routes?status=active,planned"),
        ])

        const clientsData = clientsRes.ok ? await clientsRes.json() : null
        const fleetData = fleetRes.ok ? await fleetRes.json() : null
        const routesData = routesRes.ok ? await routesRes.json() : null

        setFilterOptions({
          clients: Array.isArray(clientsData?.clients)
            ? clientsData.clients.map((client: any) => ({ id: client.id, name: client.name }))
            : [],
          vehicles: Array.isArray(fleetData?.vehicles)
            ? fleetData.vehicles.map((vehicle: any) => ({
                id: vehicle.id,
                plate: vehicle.plate,
                brand: vehicle.brand ?? null,
              }))
            : [],
          routes: Array.isArray(routesData?.routes)
            ? routesData.routes.map((route: any) => ({
                id: route.id,
                name: route.name || `${route.origin ?? ""} → ${route.destination ?? ""}`.trim(),
              }))
            : [],
        })
      } catch (error) {
        console.error("[PhotosPage] filters load error:", error)
      }
    }

    void loadOptions()
  }, [user, isLoading])

  // Ссылка из карточки клиента: /photos?clientId=… сразу открывает нужный срез
  useEffect(() => {
    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    const clientId = params.get("clientId")
    const vehicleId = params.get("vehicleId")
    const routeId = params.get("routeId")

    if (clientId || vehicleId || routeId) {
      setFilters({
        clientId: clientId ?? "",
        vehicleId: vehicleId ?? "",
        routeId: routeId ?? "",
      })
    }
  }, [])

  // Фото по текущим фильтрам — отдельной функцией: её же зовём после загрузки,
  // чтобы новое фото сразу появилось в галерее
  const loadPhotos = useCallback(async () => {
    const query = new URLSearchParams()
    if (filters.clientId) query.set("clientId", filters.clientId)
    if (filters.vehicleId) query.set("vehicleId", filters.vehicleId)
    if (filters.routeId) query.set("routeId", filters.routeId)

    const res = await fetch(`/api/photos${query.size > 0 ? `?${query.toString()}` : ""}`)
    if (!res.ok) return

    const data = await res.json()
    if (data.success && Array.isArray(data.photos)) {
      setPhotos(data.photos)
    }
  }, [filters.clientId, filters.vehicleId, filters.routeId])

  // Загрузка фото и активных рейсов из бэкенда
  useEffect(() => {
    if (!user || isLoading) return

    const load = async () => {
      setLoadingPhotos(true)
      try {
        const ordersRes = await fetch("/api/orders?status=in_transit,assigned&limit=10")

        await loadPhotos()

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
  }, [user, isLoading, loadPhotos])

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // Фото из PhotoUpload уже загружены на сервер (multipart + OCR),
  // поэтому здесь остаётся только перечитать галерею
  const handleUpload = async (uploads: any[]) => {
    if (!uploads.length) return

    await loadPhotos()

    const recognized = uploads.filter((u: any) => u.result?.ocr).length
    toast.success(`Загружено фото: ${uploads.length}`, {
      description: recognized > 0 ? `Распознано документов: ${recognized}` : undefined,
    })
  }

  // Последнее фото кузова после погрузки с оценкой заполнения
  const latestCargoPhoto = photos.find((p: any) =>
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

            {/* Галерея с фильтрами по клиенту, машине и рейсу */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Filter className="h-4 w-4" />
                  Фильтры
                </div>

                <Select
                  value={filters.clientId || "__all__"}
                  onValueChange={(value) =>
                    setFilters((prev) => ({ ...prev, clientId: value === "__all__" ? "" : value }))
                  }
                >
                  <SelectTrigger className="h-9 w-[190px]">
                    <SelectValue placeholder="Все клиенты" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Все клиенты</SelectItem>
                    {filterOptions.clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={filters.vehicleId || "__all__"}
                  onValueChange={(value) =>
                    setFilters((prev) => ({ ...prev, vehicleId: value === "__all__" ? "" : value }))
                  }
                >
                  <SelectTrigger className="h-9 w-[170px]">
                    <SelectValue placeholder="Все машины" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Все машины</SelectItem>
                    {filterOptions.vehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id}>
                        {vehicle.plate}
                        {vehicle.brand ? ` · ${vehicle.brand}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={filters.routeId || "__all__"}
                  onValueChange={(value) =>
                    setFilters((prev) => ({ ...prev, routeId: value === "__all__" ? "" : value }))
                  }
                >
                  <SelectTrigger className="h-9 w-[210px]">
                    <SelectValue placeholder="Все рейсы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Все рейсы</SelectItem>
                    {filterOptions.routes.map((route) => (
                      <SelectItem key={route.id} value={route.id}>
                        {route.name || route.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {hasFilters && (
                  <>
                    <Badge variant="secondary" className="text-xs">
                      найдено: {photos.length}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFilters({ clientId: "", vehicleId: "", routeId: "" })}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Сбросить
                    </Button>
                  </>
                )}
                {loadingPhotos && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              {hasFilters && photos.length === 0 && !loadingPhotos ? (
                <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                  По этому срезу фотографий нет. Сбросьте фильтры или выберите другого клиента,
                  машину или рейс.
                </div>
              ) : (
                <PhotoGallery photos={photos} />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}