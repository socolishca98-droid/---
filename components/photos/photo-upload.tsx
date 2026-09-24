"use client"

// components/photos/photo-upload.tsx
//
// Загрузка фотографий (задача 7).
//
// Раньше здесь была имитация: файл оставался blob:-ссылкой в браузере, а тип и
// данные «распознавания» подбирались случайным числом. Ни в галерее, ни в
// истории рейса этих фото не было.
//
// Теперь файл уходит на сервер (POST /api/photos/upload, multipart): сервер
// кладёт его в public/uploads, создаёт запись фото и, если это чек или
// накладная, сразу распознаёт локальным OCR. Тип выбирает человек — сервер
// принимает только известные типы, а «уверенность классификации» больше не
// выдумывается.

import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Upload, Camera, X, Loader2, Check, AlertCircle, ScanLine, Cloud } from "lucide-react"
import { getPhotoQueue, uploadPhotoOrQueue } from "@/lib/offline/photo-queue"

export type PhotoType =
  | "cargo_before"
  | "cargo_after"
  | "damage"
  | "receipt"
  | "waybill"
  | "document"

/** Результат загрузки: фото уже создано на сервере, OCR — если был. */
export interface PhotoUploadResult {
  photo: { id: string; url: string; type: string; orderId?: string | null; routeId?: string | null }
  ocr: {
    kind?: string
    total?: number | null
    liters?: number | null
    number?: string | null
    vendor?: string | null
    date?: string | null
  } | null
  warnings: string[]
}

export interface PhotoUploadItem {
  id: string
  file: File
  preview: string
  type: PhotoType
  status: "pending" | "uploading" | "done" | "error" | "queued"
  error?: string
  result?: PhotoUploadResult
}

interface PhotoUploadProps {
  /** Вызывается после «Сохранить»: фото уже на сервере, родителю нужно перечитать список */
  onUpload: (uploads: PhotoUploadItem[]) => void
  /** Рейс, к которому привязываются фото (если открыто из карточки рейса) */
  routeId?: string | null
  orderId?: string | null
  /** Водитель для штабной загрузки: сервер требует его явно */
  driverId?: string | null
}

const photoTypeLabels: Record<PhotoType, string> = {
  cargo_before: "Кузов до погрузки",
  cargo_after: "Кузов после погрузки",
  damage: "Повреждения",
  receipt: "Чек",
  waybill: "Накладная",
  document: "Документ",
}

const PHOTO_TYPES = Object.keys(photoTypeLabels) as PhotoType[]

function ocrSummary(result: PhotoUploadResult): string | null {
  const ocr = result.ocr
  if (!ocr) return null

  if (ocr.total) {
    const parts = [`${ocr.total.toLocaleString("ru-RU")} ₽`]
    if (ocr.liters) parts.push(`${ocr.liters} л`)
    if (ocr.vendor) parts.push(ocr.vendor)
    return `Распознано: ${parts.join(" · ")}`
  }

  if (ocr.number) return `Накладная № ${ocr.number}`
  if (ocr.kind) return "Документ распознан"

  return null
}

