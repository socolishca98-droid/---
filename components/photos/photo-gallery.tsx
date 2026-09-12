"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Photo } from "@/lib/types"
import {
  ImageIcon,
  Truck,
  Receipt,
  FileText,
  AlertTriangle,
  Calendar,
  Bot,
  ZoomIn,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"

// Локальное определение типов
type PhotoType = "cargo_before" | "cargo_after" | "damage" | "receipt" | "waybill"

interface PhotoGalleryProps {
  photos: Photo[]
}

const photoTypeConfig: Record<
  string,
  { label: string; icon: typeof ImageIcon; className: string }
> = {
  cargo_before: {
    label: "До погрузки",
    icon: Truck,
    className: "bg-chart-2/20 text-chart-2",
  },
  cargo_after: {
    label: "После погрузки",
    icon: Truck,
    className: "bg-success/20 text-success",
  },
  damage: {
    label: "Повреждение",
    icon: AlertTriangle,
    className: "bg-destructive/20 text-destructive",
  },
  receipt: {
    label: "Чек",
    icon: Receipt,
    className: "bg-warning/20 text-warning",
  },
  waybill: {
    label: "Накладная",
    icon: FileText,
    className: "bg-primary/20 text-primary",
  },
  other: {
    label: "Другое",
    icon: ImageIcon,
    className: "bg-secondary text-secondary-foreground",
  },
}

export function PhotoGallery({ photos }: PhotoGalleryProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null)
  const [filter, setFilter] = useState<PhotoType | "all">("all")

  // Приводим к any, чтобы TS не ругался на расширенные типы
  const safePhotos = photos as any[]

  const filteredPhotos =
    filter === "all" ? safePhotos : safePhotos.filter((p) => p.type === filter)

  const currentIndex = selectedPhoto
    ? filteredPhotos.findIndex((p) => p.id === selectedPhoto.id)
    : -1

  const navigatePhoto = (direction: "prev" | "next") => {
    if (!selectedPhoto) return
    const newIndex =
      direction === "prev"
        ? (currentIndex - 1 + filteredPhotos.length) % filteredPhotos.length
        : (currentIndex + 1) % filteredPhotos.length
    setSelectedPhoto(filteredPhotos[newIndex])
  }

  // Group photos by type
  const photosByType = safePhotos.reduce(
    (acc, photo) => {
      const type = photo.type || "other"
      if (!acc[type]) acc[type] = []
      acc[type].push(photo)
      return acc
    },
    {} as Record<string, any[]>,
  )

  const selectedAny = selectedPhoto as any

  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-primary" />
              Галерея фотографий
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(photosByType).map((entry) => {
                const type = entry[0]
                const typePhotos = entry[1] as any[] // Явное приведение внутри map
                
                const config = photoTypeConfig[type] || photoTypeConfig.other
                return (
                  <Badge
                    key={type}
                    variant="secondary"
                    className={`${config.className} cursor-pointer`}
                    onClick={() =>
                      setFilter(filter === type ? "all" : (type as PhotoType))
                    }
                  >
                    {config.label}: {typePhotos.length}
                  </Badge>
                )
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredPhotos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ImageIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Нет загруженных фотографий</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredPhotos.map((photo) => {
                const config =
                  photoTypeConfig[photo.type] || photoTypeConfig.other
                const TypeIcon = config.icon

                return (
                  <div
                    key={photo.id}
                    className="group relative aspect-[4/3] rounded-lg overflow-hidden bg-muted cursor-pointer"
                    onClick={() => setSelectedPhoto(photo)}
                  >
                    <img
                      src={photo.url || "/placeholder.svg"}
                      alt={config.label}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                    <Badge
                      variant="secondary"
                      className={`absolute top-2 left-2 ${config.className}`}
                    >
                      <TypeIcon className="h-3 w-3 mr-1" />
                      {config.label}
                    </Badge>

                    {photo.ocrData?.amount && (
                      <Badge
                        variant="secondary"
                        className="absolute top-2 right-2 bg-success/80 text-success-foreground"
                      >
                        {photo.ocrData.amount.toLocaleString()} ₽
                      </Badge>
                    )}

                    <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex items-center justify-between text-xs text-white">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {photo.uploadedAt
                            ? new Date(photo.uploadedAt).toLocaleDateString(
                                "ru-RU",
                              )
                            : ""}
                        </span>
                        <ZoomIn className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Photo Modal */}
      <Dialog
        open={!!selectedPhoto}
        onOpenChange={() => setSelectedPhoto(null)}
      >
        <DialogContent className="max-w-4xl bg-card p-0 overflow-hidden">
          {selectedAny && (
            <>
              <div className="relative">
                <img
                  src={selectedAny.url || "/placeholder.svg"}
                  alt={
                    (
                      photoTypeConfig[selectedAny.type] ||
                      photoTypeConfig.other
                    ).label
                  }
                  className="w-full max-h-[60vh] object-contain bg-black"
                />

                {filteredPhotos.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
                      onClick={() => navigatePhoto("prev")}
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70"
                      onClick={() => navigatePhoto("next")}
                    >
                      <ChevronRight className="h-6 w-6" />
                    </Button>
                  </>
                )}
              </div>

              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <Badge
                    variant="secondary"
                    className={
                      (
                        photoTypeConfig[selectedAny.type] ||
                        photoTypeConfig.other
                      ).className
                    }
                  >
                    {
                      (
                        photoTypeConfig[selectedAny.type] ||
                        photoTypeConfig.other
                      ).label
                    }
                  </Badge>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    {new Date(selectedAny.uploadedAt).toLocaleString("ru-RU")}
                  </div>
                </div>

                {selectedAny.aiClassification && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary/50">
                    <Bot className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium mb-1">
                        AI-анализ (
                        {Math.round(
                          selectedAny.aiClassification.confidence * 100,
                        )}
                        % уверенность)
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {selectedAny.aiClassification.description}
                      </p>
                    </div>
                  </div>
                )}

                {selectedAny.ocrData && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {selectedAny.ocrData.amount && (
                      <div className="p-3 rounded-lg bg-secondary/50">
                        <div className="text-xs text-muted-foreground">
                          Сумма
                        </div>
                        <div className="text-lg font-bold text-primary">
                          {selectedAny.ocrData.amount.toLocaleString()} ₽
                        </div>
                      </div>
                    )}
                    {selectedAny.ocrData.date && (
                      <div className="p-3 rounded-lg bg-secondary/50">
                        <div className="text-xs text-muted-foreground">
                          Дата
                        </div>
                        <div className="font-medium">
                          {selectedAny.ocrData.date}
                        </div>
                      </div>
                    )}
                    {selectedAny.ocrData.purpose && (
                      <div className="p-3 rounded-lg bg-secondary/50">
                        <div className="text-xs text-muted-foreground">
                          Назначение
                        </div>
                        <div className="font-medium">
                          {selectedAny.ocrData.purpose}
                        </div>
                      </div>
                    )}
                    {selectedAny.ocrData.vendor && (
                      <div className="p-3 rounded-lg bg-secondary/50">
                        <div className="text-xs text-muted-foreground">
                          Поставщик
                        </div>
                        <div className="font-medium">
                          {selectedAny.ocrData.vendor}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}