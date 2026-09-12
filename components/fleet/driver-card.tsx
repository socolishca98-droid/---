// components/fleet/driver-card.tsx

"use client"

import type { Driver, Vehicle } from "@/lib/types"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Phone,
  MapPin,
  Star,
  Calendar,
  FileText,
  MoreVertical,
  AlertTriangle,
  Truck,
  Wrench,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

interface DriverCardProps {
  driver: Driver & { rawStatus?: string }
  vehicle?: Vehicle
  onEdit?: () => void
  onMessage?: () => void
  onDelete?: () => void
}

const statusConfig: Record<string, { label: string; color: string }> = {
  available: {
    label: "Свободен",
    color: "bg-green-500/10 text-green-600 border-green-500/20",
  },
  busy: {
    label: "В рейсе",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  },
  driving: {
    label: "В пути",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  },
  loading: {
    label: "Погрузка",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  },
  unloading: {
    label: "Выгрузка",
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  },
  maintenance: {
    label: "На ТО",
    color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  },
  offline: {
    label: "Не на связи",
    color: "bg-zinc-500/10 text-zinc-500 border-zinc-500/20",
  },
}

export function DriverCard({ driver, vehicle, onEdit, onMessage, onDelete }: DriverCardProps) {
  const uiStatusKey = driver.status as keyof typeof statusConfig
  const status = statusConfig[uiStatusKey] || statusConfig.offline

  const initials = driver.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)

  const now = new Date()
  const thirtyDays = 30 * 24 * 60 * 60 * 1000

  const licenseExpiry = driver.licenseExpiry ? new Date(driver.licenseExpiry) : null
  const medicalExpiry = driver.medicalExpiry ? new Date(driver.medicalExpiry) : null
  const hiredAt = driver.hiredAt ? new Date(driver.hiredAt) : null

  const isLicenseExpiring =
    licenseExpiry && licenseExpiry.getTime() - now.getTime() < thirtyDays
  const isMedicalExpiring =
    medicalExpiry && medicalExpiry.getTime() - now.getTime() < thirtyDays

  const isOnMaintenance = uiStatusKey === "maintenance"

  return (
    <Card
      className={cn(
        "hover:border-primary/50 transition-colors",
        isOnMaintenance && "border-amber-200 bg-amber-50/10",
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Avatar className={cn("h-12 w-12", isOnMaintenance && "ring-2 ring-amber-400")}>
              <AvatarFallback
                className={cn(
                  "font-semibold",
                  isOnMaintenance
                    ? "bg-amber-100 text-amber-600"
                    : "bg-primary/10 text-primary",
                )}
              >
                {isOnMaintenance ? <Wrench className="h-5 w-5" /> : initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{driver.name}</span>
                <Badge variant="outline" className={cn("text-xs", status.color)}>
                  {status.label}
                </Badge>
              </div>
              <a
                href={`tel:${driver.phone}`}
                className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mt-0.5"
              >
                <Phone className="h-3 w-3" />
                {driver.phone}
              </a>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>Редактировать</DropdownMenuItem>
              <DropdownMenuItem onClick={onMessage}>Написать</DropdownMenuItem>
              <DropdownMenuItem>История рейсов</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                Уволить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <div className="flex items-center justify-center gap-1 text-lg font-bold">
              <Star className="h-4 w-4 text-amber-500" />
              {driver.rating?.toFixed(1) || "5.0"}
            </div>
            <p className="text-xs text-muted-foreground">Рейтинг</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <div className="text-lg font-bold">{driver.ordersCompleted || 0}</div>
            <p className="text-xs text-muted-foreground">Рейсов</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-secondary/50">
            <div className="text-lg font-bold flex items-center justify-center gap-1">
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {driver.currentLocation || "—"}
            </p>
          </div>
        </div>

        {(vehicle || driver.vehiclePlate) && (
          <div className="mt-3 p-2.5 rounded-lg bg-secondary/50 flex items-center gap-2">
            <Truck className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {vehicle?.plate || driver.vehiclePlate}
            </span>
            <span className="text-sm text-muted-foreground">
              • {vehicle?.type || driver.vehicleType}
            </span>
          </div>
        )}

        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          {driver.licenseNumber && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              ВУ: {driver.licenseNumber}
            </span>
          )}
          {hiredAt && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              С {hiredAt.toLocaleDateString("ru-RU")}
            </span>
          )}
        </div>

        {(isLicenseExpiring || isMedicalExpiring) && (
          <div className="mt-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-center gap-2 text-xs text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>
                {isLicenseExpiring && "Права истекают скоро"}
                {isLicenseExpiring && isMedicalExpiring && " • "}
                {isMedicalExpiring && "Медосмотр истекает скоро"}
              </span>
            </div>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-border flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 bg-transparent"
            onClick={onMessage}
          >
            Написать
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`tel:${driver.phone}`}>
              <Phone className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}