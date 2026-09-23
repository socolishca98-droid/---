"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Camera, ImageIcon, X, Loader2, Check, Truck, Receipt, FileText } from "lucide-react"

type PhotoCategory = "cargo" | "receipt" | "waybill"

interface QuickPhotoUploadProps {
  onUpload: (files: File[], category: PhotoCategory) => void
}

export function QuickPhotoUpload({ onUpload }: QuickPhotoUploadProps) {
  const [selectedCategory, setSelectedCategory] = useState<PhotoCategory>("cargo")
  const [uploads, setUploads] = useState<{ file: File; preview: string; uploading: boolean }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const categories = [
    { id: "cargo" as const, label: "Кузов/Груз", icon: Truck, color: "bg-chart-2/20 text-chart-2" },
    { id: "receipt" as const, label: "Чеки", icon: Receipt, color: "bg-warning/20 text-warning" },
    { id: "waybill" as const, label: "Накладные", icon: FileText, color: "bg-primary/20 text-primary" },
  ]

  const handleFiles = async (files: FileList) => {
    const newUploads = Array.from(files).map((file: any) => ({
      file,
      preview: URL.createObjectURL(file),
      uploading: true,
    }))

    setUploads((prev) => [...prev, ...newUploads])

    // Simulate upload
    for (let i = 0; i < newUploads.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setUploads((prev) => prev.map((u: any, idx: any) => (idx === uploads.length + i ? { ...u, uploading: false } : u)))
    }

    onUpload(Array.from(files), selectedCategory)
  }

  const removeUpload = (index: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          Быстрая загрузка
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Category Selection */}
        <div className="grid grid-cols-3 gap-2">
          {categories.map((cat: any) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`p-3 rounded-lg border-2 transition-all ${
                selectedCategory === cat.id ? "border-primary bg-primary/10" : "border-transparent bg-secondary/50"
              }`}
            >
              <cat.icon
                className={`h-6 w-6 mx-auto mb-1 ${
                  selectedCategory === cat.id ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <div
                className={`text-xs font-medium ${
                  selectedCategory === cat.id ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {cat.label}
              </div>
            </button>
          ))}
        </div>

        {/* Upload Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />

          <Button
            size="lg"
            className="h-16 bg-primary text-primary-foreground"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="h-6 w-6 mr-2" />
            Камера
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-16 bg-transparent"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="h-6 w-6 mr-2" />
            Галерея
          </Button>
        </div>

        {/* Uploads Preview */}
        {uploads.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {uploads.map((upload: any, index: any) => (
              <div key={index} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                <img
                  src={upload.preview || "/placeholder.svg"}
                  alt={`Upload ${index + 1}`}
                  className="h-full w-full object-cover"
                />
                {upload.uploading ? (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 text-white animate-spin" />
                  </div>
                ) : (
                  <>
                    <div className="absolute top-1 right-1">
                      <Badge className="h-5 w-5 p-0 flex items-center justify-center bg-success">
                        <Check className="h-3 w-3" />
                      </Badge>
                    </div>
                    <button
                      onClick={() => removeUpload(index)}
                      className="absolute bottom-1 right-1 h-6 w-6 rounded-full bg-black/70 flex items-center justify-center"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
