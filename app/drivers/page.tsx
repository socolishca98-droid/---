// app/drivers/page.tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { useRouter } from "next/navigation"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  MapPin,
  Star,
  Phone,
  Truck,
  Plus,
  MoreVertical,
  Loader2,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  UserX,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { toast } from "sonner"
import { fetchJsonCached, invalidateCache, peekCache } from "@/lib/client-cache"
import { CardsSkeleton, KpiSkeleton } from "@/components/ui/skeletons"

interface DriverItem {
  id: string
  name: string
  phone: string
  vehicleType: string
  vehiclePlate: string
  currentLocation?: string | null
  status: "available" | "busy" | "maintenance" | "offline" | string
  ordersCompleted: number
  rating: number
  licenseNumber?: string | null
  vehicle?: {
    id: string
    plate: string
    brand?: string
    model?: string
  } | null
}

const statusConfig: Record<
  string,
  { label: string; className: string; dotColor: string }
> = {
  available: {
    label: "Свободен",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dotColor: "bg-emerald-500",
  },
  busy: {
    label: "На заказе",
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dotColor: "bg-amber-500",
  },
  maintenance: {
    label: "ТО / Ремонт",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dotColor: "bg-blue-500",
  },
  offline: {
    label: "Офлайн",
    className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
    dotColor: "bg-zinc-500",
  },
}

