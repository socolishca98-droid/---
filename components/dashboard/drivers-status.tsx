import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { Driver } from "@/lib/types"
import { MapPin, Star } from "lucide-react"

interface DriversStatusProps {
  drivers: Driver[]
}

const statusConfig = {
  available: { label: "Свободен", className: "bg-success/20 text-success" },
  busy: { label: "На заказе", className: "bg-warning/20 text-warning" },
  offline: { label: "Офлайн", className: "bg-muted text-muted-foreground" },
}

export function DriversStatus({ drivers }: DriversStatusProps) {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Водители</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {drivers.map((driver: any) => {
          const status = (statusConfig as any)[driver.status] || (statusConfig as any).available
          const initials = driver.name
            .split(" ")
            .map((n: any) => n[0])
            .join("")

          return (
            <div key={driver.id} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary/20 text-primary text-sm">{initials}</AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{driver.name}</span>
                  <Badge variant="secondary" className={(status as any)?.className || ""}>
                    {status.label}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>{driver.vehicleType}</span>
                  <span>{driver.vehiclePlate}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="flex items-center gap-1 text-sm">
                  <Star className="h-3 w-3 text-warning fill-warning" />
                  <span>{driver.rating}</span>
                </div>
                {driver.currentLocation && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <MapPin className="h-3 w-3" />
                    {driver.currentLocation}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
