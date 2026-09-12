import { Sidebar } from "@/components/sidebar"
import { Header } from "@/components/header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { mockDrivers } from "@/lib/mock-data"
import { MapPin, Star, Phone, Truck, Plus, MoreVertical } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from "next/link"

const statusConfig = {
  available: { label: "Свободен", className: "bg-success/20 text-success" },
  busy: { label: "На заказе", className: "bg-warning/20 text-warning" },
  offline: { label: "Офлайн", className: "bg-muted text-muted-foreground" },
}

export default function DriversPage() {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="pl-64">
        <Header />
        <main className="p-6 space-y-6">
          {/* Page Title */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Водители</h1>
              <p className="text-muted-foreground">
                Управление водителями и автопарком
              </p>
            </div>
            <div className="flex gap-2">
              <Link href="/driver">
                <Button variant="outline">
                  <Truck className="h-4 w-4 mr-2" />
                  Режим водителя
                </Button>
              </Link>
              <Button className="bg-primary text-primary-foreground">
                <Plus className="h-4 w-4 mr-2" />
                Добавить водителя
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{mockDrivers.length}</div>
                <div className="text-sm text-muted-foreground">Всего водителей</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-success">
                  {mockDrivers.filter((d) => d.status === "available").length}
                </div>
                <div className="text-sm text-muted-foreground">Свободны</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-warning">
                  {mockDrivers.filter((d) => d.status === "busy").length}
                </div>
                <div className="text-sm text-muted-foreground">На заказах</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="text-2xl font-bold">
                  {(
                    mockDrivers.reduce((sum, d) => sum + d.rating, 0) /
                    mockDrivers.length
                  ).toFixed(1)}
                </div>
                <div className="text-sm text-muted-foreground">Средний рейтинг</div>
              </CardContent>
            </Card>
          </div>

          {/* Drivers Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mockDrivers.map((driver) => {
              // Безопасное получение статуса (fallback на offline)
              const statusKey = (driver.status as keyof typeof statusConfig) || "offline"
              const status = statusConfig[statusKey] || statusConfig.offline

              const initials = driver.name
                .split(" ")
                .map((n: string) => n[0])
                .join("")

              return (
                <Card key={driver.id} className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-primary/20 text-primary">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-semibold">{driver.name}</div>
                          <Badge variant="secondary" className={status.className}>
                            {status.label}
                          </Badge>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>Редактировать</DropdownMenuItem>
                          <DropdownMenuItem>Назначить заказ</DropdownMenuItem>
                          <DropdownMenuItem>История</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Truck className="h-4 w-4" />
                        <span>{driver.vehicleType}</span>
                        <span className="text-foreground font-medium">
                          {driver.vehiclePlate}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4" />
                        <span>{driver.phone}</span>
                      </div>
                      {driver.currentLocation && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          <span>{driver.currentLocation}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 text-warning fill-warning" />
                        <span className="font-medium">{driver.rating}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {driver.ordersCompleted} заказов
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </main>
      </div>
    </div>
  )
}