export default function DriversPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()

  const [drivers, setDrivers] = useState<DriverItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedStatus, setSelectedStatus] = useState<string>("all")

  // Add Driver Dialog state
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    vehicleType: "Тент 20т / 82м³",
    vehiclePlate: "",
    licenseNumber: "",
  })

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/")
    }
  }, [user, authLoading, router])

  const loadDrivers = useCallback(async () => {
    try {
      // Через кеш: тот же справочник нужен чату, фото и автопарку
      const data = await fetchJsonCached<{ success?: boolean; drivers?: any[] }>("/api/drivers")
      if (data.success && Array.isArray(data.drivers)) {
        setDrivers(data.drivers)
      } else {
        toast.error("Не удалось получить список водителей")
      }
    } catch (err) {
      console.error("[DriversPage] load error:", err)
      toast.error("Ошибка при подключении к базе водителей")
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    // Второй заход показываем сразу, без экрана загрузки
    const known = peekCache<{ drivers?: any[] }>("/api/drivers")
    if (known?.data.drivers) {
      setDrivers(known.data.drivers)
      setIsLoading(false)
    }
    void loadDrivers()
  }, [user, loadDrivers])

  const handleStatusChange = async (driverId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/drivers/${driverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        // Справочник водителей читают чат, фото и автопарк — в кеше он устарел
        invalidateCache("/api/drivers")
        toast.success(`Статус обновлен на: ${statusConfig[newStatus]?.label || newStatus}`)
        setDrivers((prev) =>
          prev.map((d: any) => (d.id === driverId ? { ...d, status: newStatus } : d))
        )
      } else {
        toast.error(data.error || "Не удалось изменить статус")
      }
    } catch {
      toast.error("Сетевая ошибка при смене статуса")
    }
  }

  const handleAddDriver = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.phone.trim()) {
      toast.error("Имя и телефон обязательны")
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        invalidateCache("/api/drivers")
        toast.success("Водитель успешно добавлен в автопарк")
        setIsAddOpen(false)
        setFormData({
          name: "",
          phone: "",
          vehicleType: "Тент 20т / 82м³",
          vehiclePlate: "",
          licenseNumber: "",
        })
        loadDrivers()
      } else {
        toast.error(data.error || "Не удалось сохранить водителя")
      }
    } catch {
      toast.error("Сетевая ошибка при добавлении водителя")
    } finally {
      setIsSubmitting(false)
    }
  }

  // Пока грузим справочник — рисуем структуру страницы: список не «прыгнет»,
  // когда придут данные
  if (isLoading && !authLoading) {
    return (
      <div className="min-h-screen">
        <Sidebar />
        <div
          className="transition-all duration-300 ease-in-out"
          style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
        >
          <Header />
          <main className="p-6 space-y-6">
            <div className="space-y-2">
              <div className="skeleton-shimmer h-8 w-56 rounded-md" />
              <div className="skeleton-shimmer h-4 w-80 rounded-md" />
            </div>
            <KpiSkeleton />
            <CardsSkeleton count={6} />
          </main>
        </div>
      </div>
    )
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  // Фильтрация
  const filteredDrivers = drivers.filter((d: any) => {
    const matchesSearch =
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.phone.includes(searchQuery) ||
      (d.vehiclePlate && d.vehiclePlate.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesStatus =
      selectedStatus === "all" || d.status === selectedStatus
    return matchesSearch && matchesStatus
  })

  // Агрегаты
  const totalCount = drivers.length
  const availableCount = drivers.filter((d: any) => d.status === "available").length
  const busyCount = drivers.filter((d: any) => d.status === "busy").length
  const avgRating =
    totalCount > 0
      ? (drivers.reduce((sum: any, d: any) => sum + (d.rating || 5), 0) / totalCount).toFixed(1)
      : "5.0"

  return (
    <div className="min-h-screen text-foreground">
      <Sidebar />
      <div
        className="transition-all duration-300 ease-in-out"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <main className="p-6 space-y-6 max-w-7xl mx-auto">
          {/* Top Bar */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Водители</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Оперативное управление экипажами, статусами и транспортом
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsRefreshing(true)
                  loadDrivers()
                }}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
                />
                Обновить
              </Button>
              <Link href="/m" target="_blank">
                <Button variant="outline" size="sm">
                  <Truck className="h-4 w-4 mr-2" />
                  Мобильная кабина (/m)
                </Button>
              </Link>
              <Button size="sm" onClick={() => setIsAddOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить водителя
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card className="bg-card/50 backdrop-blur border-border">
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{totalCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Всего в штате</div>
              </CardContent>
            </Card>
            <Card className="bg-card/50 backdrop-blur border-border">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-emerald-400">{availableCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Свободны под рейс</div>
              </CardContent>
            </Card>
            <Card className="bg-card/50 backdrop-blur border-border">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-amber-400">{busyCount}</div>
                <div className="text-xs text-muted-foreground mt-1">На маршруте</div>
              </CardContent>
            </Card>
            <Card className="bg-card/50 backdrop-blur border-border">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-primary">{avgRating}</div>
                <div className="text-xs text-muted-foreground mt-1">Средний рейтинг</div>
              </CardContent>
            </Card>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по ФИО, телефону или госномеру..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <Button
                variant={selectedStatus === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSelectedStatus("all")}
                className="text-xs h-8"
              >
                Все ({totalCount})
              </Button>
              <Button
                variant={selectedStatus === "available" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSelectedStatus("available")}
                className="text-xs h-8 text-emerald-400"
              >
                Свободные ({availableCount})
              </Button>
              <Button
                variant={selectedStatus === "busy" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSelectedStatus("busy")}
                className="text-xs h-8 text-amber-400"
              >
                На рейсе ({busyCount})
              </Button>
              <Button
                variant={selectedStatus === "offline" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSelectedStatus("offline")}
                className="text-xs h-8 text-zinc-400"
              >
                Офлайн
              </Button>
            </div>
          </div>

          {/* Drivers Grid */}
          {filteredDrivers.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
              <UserX className="h-10 w-10 mx-auto mb-3 opacity-40 text-muted-foreground" />
              <p className="text-base font-medium">Водители не найдены</p>
              <p className="text-xs text-muted-foreground mt-1">
                Попробуйте изменить параметры поиска или фильтр статуса
              </p>
            </div>
          ) : (
            <div className="stagger-in grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredDrivers.map((driver: any) => {
                const status = statusConfig[driver.status] || statusConfig.offline
                const initials = driver.name
                  .split(" ")
                  .map((n: string) => n[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")

                return (
                  <Card
                    key={driver.id}
                    className="card-interactive bg-card/60 backdrop-blur border-border flex flex-col justify-between"
                  >
                    <CardContent className="p-4 space-y-4">
                      {/* Driver Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="h-11 w-11 flex-shrink-0">
                            <AvatarFallback className="bg-primary/20 text-primary font-semibold text-sm">
                              {initials || "В"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate" title={driver.name}>
                              {driver.name}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span
                                className={`h-2 w-2 rounded-full ${status.dotColor}`}
                              />
                              <Badge
                                variant="outline"
                                className={`text-[11px] px-1.5 py-0 ${status.className}`}
                              >
                                {status.label}
                              </Badge>
                            </div>
                          </div>
                        </div>

                        {/* Status Switcher Dropdown */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Действия с водителем"
                              title="Действия с водителем"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                              Изменить статус
                            </div>
                            <DropdownMenuItem
                              onClick={() => handleStatusChange(driver.id, "available")}
                              className="text-xs"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-emerald-400" />
                              Свободен
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleStatusChange(driver.id, "busy")}
                              className="text-xs"
                            >
                              <Clock className="h-3.5 w-3.5 mr-2 text-amber-400" />
                              На заказе
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleStatusChange(driver.id, "maintenance")}
                              className="text-xs"
                            >
                              <AlertTriangle className="h-3.5 w-3.5 mr-2 text-blue-400" />
                              На ТО
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleStatusChange(driver.id, "offline")}
                              className="text-xs"
                            >
                              <UserX className="h-3.5 w-3.5 mr-2 text-zinc-400" />
                              Офлайн
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild className="text-xs">
                              <Link href={`/fleet?tab=drivers`}>
                                Перейти в автопарк
                              </Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Driver Details */}
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Truck className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          <span className="truncate">
                            {driver.vehicle
                              ? `${driver.vehicle.brand || ""} ${driver.vehicle.plate}`.trim()
                              : driver.vehiclePlate || "Транспорт не назначен"}
                          </span>
                          {driver.vehicleType && (
                            <span className="text-muted-foreground/80">
                              • {driver.vehicleType}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="text-foreground">{driver.phone}</span>
                        </div>
                        {driver.currentLocation && (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
                            <span className="truncate">{driver.currentLocation}</span>
                          </div>
                        )}
                      </div>

                      {/* Driver Footer Stats */}
                      <div className="flex items-center justify-between pt-3 border-t border-border text-xs">
                        <div className="flex items-center gap-1 text-amber-400">
                          <Star className="h-3.5 w-3.5 fill-amber-400" />
                          <span className="font-semibold text-foreground">
                            {driver.rating || 5.0}
                          </span>
                        </div>
                        <div className="text-muted-foreground">
                          Выполнено:{" "}
                          <span className="font-semibold text-foreground">
                            {driver.ordersCompleted || 0}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Add Driver Dialog */}
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Добавить водителя</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddDriver} className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="driver-name">ФИО водителя *</Label>
                  <Input
                    id="driver-name"
                    placeholder="Например: Иванов Иван Иванович"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="driver-phone">Телефон *</Label>
                  <Input
                    id="driver-phone"
                    placeholder="+7 (999) 000-00-00"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="vehicle-plate">Госномер ТС</Label>
                    <Input
                      id="vehicle-plate"
                      placeholder="А 123 ВС 777"
                      value={formData.vehiclePlate}
                      onChange={(e) =>
                        setFormData({ ...formData, vehiclePlate: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="license-num">В/У водителя</Label>
                    <Input
                      id="license-num"
                      placeholder="77 99 123456"
                      value={formData.licenseNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, licenseNumber: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vehicle-type">Тип прицепа / грузоподъемность</Label>
                  <Input
                    id="vehicle-type"
                    placeholder="Тент 20т / 82м³"
                    value={formData.vehicleType}
                    onChange={(e) =>
                      setFormData({ ...formData, vehicleType: e.target.value })
                    }
                  />
                </div>
                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddOpen(false)}
                    disabled={isSubmitting}
                  >
                    Отмена
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Добавить
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </div>
  )
}
