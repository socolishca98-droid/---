// components/driver-mobile/photo-upload-mobile.tsx

"use client"

import React, { useState, useRef, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Camera, ImageIcon, Truck, Receipt, FileText, AlertCircle,
  Check, Loader2, RefreshCw, X, Cloud, CloudOff, Trash
} from "lucide-react"
import { cn } from "@/lib/utils"

interface PhotoUploadMobileProps {
  routeId?: string
  driverId?: string
  onUploadComplete?: () => void
}

type PhotoCategory = "cargo_before" | "cargo_after" | "receipt" | "waybill" | "damage"

const categories: { id: PhotoCategory; label: string; icon: React.ElementType; color: string }[] = [
  { id: "cargo_before", label: "До погрузки", icon: Truck, color: "bg-blue-500" },
  { id: "cargo_after", label: "После погрузки", icon: Truck, color: "bg-green-500" },
  { id: "receipt", label: "Чек", icon: Receipt, color: "bg-amber-500" },
  { id: "waybill", label: "Накладная", icon: FileText, color: "bg-purple-500" },
  { id: "damage", label: "Повреждение", icon: AlertCircle, color: "bg-red-500" },
]

interface QueuedItem {
  id: string
  file: File
  category: string
  preview: string
  status: "pending" | "uploading" | "done" | "failed"
}

export function PhotoUploadMobile({ routeId, driverId, onUploadComplete }: PhotoUploadMobileProps) {
  const [selectedCategory, setSelectedCategory] = useState<PhotoCategory>("cargo_before")
  const [uploads, setUploads] = useState<QueuedItem[]>([])
  const [isOnline, setIsOnline] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsOnline(navigator.onLine)
      const handleOnline = () => setIsOnline(true)
      const handleOffline = () => setIsOnline(false)
      window.addEventListener("online", handleOnline)
      window.addEventListener("offline", handleOffline)
      return () => {
        window.removeEventListener("online", handleOnline)
        window.removeEventListener("offline", handleOffline)
      }
    }
  }, [])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return

    for (const file of Array.from(files)) {
      const preview = URL.createObjectURL(file)
      const id = Math.random().toString(36).substring(7)

      const newItem: QueuedItem = {
        id,
        file,
        category: selectedCategory,
        preview,
        status: isOnline ? "uploading" : "pending",
      }

      setUploads((prev) => [...prev, newItem])

      if (isOnline) {
        await uploadFile(newItem)
      }
    }

    // Reset input
    e.target.value = ""
  }

  const uploadFile = async (item: QueuedItem) => {
    try {
      // Конвертируем изображение в Base64 dataURL для надёжного сохранения
      const reader = new FileReader()
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(item.file)
      })
      const photoUrl = await base64Promise

      const res = await fetch("/api/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: photoUrl,
          type: item.category,
          driverId: driverId || "drv-1",
          orderId: routeId || null,
          description: `Фото категории ${item.category} от водителя`,
        }),
      })

      if (!res.ok) {
        throw new Error("Failed to upload photo to server")
      }

      setUploads((prev) => prev.map((u: any) => (u.id === item.id ? { ...u, status: "done" } : u)))
      onUploadComplete?.()
    } catch (error) {
      console.error("Upload failed:", error)
      setUploads((prev) => prev.map((u: any) => (u.id === item.id ? { ...u, status: "failed" } : u)))
    }
  }

  const removeUpload = (id: string) => {
    setUploads((prev) => prev.filter((u: any) => u.id !== id))
  }

  const retryUpload = (item: QueuedItem) => {
    setUploads((prev) => prev.map((u: any) => (u.id === item.id ? { ...u, status: "uploading" } : u)))
    uploadFile(item)
  }

  return (
    <Card className="bg-[#1a1a1f] border-gray-800 text-white">
      <CardHeader className="pb-3 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Загрузить фото</CardTitle>
          {!isOnline && (
            <Badge variant="outline" className="text-amber-500 border-amber-500/50">
              <CloudOff className="h-3 w-3 mr-1" />
              Офлайн
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-4">
        {/* Категории */}
        <div className="grid grid-cols-3 gap-2">
          {categories.slice(0, 3).map((cat: any) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                "p-3 rounded-xl border transition-all flex flex-col items-center gap-2",
                selectedCategory === cat.id 
                  ? "border-orange-500 bg-orange-500/10" 
                  : "border-gray-700 hover:border-gray-500 bg-gray-800/50",
              )}
            >
              <div className={cn("p-2 rounded-lg", cat.color)}>
                <cat.icon className="h-5 w-5 text-white" />
              </div>
              <span className="text-xs font-medium text-gray-300">{cat.label}</span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {categories.slice(3).map((cat: any) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                "p-3 rounded-xl border transition-all flex items-center justify-center gap-3",
                selectedCategory === cat.id 
                  ? "border-orange-500 bg-orange-500/10" 
                  : "border-gray-700 hover:border-gray-500 bg-gray-800/50",
              )}
            >
              <div className={cn("p-2 rounded-lg", cat.color)}>
                <cat.icon className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-medium text-gray-300">{cat.label}</span>
            </button>
          ))}
        </div>

        {/* Кнопки загрузки */}
        <div className="grid grid-cols-2 gap-3">
          <Button 
            size="lg" 
            className="h-16 text-base flex-col gap-1 bg-orange-600 hover:bg-orange-700 text-white border-0" 
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="h-6 w-6" />
            <span>Камера</span>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-16 text-base flex-col gap-1 bg-gray-800 border-gray-700 text-white hover:bg-gray-700 hover:text-white"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="h-6 w-6" />
            <span>Галерея</span>
          </Button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Очередь загрузки */}
        {uploads.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-gray-800">
            <p className="text-sm font-medium text-gray-400">Загруженные фото ({uploads.length})</p>
            <div className="grid grid-cols-3 gap-3">
              {uploads.map((upload: any) => (
                <div key={upload.id} className="relative aspect-square rounded-xl overflow-hidden bg-gray-800 group border border-gray-700">
                  <img src={upload.preview || "/placeholder.svg"} alt="" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" />
                  
                  {/* Статус */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    {upload.status === "uploading" && <Loader2 className="h-8 w-8 text-white animate-spin" />}
                    {upload.status === "pending" && <Cloud className="h-8 w-8 text-gray-300" />}
                    {upload.status === "done" && <Check className="h-8 w-8 text-green-400 drop-shadow-md" />}
                    {upload.status === "failed" && (
                      <button onClick={() => retryUpload(upload)} className="p-2 bg-white/10 rounded-full hover:bg-white/20">
                        <RefreshCw className="h-6 w-6 text-red-400" />
                      </button>
                    )}
                  </div>

                  {/* Удалить */}
                  <button
                    onClick={() => removeUpload(upload.id)}
                    className="absolute top-1 right-1 p-1.5 rounded-full bg-black/60 text-white hover:bg-red-500 transition"
                  >
                    <X className="h-3 w-3" />
                  </button>

                  {/* Бейдж категории */}
                  <div className="absolute bottom-1 left-1 right-1">
                    <Badge variant="secondary" className="w-full justify-center text-[9px] py-0.5 bg-black/60 text-white border-0 backdrop-blur-sm">
                      {categories.find((c: any) => c.id === upload.category)?.label}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Офлайн уведомление */}
        {!isOnline && uploads.some((u: any) => u.status === "pending") && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
            <CloudOff className="h-5 w-5 text-amber-500" />
            <p className="text-xs text-amber-500">
              Фото сохранены и отправятся автоматически при подключении к сети
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}