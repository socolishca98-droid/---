"use client"

import type { Photo, Route } from "@/lib/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Camera, Truck, Receipt, FileText, AlertCircle } from "lucide-react"

interface RouteDetailPhotosProps {
  route: Route
  photos: Photo[]
}

const typeConfig = {
  cargo_before: { label: "До погрузки", icon: Truck, color: "bg-blue-500" },
  cargo_after: { label: "После погрузки", icon: Truck, color: "bg-green-500" },
  receipt: { label: "Чек", icon: Receipt, color: "bg-amber-500" },
  waybill: { label: "Накладная", icon: FileText, color: "bg-purple-500" },
  damage: { label: "Повреждение", icon: AlertCircle, color: "bg-red-500" },
}

export function RouteDetailPhotos({ route, photos }: RouteDetailPhotosProps) {
  // Filter photos for this route
  const routePhotos = (photos as any).filter((p: any) => p.routeId === route.id)

  if (routePhotos.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Camera className="h-4 w-4" />
            Фото маршрута
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">Нет прикреплённых фотографий</p>
        </CardContent>
      </Card>
    )
  }

  // Group by type
  const photosByType = routePhotos.reduce((acc: any, photo: any) => {
      const type = photo.type
      if (!acc[type]) acc[type] = []
      acc[type].push(photo)
      return acc
    },
    {} as Record<string, Photo[]>,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Camera className="h-4 w-4" />
          Фото маршрута
          <Badge variant="secondary">{routePhotos.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(photosByType).map(([type, typePhotos]) => {
          const config = typeConfig[type as keyof typeof typeConfig]
          return (
            <div key={type}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1 rounded ${config.color}`}>
                  <config.icon className="h-3 w-3 text-white" />
                </div>
                <span className="text-sm font-medium">{config.label}</span>
                <Badge variant="outline" className="text-xs">
                  {(typePhotos as any).length}
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(typePhotos as any).map((photo: any) => (
                  <div
                    key={photo.id}
                    className="aspect-square rounded-lg overflow-hidden bg-secondary cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                  >
                    <img
                      src={photo.url || "/placeholder.svg"}
                      alt={config.label}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
