// components/fleet/vehicle-card.tsx
"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Truck,
  MoreVertical,
  Edit,
  Trash2,
  UserPlus,
  Wrench,
  CheckCircle2,
  AlertCircle,
  Package,
  Gauge,
  Calendar,
  User,
} from "lucide-react"
import { toast } from "sonner"
import { safeJsonParse } from "@/lib/safe-json"

interface Vehicle {
  id: string
  plate: string
  type: string
  brand: string | null
  model: string | null
  year: number | null
  capacity: number
  volume: number | null
  length: number | null
  width: number | null
  height: number | null
  features: string
  status: string
  rawStatus?: string
  driverId: string | null
  hasActiveOrder?: boolean
  nextAvailableAt?: string | null
  driver?: {
    id: string
    name: string
    phone: string
    status: string
  } | null
  lastMaintenanceDate?: Date | null
  nextMaintenanceDate?: Date | null
  mileage?: number | null
  insuranceExpiry?: Date | null
  inspectionExpiry?: Date | null
}

interface VehicleCardProps {
  vehicle: Vehicle
  onEdit?: (vehicle: Vehicle) => void
  onDelete?: (id: string) => void
  onAssignDriver?: (vehicle: Vehicle) => void
  onMaintenance?: (vehicle: Vehicle) => void
  onRefresh?: () => void
}

export function VehicleCard({
  vehicle,
  onEdit,
  onDelete,
  onAssignDriver,
  onMaintenance,
  onRefresh,
}: VehicleCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)

  // ✅ ИСПРАВЛЕНО: безопасный парсинг features
  const features = safeJsonParse<string[]>(vehicle.features, [])

  const getStatusColor = (status: string) => {
    switch (status) {
      case "available":
        return "bg-green-500/10 text-green-500 border-green-500/20"
      case "in_use":
        return "bg-orange-500/10 text-orange-500 border-orange-500/20"
      case "maintenance":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20"
      default:
        return "bg-gray-500/10 text-gray-500 border-gray-500/20"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "available":
        return <CheckCircle2 className="h-4 w-4" />
      case "in_use":
        return <Truck className="h-4 w-4" />
      case "maintenance":
        return <Wrench className="h-4 w-4" />
      default:
        return <AlertCircle className="h-4 w-4" />
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "available":
        return "Доступна"
      case "in_use":
        return "В рейсе"
      case "maintenance":
        return "На ТО"
      default:
        return "Неизвестно"
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Удалить ТС ${vehicle.plate}?`)) return

    setIsDeleting(true)
    try {
      const res = await fetch(`/api/vehicles/${vehicle.id}`, {
        method: "DELETE",
      })

      const data = await res.json()

      if (data.success) {
        toast.success("ТС удалено")
        onRefresh?.()
      } else {
        toast.error(data.error || "Ошибка удаления")
      }
    } catch (error) {
      console.error("Delete vehicle error:", error)
      toast.error("Ошибка соединения")
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSetMaintenance = async () => {
    try {
      const res = await fetch(`/api/vehicles/${vehicle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "maintenance" }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success("ТС отправлено на ТО")
        onRefresh?.()
      } else {
        toast.error(data.error || "Ошибка")
      }
    } catch (error) {
      console.error("Set maintenance error:", error)
      toast.error("Ошибка соединения")
    }
  }

  const handleSetAvailable = async () => {
    try {
      const res = await fetch(`/api/vehicles/${vehicle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "available" }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success("ТС вернулось в строй")
        onRefresh?.()
      } else {
        toast.error(data.error || "Ошибка")
      }
    } catch (error) {
      console.error("Set available error:", error)
      toast.error("Ошибка соединения")
    }
  }

  const nextMaintenanceDays = vehicle.nextMaintenanceDate
    ? Math.ceil(
        (new Date(vehicle.nextMaintenanceDate).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24)
      )
    : null

  const needsMaintenance = nextMaintenanceDays !== null && nextMaintenanceDays <= 7

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <div
              className={`p-3 rounded-xl ${
                vehicle.status === "available"
                  ? "bg-green-500/10"
                  : vehicle.status === "in_use"
                  ? "bg-orange-500/10"
                  : "bg-yellow-500/10"
              }`}
            >
              <Truck
                className={`h-6 w-6 ${
                  vehicle.status === "available"
                    ? "text-green-500"
                    : vehicle.status === "in_use"
                    ? "text-orange-500"
                    : "text-yellow-500"
                }`}
              />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold">{vehicle.plate}</h3>
                <Badge className={getStatusColor(vehicle.status)} variant="outline">
                  {getStatusIcon(vehicle.status)}
                  <span className="ml-1.5">{getStatusLabel(vehicle.status)}</span>
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {vehicle.brand} {vehicle.model} {vehicle.year ? `• ${vehicle.year}` : ""}
              </p>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" disabled={isDeleting}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(vehicle)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Редактировать
                </DropdownMenuItem>
              )}
              {onAssignDriver && (
                <DropdownMenuItem onClick={() => onAssignDriver(vehicle)}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Назначить водителя
                </DropdownMenuItem>
              )}
              {vehicle.status === "available" && (
                <DropdownMenuItem onClick={handleSetMaintenance}>
                  <Wrench className="h-4 w-4 mr-2" />
                  Отправить на ТО
                </DropdownMenuItem>
              )}
              {vehicle.status === "maintenance" && (
                <DropdownMenuItem onClick={handleSetAvailable}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Вернуть в строй
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Удалить
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Driver Info */}
        {vehicle.driver && (
          <div className="mb-4 p-3 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-2 mb-1">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Водитель</span>
            </div>
            <p className="text-sm font-semibold">{vehicle.driver.name}</p>
            <p className="text-xs text-muted-foreground">{vehicle.driver.phone}</p>
          </div>
        )}

        {/* Next Available */}
        {vehicle.nextAvailableAt && (
          <div className="mb-4 p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium text-orange-500">
                Освободится
              </span>
            </div>
            <p className="text-sm font-semibold">
              {new Date(vehicle.nextAvailableAt).toLocaleString("ru-RU", {
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        )}

        {/* Maintenance Alert */}
        {needsMaintenance && (
          <div className="mb-4 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <span className="text-sm font-medium text-yellow-500">
                ТО через {nextMaintenanceDays} дн.
              </span>
            </div>
          </div>
        )}

        {/* Specs */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Package className="h-4 w-4" />
              <span className="text-xs">Грузоподъёмность</span>
            </div>
            <p className="text-sm font-semibold">
              {(vehicle.capacity / 1000).toFixed(1)} т
            </p>
          </div>

          {vehicle.volume && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Package className="h-4 w-4" />
                <span className="text-xs">Объём</span>
              </div>
              <p className="text-sm font-semibold">{vehicle.volume} м³</p>
            </div>
          )}

          {vehicle.length && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Gauge className="h-4 w-4" />
                <span className="text-xs">Размеры</span>
              </div>
              <p className="text-sm font-semibold">
                {vehicle.length}×{vehicle.width}×{vehicle.height} м
              </p>
            </div>
          )}

          {vehicle.mileage && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Gauge className="h-4 w-4" />
                <span className="text-xs">Пробег</span>
              </div>
              <p className="text-sm font-semibold">
                {vehicle.mileage.toLocaleString()} км
              </p>
            </div>
          )}
        </div>

        {/* Features */}
        {features.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Особенности</p>
            <div className="flex flex-wrap gap-2">
              {features.map((feature: any, idx: any) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {feature}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}