export function PhotoUpload({ onUpload, routeId, orderId, driverId }: PhotoUploadProps) {
  const [uploads, setUploads] = useState<PhotoUploadItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  /** Тип, с которым добавляются новые файлы: чаще всего это кузов после погрузки */
  const [defaultType, setDefaultType] = useState<PhotoType>("cargo_after")

  // Штабная загрузка: серверу нужно знать, чьё это фото, — логист выбирает водителя
  const [driverOptions, setDriverOptions] = useState<Array<{ id: string; name: string | null }>>([])
  const [staffDriverId, setStaffDriverId] = useState("")

  useEffect(() => {
    if (driverId) return

    let cancelled = false
    fetch("/api/drivers")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data?.success || !Array.isArray(data.drivers)) return
        setDriverOptions(
          data.drivers.map((driver: any) => ({ id: driver.id, name: driver.name ?? null })),
        )
      })
      .catch(() => {
        /* список водителей не критичен: фото можно загрузить из карточки рейса */
      })

    return () => {
      cancelled = true
    }
  }, [driverId])

  const effectiveDriverId = driverId || staffDriverId

  // Очередь может отправить фото сама: тогда помечаем запись загруженной,
  // чтобы логист видел правду, и просим родителя перечитать галерею
  useEffect(() => {
    const queue = getPhotoQueue()
    if (!queue) return

    return queue.onUploaded((item) => {
      setUploads((prev) => {
        const index = prev.findIndex((entry) => entry.file.name === item.fileName)
        if (index === -1) return prev

        const next = [...prev]
        next[index] = { ...next[index], status: "done", error: undefined }
        return next
      })

      onUpload([])
    })
  }, [onUpload])

  const uploadOne = useCallback(
    async (item: PhotoUploadItem) => {
      setUploads((prev) =>
        prev.map((entry) =>
          entry.id === item.id ? { ...entry, status: "uploading", error: undefined } : entry,
        ),
      )

      if (!effectiveDriverId) {
        setUploads((prev) =>
          prev.map((entry) =>
            entry.id === item.id
              ? { ...entry, status: "error", error: "Выберите водителя" }
              : entry,
          ),
        )
        return false
      }

      try {
        // Единый путь загрузки: сразу на сервер, а если связь пропала — в очередь
        // (IndexedDB), откуда фото уйдёт само. Файл не теряется на полпути.
        const outcome = await uploadPhotoOrQueue({
          blob: item.file,
          fileName: item.file.name || "photo.jpg",
          photoType: item.type,
          orderId: orderId ?? null,
          routeId: routeId ?? null,
          // Штабная загрузка требует водителя явно, водительская берёт его из сессии
          driverId: effectiveDriverId,
        })

        if (outcome.queued) {
          // Не ошибка: фото уже сохранено и уйдёт при появлении связи
          setUploads((prev) =>
            prev.map((entry) =>
              entry.id === item.id
                ? { ...entry, status: "queued", error: outcome.error || undefined }
                : entry,
            ),
          )
          return false
        }

        if (!outcome.sent) {
          throw new Error(outcome.error || "Не удалось загрузить фото")
        }

        const result: PhotoUploadResult = {
          photo: outcome.photo as PhotoUploadResult["photo"],
          ocr: (outcome.ocr as PhotoUploadResult["ocr"]) ?? null,
          warnings: outcome.warnings ?? [],
        }

        setUploads((prev) =>
          prev.map((entry) =>
            entry.id === item.id ? { ...entry, status: "done", result, error: undefined } : entry,
          ),
        )

        return true
      } catch (error: any) {
        setUploads((prev) =>
          prev.map((entry) =>
            entry.id === item.id
              ? { ...entry, status: "error", error: error?.message || "Ошибка загрузки" }
              : entry,
          ),
        )
        return false
      }
    },
    [effectiveDriverId, orderId, routeId],
  )

  const handleFiles = useCallback(
    (files: FileList) => {
      const added: PhotoUploadItem[] = Array.from(files).map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        preview: URL.createObjectURL(file),
        type: defaultType,
        status: "pending",
      }))

      setUploads((prev) => [...prev, ...added])
    },
    [defaultType],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setIsDragging(false)
      if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files)
    },
    [handleFiles],
  )

  const uploadAll = useCallback(async () => {
    // Последовательно: распознавание нагружает процессор, десяток параллельных OCR
    // на одном сервере — плохая идея
    for (const item of uploads) {
      if (item.status === "pending" || item.status === "error") {
        await uploadOne(item)
      }
    }
  }, [uploads, uploadOne])

  const removeUpload = (id: string) => {
    setUploads((prev) => prev.filter((entry) => entry.id !== id))
  }

  const done = useMemo(() => uploads.filter((entry) => entry.status === "done"), [uploads])
  // Кнопка «Загрузить все» — только для тех, что ещё не уходили; записи «ждёт
  // связи» отправляет очередь сама, вручную их повторять нельзя (будет дубль)
  const waiting = useMemo(
    () => uploads.filter((entry) => entry.status === "pending" || entry.status === "error"),
    [uploads],
  )

  const handleSave = () => {
    if (!done.length) return
    onUpload(done)
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
        {/* Тип для новых файлов: чеки и накладные распознаются сразу */}
        <div className="flex flex-wrap gap-2">
          {PHOTO_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setDefaultType(type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                defaultType === type
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-secondary/60"
              }`}
            >
              {photoTypeLabels[type]}
            </button>
          ))}
        </div>

        {!driverId && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Чьё фото:</span>
            <select
              value={staffDriverId}
              onChange={(event) => setStaffDriverId(event.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
            >
              <option value="">— выберите водителя —</option>
              {driverOptions.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name ?? "Водитель"}
                </option>
              ))}
            </select>
            {driverOptions.length === 0 && (
              <span className="text-amber-600">
                Водителей нет — загрузите фото из карточки рейса
              </span>
            )}
          </div>
        )}

        <div
          onDrop={handleDrop}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            isDragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
          }`}
        >
          <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-sm text-muted-foreground mb-2">
            Перетащите фото сюда или выберите файлы — тип:{" "}
            <b className="text-foreground">{photoTypeLabels[defaultType]}</b>
          </p>
          <label>
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) handleFiles(event.target.files)
                event.target.value = ""
              }}
            />
            <Button variant="outline" size="sm" asChild>
              <span className="cursor-pointer">Выберите файлы</span>
            </Button>
          </label>
          <p className="text-xs text-muted-foreground mt-4">
            Чек и накладную распознаёт локальный OCR — сумма и номер появятся здесь и попадут в
            расходы рейса
          </p>
        </div>

        {uploads.length > 0 && (
          <div className="space-y-3">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50"
              >
                <div className="h-16 w-16 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={upload.preview} alt="Превью" className="h-full w-full object-cover" />
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={upload.type}
                      onChange={(event) =>
                        setUploads((prev) =>
                          prev.map((entry) =>
                            entry.id === upload.id
                              ? { ...entry, type: event.target.value as PhotoType }
                              : entry,
                          ),
                        )
                      }
                      disabled={upload.status === "uploading" || upload.status === "done"}
                      className="h-7 rounded-lg border border-border bg-background px-2 text-xs"
                    >
                      {PHOTO_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {photoTypeLabels[type]}
                        </option>
                      ))}
                    </select>

                    {upload.status === "pending" && <Badge variant="secondary">Ожидание</Badge>}
                    {upload.status === "uploading" && (
                      <Badge variant="secondary" className="bg-primary/20 text-primary">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Загрузка и распознавание…
                      </Badge>
                    )}
                    {upload.status === "done" && (
                      <Badge variant="secondary" className="bg-success/20 text-success">
                        <Check className="h-3 w-3 mr-1" />
                        Загружено
                      </Badge>
                    )}
                    {upload.status === "queued" && (
                      <Badge variant="secondary" className="bg-sky-500/20 text-sky-500">
                        <Cloud className="h-3 w-3 mr-1" />
                        Ждёт связи — отправится сам
                      </Badge>
                    )}
                    {upload.status === "error" && (
                      <Badge variant="destructive">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {upload.error || "Ошибка"}
                      </Badge>
                    )}

                    {(upload.status === "pending" || upload.status === "error") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => void uploadOne(upload)}
                      >
                        Загрузить
                      </Button>
                    )}
                  </div>

                  {upload.status === "uploading" && <Progress value={60} className="h-1" />}

                  {upload.status === "done" && upload.result && (
                    <>
                      <p className="text-xs text-muted-foreground truncate">{upload.file.name}</p>
                      {ocrSummary(upload.result) && (
                        <p className="flex items-center gap-1.5 text-xs text-primary">
                          <ScanLine className="h-3 w-3" />
                          {ocrSummary(upload.result)}
                        </p>
                      )}
                      {upload.result.warnings.length > 0 && (
                        <p className="text-xs text-amber-600">
                          {upload.result.warnings.join("; ")}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="flex-shrink-0"
                  onClick={() => removeUpload(upload.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {waiting.length > 0 && (
              <Button variant="outline" className="w-full" onClick={() => void uploadAll()}>
                <Upload className="h-4 w-4 mr-2" />
                Загрузить все ({waiting.length})
              </Button>
            )}

            {done.length > 0 && (
              <Button className="w-full bg-primary text-primary-foreground" onClick={handleSave}>
                <Check className="h-4 w-4 mr-2" />
                Сохранить {done.length} фото
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
