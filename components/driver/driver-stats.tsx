import { Card, CardContent } from "@/components/ui/card"
import { Package, Star, MapPin, TrendingUp } from "lucide-react"

interface DriverStatsProps {
  stats: {
    ordersToday: number
    ordersTotal: number
    rating: number
    distance: number
  }
}

export function DriverStats({ stats }: DriverStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card className="bg-card border-border">
        <CardContent className="p-4 text-center">
          <Package className="h-6 w-6 text-primary mx-auto mb-2" />
          <div className="text-2xl font-bold">{stats.ordersToday}</div>
          <div className="text-xs text-muted-foreground">Сегодня</div>
        </CardContent>
      </Card>
      <Card className="bg-card border-border">
        <CardContent className="p-4 text-center">
          <TrendingUp className="h-6 w-6 text-success mx-auto mb-2" />
          <div className="text-2xl font-bold">{stats.ordersTotal}</div>
          <div className="text-xs text-muted-foreground">Всего</div>
        </CardContent>
      </Card>
      <Card className="bg-card border-border">
        <CardContent className="p-4 text-center">
          <Star className="h-6 w-6 text-warning mx-auto mb-2" />
          <div className="text-2xl font-bold">{stats.rating}</div>
          <div className="text-xs text-muted-foreground">Рейтинг</div>
        </CardContent>
      </Card>
      <Card className="bg-card border-border">
        <CardContent className="p-4 text-center">
          <MapPin className="h-6 w-6 text-chart-2 mx-auto mb-2" />
          <div className="text-2xl font-bold">{stats.distance}к</div>
          <div className="text-xs text-muted-foreground">км пройдено</div>
        </CardContent>
      </Card>
    </div>
  )
}
