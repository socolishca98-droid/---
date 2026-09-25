"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { useSidebar } from "@/lib/sidebar-context"
import { useFleet } from "@/hooks/use-fleet"
import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { VehicleCard } from "@/components/fleet/vehicle-card"
import { DriverCard } from "@/components/fleet/driver-card"
import { AddVehicleDialog } from "@/components/fleet/add-vehicle-dialog"
import { AddDriverDialog } from "@/components/fleet/add-driver-dialog"
import { MaintenanceDialog } from "@/components/fleet/maintenance-dialog"
import { FleetSettingsDialog } from "@/components/fleet/fleet-settings-dialog" // <-- Новый
import { AssignDriverDialog } from "@/components/fleet/assign-driver-dialog" // <-- Новый
import {
  FleetInsightsPanel,
  type FleetInsights,
} from "@/components/fleet/fleet-insights-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  Truck,
  Users,
  Plus,
  Search,
  Loader2,
  RefreshCw,
  MapPin,
  Settings,
} from "lucide-react"
import { toast } from "sonner"
import { useConfirm } from "@/components/ui/confirm-dialog"

export default function FleetPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { isCollapsed } = useSidebar()
  const router = useRouter()
  const confirm = useConfirm()

  const {
    drivers,
    vehicles,
    stats,
    isLoading,
    refresh,
    addDriver,
    addVehicle,
    deleteDriver,
    deleteVehicle,
    getAvailableVehicles,
  } = useFleet()

  const [searchQuery, setSearchQuery] = useState("")
  const [showAddVehicle, setShowAddVehicle] = useState(false)
  const [showAddDriver, setShowAddDriver] = useState(false)

  // Диалоги действий
  const [maintenanceVehicle, setMaintenanceVehicle] = useState<any>(null)
  const [assignVehicle, setAssignVehicle] = useState<any>(null) // Для привязки водителя
  const [showSettings, setShowSettings] = useState(false) // Настройки базы

  const [availableVehicles, setAvailableVehicles] = useState<any[]>([])
  const [fleetSettings, setFleetSettings] = useState<any>(null)
  // Практика вместо процента загрузки: простой, ТО/страховки, история назначений
  const [insights, setInsights] = useState<FleetInsights | null>(null)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/")
    }
  }, [user, authLoading, router])

  /**
   * Сводка по автопарку (задача 4). Обновляется вместе со списком машин:
   * простой, ближайшие ТО/страховки и история назначений водителей.
   */
  const loadInsights = () => {
    fetch("/api/fleet/insights", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.success) setInsights(data as FleetInsights)
      })
      .catch((error) => console.error("Fleet insights error:", error))
  }

  const refreshAll = () => {
    void refresh()
    loadInsights()
  }

  const loadSettings = () => {
    fetch("/api/fleet/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setFleetSettings(data.settings)
      })
      .catch(console.error)
  }

  useEffect(() => {
    loadSettings()
    loadInsights()
  }, [])

  useEffect(() => {
    if (showAddDriver) {
      getAvailableVehicles().then(setAvailableVehicles)
    }
  }, [showAddDriver, getAvailableVehicles])

  const filteredVehicles = useMemo(() => {
    if (!searchQuery) return vehicles
    const q = searchQuery.toLowerCase()
    return vehicles.filter((v: any) =>
        v.plate?.toLowerCase().includes(q) ||
        v.type?.toLowerCase().includes(q) ||
        v.brand?.toLowerCase().includes(q),
    )
  }, [vehicles, searchQuery])

  const filteredDrivers = useMemo(() => {
    if (!searchQuery) return drivers
    const q = searchQuery.toLowerCase()
    return drivers.filter((d: any) => d.name?.toLowerCase().includes(q) || d.phone?.includes(q))
  }, [drivers, searchQuery])

  // Helpers
  const handleDeleteVehicle = async (id: string) => {
    const ok = await confirm({
      title: "Удалить транспорт?",
      description: "Машина исчезнет из автопарка. История рейсов, где она была, сохранится.",
      confirmLabel: "Удалить",
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteVehicle(id)
      toast.success("Транспорт удалён")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleDeleteDriver = async (id: string) => {
    const ok = await confirm({
      title: "Удалить водителя?",
      description: "Учётная запись водителя и вход в мобильное приложение перестанут работать.",
      confirmLabel: "Удалить",
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteDriver(id)
      toast.success("Водитель удалён")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  const vehicleStats = stats?.vehicleStats || {
    total: 0,
    available: 0,
    inUse: 0,
    maintenance: 0,
  }
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div
        className="transition-all duration-300 ease-in-out"
        style={{ paddingLeft: isCollapsed ? "80px" : "256px" }}
      >
        <Header />
        <main className="p-6 space-y-6">
          {/* Инфо-панель */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* База */}
            <Card className="md:col-span-3 bg-gradient-to-br from-background to-secondary/20">
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {fleetSettings?.parkName || "Автопарк"}
                    </h2>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      <span>{fleetSettings?.baseAddress || "Адрес базы не задан"}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowSettings(true)}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-6 flex gap-8">
                  <div>
                    <p className="text-sm text-muted-foreground">Всего машин</p>
                    <p className="text-2xl font-bold">{vehicleStats.total}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">В рейсе</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {vehicleStats.inUse}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">На ТО</p>
                    <p className="text-2xl font-bold text-amber-600">
                      {vehicleStats.maintenance}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>

          {/* Практика вместо процента загрузки: что стоит, что пора обслужить */}
          <FleetInsightsPanel insights={insights} />

          {/* Контент */}
          <Tabs defaultValue="vehicles" className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <TabsList className="h-10">
                <TabsTrigger value="vehicles" className="gap-2 px-4">
                  <Truck className="h-4 w-4" />
                  Транспорт
                </TabsTrigger>
                <TabsTrigger value="drivers" className="gap-2 px-4">
                  <Users className="h-4 w-4" />
                  Водители
                </TabsTrigger>
              </TabsList>

              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-background"
                  />
                </div>
                <Button
                  onClick={refreshAll}
                  variant="outline"
                  size="icon"
                  aria-label="Обновить автопарк"
                  title="Обновить автопарк"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button onClick={() => setShowAddVehicle(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить
                </Button>
              </div>
            </div>

            <TabsContent value="vehicles" className="mt-0">
              {filteredVehicles.length === 0 ? (
                <div className="text-center py-20 bg-secondary/20 rounded-xl border border-dashed">
                  <Truck className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-lg font-medium">Нет транспорта</p>
                  <p className="text-muted-foreground">Добавьте первую машину</p>
                </div>
              ) : (
                <div className="stagger-in grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filteredVehicles.map((vehicle: any) => {
                    const driver = drivers.find((d: any) => d.vehicleId === vehicle.id) ?? null
                    const vehicleInsight = insights?.idle.find(
                      (item) => item.vehicleId === vehicle.id,
                    )

                    const vehicleWithDriver = {
                      ...vehicle,
                      driver: driver
                        ? {
                            id: driver.id,
                            name: driver.name,
                            phone: driver.phone ?? "",
                            status: driver.status ?? "available",
                          }
                        : null,
                    }

                    return (
                      <VehicleCard
                        key={vehicle.id}
                        vehicle={vehicleWithDriver}
                        assignments={insights?.history?.[vehicle.id] ?? []}
                        idleDays={vehicleInsight?.idleDays}
                        onDelete={() => handleDeleteVehicle(vehicle.id)}
                        onMaintenance={() => setMaintenanceVehicle(vehicle)}
                        onAssignDriver={() => setAssignVehicle(vehicle)}
                      />
                    )
                  })}
                </div>
              )}
            </TabsContent>

            <TabsContent value="drivers" className="mt-0 space-y-4">
              {/* Здесь — карточки экипажей для быстрых действий. Полный разбор
                  (сводка по статусам, рейтинги, поиск по госномеру, добавление
                  водителя) живёт на отдельной странице /drivers; на неё не было
                  ни одной ссылки, и раздел был недостижим */}
              <div className="flex justify-end">
                <Link
                  href="/drivers"
                  className="text-sm text-primary hover:underline"
                >
                  Все водители: статусы, рейтинги, добавление →
                </Link>
              </div>
              <div className="stagger-in grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredDrivers.map((driver: any) => {
                  const vehicle = vehicles.find((v: any) => v.id === driver.vehicleId)
                  return (
                    <DriverCard
                      key={driver.id}
                      driver={driver}
                      vehicle={vehicle}
                      onDelete={() => handleDeleteDriver(driver.id)}
                    />
                  )
                })}
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>

      {/* Диалоги */}
      <AddVehicleDialog
        open={showAddVehicle}
        onOpenChange={setShowAddVehicle}
        onSubmit={async (data) => {
          await addVehicle(data)
          setShowAddVehicle(false)
          toast.success("Транспорт добавлен")
        }}
      />

      <AddDriverDialog
        open={showAddDriver}
        onOpenChange={setShowAddDriver}
        onSubmit={async (data) => {
          await addDriver(data)
          setShowAddDriver(false)
          toast.success("Водитель добавлен")
        }}
        availableVehicles={availableVehicles}
      />

      <MaintenanceDialog
        open={!!maintenanceVehicle}
        onOpenChange={(open) => !open && setMaintenanceVehicle(null)}
        vehicle={maintenanceVehicle}
        onSuccess={() => {
          refresh()
          setMaintenanceVehicle(null)
        }}
      />

      <FleetSettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        currentSettings={fleetSettings}
        onSuccess={() => {
          loadSettings()
          toast.success("Настройки обновлены")
        }}
      />

      <AssignDriverDialog
        open={!!assignVehicle}
        onOpenChange={(open) => !open && setAssignVehicle(null)}
        vehicle={assignVehicle}
        onSuccess={() => {
          refresh()
          setAssignVehicle(null)
        }}
      />
    </div>
  )
}