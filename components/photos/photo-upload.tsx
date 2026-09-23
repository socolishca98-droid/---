"use client"

import type React from "react"
import { useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Upload, Camera, X, Loader2, Check, AlertCircle, Bot } from "lucide-react"

// Локальные типы (в lib/types их нет)
export type PhotoType = "cargo_before" | "cargo_after" | "damage" | "receipt" | "waybill"

export interface PhotoUpload {
  file: File
  preview: string
  status: "pending" | "analyzing" | "done" | "error"
  result?: any // используем any для результата, чтобы не конфликтовать с Photo
}

interface PhotoUploadProps {
  onUpload: (photos: PhotoUpload[]) => void
}

const photoTypeLabels: Record<PhotoType, string> = {
  cargo_before: "Кузов до погрузки",
  cargo_after: "Кузов после погрузки",
  damage: "Повреждения",
  receipt: "Чек",
  waybill: "Накладная",
}

export function PhotoUpload({ onUpload }: PhotoUploadProps) {
  const [uploads, setUploads] = useState<PhotoUpload[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const handleFiles = useCallback(
    async (files: FileList) => {
      const newUploads: PhotoUpload[] = Array.from(files).map((file: any) => ({
        file,
        preview: URL.createObjectURL(file),
        status: "pending" as const,
      }))

      setUploads((prev) => [...prev, ...newUploads])

      for (let i = 0; i < newUploads.length; i++) {
        const index = uploads.length + i

        setUploads((prev) =>
          prev.map((u: any, idx: any) => (idx === index ? { ...u, status: "analyzing" } : u)),
        )

        await new Promise((resolve) => setTimeout(resolve, 1500 + Math.random() * 1000))

        const types: PhotoType[] = ["cargo_before", "cargo_after", "receipt", "waybill", "damage"]
        const detectedType = types[Math.floor(Math.random() * types.length)]
        const isReceipt = detectedType === "receipt" || detectedType === "waybill"

        setUploads((prev) =>
          prev.map((u: any, idx: any) =>
            idx === index
              ? {
                  ...u,
                  status: "done",
                  result: {
                    id: `upload-${Date.now()}-${idx}`,
                    orderId: "",
                    type: detectedType,
                    url: u.preview,
                    uploadedBy: "current-user",
                    uploadedAt: new Date(),
                    aiClassification: {
                      detectedType,
                      confidence: 0.85 + Math.random() * 0.14,
                      description: isReceipt
                        ? "Документ успешно распознан. Данные извлечены."
                        : "Фото классифицировано. Состояние зафиксировано.",
                    },
                    ...(isReceipt && {
                      ocrData: {
                        amount: Math.floor(1000 + Math.random() * 5000),
                        date: new Date().toISOString().split("T")[0],
                        purpose: detectedType === "receipt" ? "Топливо" : "ТТН",
                        vendor: "Распознанный поставщик",
                      },
                    }),
                  },
                }
              : u,
          ),
        )
      }
    },
    [uploads.length],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length) {
        handleFiles(e.dataTransfer.files)
      }
    },
    [handleFiles],
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const removeUpload = (index: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    const completedUploads = uploads.filter((u: any) => u.status === "done")
    onUpload(completedUploads)
    setUploads([])
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          Загрузка фотографий
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
          }`}
        >
          <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-2">Перетащите фото сюда или</p>
          <label>
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
            <Button variant="outline" size="sm" asChild>
              <span className="cursor-pointer">Выберите файлы</span>
            </Button>
          </label>
          <p className="text-xs text-muted-foreground mt-4">
            ИИ автоматически определит тип: кузов, чеки или накладные
          </p>
        </div>

        {uploads.length > 0 && (
          <div className="space-y-3">
            {uploads.map((upload: any, index: any) => (
              <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <div className="h-16 w-16 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                  <img
                    src={upload.preview || "/placeholder.svg"}
                    alt="Preview"
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {upload.status === "pending" && <Badge variant="secondary">Ожидание</Badge>}
                    {upload.status === "analyzing" && (
                      <Badge variant="secondary" className="bg-primary/20 text-primary">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Анализ...
                      </Badge>
                    )}
                    {upload.status === "done" && upload.result && (
                      <>
                        <Badge variant="secondary" className="bg-success/20 text-success">
                          <Check className="h-3 w-3 mr-1" />
                          {photoTypeLabels[upload.result.type as PhotoType]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {Math.round((upload.result.aiClassification?.confidence || 0) * 100)}% уверенность
                        </span>
                      </>
                    )}
                    {upload.status === "error" && (
                      <Badge variant="destructive">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Ошибка
                      </Badge>
                    )}
                  </div>

                  {upload.status === "analyzing" && <Progress value={66} className="h-1" />}

                  {upload.status === "done" && upload.result?.aiClassification && (
                    <p className="text-xs text-muted-foreground truncate">
                      {upload.result.aiClassification.description}
                    </p>
                  )}

                  {upload.status === "done" && upload.result?.ocrData && (
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <Bot className="h-3 w-3 text-primary" />
                      <span className="text-primary font-medium">
                        {upload.result.ocrData.amount?.toLocaleString()} ₽
                      </span>
                      <span className="text-muted-foreground">— {upload.result.ocrData.purpose}</span>
                    </div>
                  )}
                </div>

                <Button variant="ghost" size="icon" className="flex-shrink-0" onClick={() => removeUpload(index)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {uploads.some((u: any) => u.status === "done") && (
              <Button className="w-full bg-primary text-primary-foreground" onClick={handleSave}>
                <Check className="h-4 w-4 mr-2" />
                Сохранить {uploads.filter((u: any) => u.status === "done").length} фото
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}