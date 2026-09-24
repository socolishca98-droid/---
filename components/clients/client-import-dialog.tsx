"use client"

// components/clients/client-import-dialog.tsx
//
// Импорт клиентской базы (задача 5).
//
// Базы ведут по-разному: где-то Excel с «Наименование;Телефон;ИНН/КПП;Отсрочка»,
// где-то выгрузка из 1С, где-то CSV с запятыми и заголовками на английском.
// Поэтому импорт сначала показывает, что он понял: какой разделитель, где строка
// заголовков, какая колонка куда легла. Любую колонку можно переназначить руками,
// а на следующем шаге — посмотреть, кого создадут, кого дополнят и кого пропустят.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, ArrowRight, FileUp, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

/** Поля, в которые раскладываются колонки файла. Совпадают с IMPORT_FIELDS на сервере. */
const FIELD_LABELS: Array<{ id: string; label: string }> = [
  { id: "name", label: "Название" },
  { id: "inn", label: "ИНН" },
  { id: "kpp", label: "КПП" },
  { id: "address", label: "Адрес" },
  { id: "contactName", label: "Контактное лицо" },
  { id: "phone", label: "Телефон" },
  { id: "email", label: "E-mail" },
  { id: "paymentType", label: "Оплата" },
  { id: "vatType", label: "НДС" },
  { id: "deferredDays", label: "Отсрочка" },
  { id: "notes", label: "Примечание" },
]

const NONE = "__none__"

type ImportMode = "merge" | "add"

type Preview = {
  delimiter: string
  delimiterLabel: string
  headerRow: number
  columns: Array<{
    index: number
    header: string
    field: string | null
    sample: string
    combinedInnKpp?: boolean
  }>
  rows: Array<{
    line: number
    values: string[]
    fields: Record<string, unknown>
    existingClientId: string | null
    issues: Array<{ code: string; message: string; severity: "skip" | "warning" }>
  }>
  summary: {
    total: number
    create: number
    update: number
    skip: number
    noName: number
    duplicateExisting: number
    duplicateInFile: number
    invalidInn: number
    unmappedHeaders: string[]
    missingFields: string[]
  }
}

type Plan = {
  summary: { create: number; update: number; skip: number }
  rows: Array<{ line: number; action: string; changedFields: string[] }>
}

interface ClientImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}

export function ClientImportDialog({ open, onOpenChange, onImported }: ClientImportDialogProps) {
  const [text, setText] = useState("")
  const [sourceName, setSourceName] = useState<string | null>(null)
  const [mode, setMode] = useState<ImportMode>("merge")
  const [mapping, setMapping] = useState<Record<string, number>>({})
  const [headerRow, setHeaderRow] = useState<number | undefined>(undefined)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setText("")
    setSourceName(null)
    setMode("merge")
    setMapping({})
    setHeaderRow(undefined)
    setPreview(null)
    setPlan(null)
    setError(null)
  }, [])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const request = useCallback(
    async (payload: Record<string, unknown>) => {
      setIsWorking(true)
      setError(null)

      try {
        const res = await fetch("/api/clients/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => null)

        if (!res.ok || !data?.success) {
          throw new Error(data?.error || "Не удалось разобрать файл")
        }

        return data as { preview: Preview; plan: Plan; result?: Record<string, number> }
      } catch (e: any) {
        setError(e?.message || "Не удалось разобрать файл")
        return null
      } finally {
        setIsWorking(false)
      }
    },
    [],
  )

  const loadPreview = useCallback(
    async (options?: { mode?: ImportMode; mapping?: Record<string, number>; headerRow?: number }) => {
      if (!text.trim()) {
        setError("Вставьте данные или выберите файл клиентской базы")
        return
      }

      const data = await request({
        text,
        mode: options?.mode ?? mode,
        mapping: options?.mapping ?? mapping,
        headerRow: options?.headerRow ?? headerRow,
      })

      if (!data) return

      setPreview(data.preview)
      setPlan(data.plan)

      // ручных правок ещё нет — показываем распознавание системы
      if (!options?.mapping) {
        const detected: Record<string, number> = {}
        for (const column of data.preview.columns) {
          if (column.field) detected[column.field] = column.index
        }
        setMapping(detected)
      }
      if (options?.headerRow === undefined && headerRow === undefined) {
        setHeaderRow(data.preview.headerRow)
      }
    },
    [text, mode, mapping, headerRow, request],
  )

  const handleFile = async (file: File) => {
    const content = await file.text()
    setText(content)
    setSourceName(file.name)
    setPreview(null)
    setPlan(null)
  }

  const handleApply = async () => {
    const data = await request({ text, mode, mapping, headerRow, apply: true })
    if (!data?.result) return

    const parts = [
      `создано: ${data.result.created}`,
      `дополнено: ${data.result.updated}`,
      `пропущено: ${data.result.skipped}`,
    ]
    if (data.result.linkedOrders > 0) {
      parts.push(`заказов привязано к карточкам: ${data.result.linkedOrders}`)
    }

    toast.success("Импорт завершён", { description: parts.join(" · ") })
    onImported()
    onOpenChange(false)
  }

  const mappedFields = useMemo(
    () => new Set(Object.keys(mapping).filter((field) => mapping[field] !== undefined)),
    [mapping],
  )
  const hasNameColumn = mappedFields.has("name")

  const detectedLabel = preview
    ? `разделитель: ${preview.delimiterLabel}, строка заголовков: ${preview.headerRow + 1}`
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Импорт клиентской базы</DialogTitle>
          <DialogDescription>
            Подойдёт CSV, выгрузка из 1С или просто таблица, скопированная из Excel.
            Импорт сам определит разделитель и колонки — дальше можно поправить руками.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="mr-2 h-4 w-4" />
                Выбрать файл
              </Button>
              {sourceName && (
                <Badge variant="secondary" className="text-xs">
                  {sourceName}
                </Badge>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.tsv,text/csv,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
            </div>
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setSourceName(null)
                setPreview(null)
                setPlan(null)
              }}
              rows={5}
              className="font-mono text-xs"
              placeholder={"Наименование;Телефон;ИНН/КПП;Отсрочка\nООО Ромашка;+7 900 000-00-01;760100000000/760101001;14 дней"}
            />
            <p className="text-xs text-muted-foreground">
              Можно просто вставить таблицу из Excel — колонки разделятся сами.
            </p>
          </div>

          {!preview && (
            <Button type="button" onClick={() => void loadPreview()} disabled={isWorking || !text.trim()}>
              {isWorking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Разобрать файл
            </Button>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {preview && (
            <>
              <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                {detectedLabel}. Строк с данными: {preview.summary.total}.
              </div>

              <div className="space-y-2">
                <Label>Колонки файла</Label>
                <div className="rounded-lg border">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                        <tr className="text-left">
                          <th className="p-2 font-medium">В файле</th>
                          <th className="p-2 font-medium">Пример значения</th>
                          <th className="p-2 font-medium">Куда положить</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.columns.map((column) => (
                          <tr key={column.index} className="border-t">
                            <td className="max-w-[180px] truncate p-2" title={column.header}>
                              {column.header || `Колонка ${column.index + 1}`}
                            </td>
                            <td className="max-w-[200px] truncate p-2 text-muted-foreground">
                              {column.sample || "—"}
                            </td>
                            <td className="p-2">
                              <Select
                                value={
                                  Object.entries(mapping).find(
                                    ([, index]) => index === column.index,
                                  )?.[0] ?? NONE
                                }
                                onValueChange={(value) => {
                                  setMapping((prev) => {
                                    const next = { ...prev }
                                    for (const [field, index] of Object.entries(next)) {
                                      if (index === column.index) delete next[field]
                                    }
                                    if (value !== NONE) next[value] = column.index
                                    return next
                                  })
                                }}
                              >
                                <SelectTrigger className="h-8 w-[190px] text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NONE}>Не импортировать</SelectItem>
                                  {FIELD_LABELS.map((field) => (
                                    <SelectItem
                                      key={field.id}
                                      value={field.id}
                                      disabled={
                                        field.id !== "name" &&
                                        mapping[field.id] !== undefined &&
                                        mapping[field.id] !== column.index
                                      }
                                    >
                                      {field.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {preview.columns.some((column) => column.combinedInnKpp) && (
                  <p className="text-xs text-muted-foreground">
                    В колонке «ИНН/КПП» два числа — они разложены по длине: 10 или 12 цифр — ИНН,
                    9 — КПП.
                  </p>
                )}
                {!hasNameColumn && (
                  <p className="text-xs text-destructive">
                    Не выбрана колонка с названием клиента — без неё импорт не сможет завести карточки.
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Строка заголовков</Label>
                  <Select
                    value={String(headerRow ?? preview.headerRow)}
                    onValueChange={(value) => setHeaderRow(Number(value))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="-1">Без заголовков</SelectItem>
                      {Array.from({ length: Math.min(5, preview.rows.length + 1) }).map((_, index) => (
                        <SelectItem key={index} value={String(index)}>
                          {index + 1}-я строка
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Что делать с уже существующими клиентами</Label>
                  <RadioGroup
                    value={mode}
                    onValueChange={(value) => setMode(value as ImportMode)}
                    className="gap-2"
                  >
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs">
                      <RadioGroupItem value="merge" className="mt-0.5" />
                      <span>
                        <span className="font-medium">Дополнить карточку</span>
                        <span className="block text-muted-foreground">
                          Пустые поля заполнятся из файла, введённое вручную не перезапишется.
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-xs">
                      <RadioGroupItem value="add" className="mt-0.5" />
                      <span>
                        <span className="font-medium">Оставить как есть</span>
                        <span className="block text-muted-foreground">
                          Заводим только тех, кого в базе ещё нет.
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                </div>
              </div>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void loadPreview({ mapping, mode, headerRow })}
                disabled={isWorking}
              >
                {isWorking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Пересчитать
              </Button>

              {plan && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary">Создадим: {plan.summary.create}</Badge>
                    <Badge variant="secondary">Дополним: {plan.summary.update}</Badge>
                    <Badge variant="secondary">Пропустим: {plan.summary.skip}</Badge>
                    {preview.summary.invalidInn > 0 && (
                      <Badge variant="outline" className="border-amber-500/50 text-amber-600">
                        ИНН с вопросом: {preview.summary.invalidInn}
                      </Badge>
                    )}
                  </div>

                  <ScrollArea className="h-52 rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                        <tr className="text-left">
                          <th className="p-2 font-medium">Строка</th>
                          <th className="p-2 font-medium">Название</th>
                          <th className="p-2 font-medium">Что сделаем</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.rows.map((row) => {
                          const previewRow = preview.rows.find((item) => item.line === row.line)
                          const name = previewRow?.fields.name ?? "—"
                          const issues = previewRow?.issues ?? []

                          return (
                            <tr key={row.line} className="border-t align-top">
                              <td className="p-2 text-muted-foreground">{row.line + 1}</td>
                              <td className="max-w-[220px] p-2">
                                <div className="truncate" title={String(name)}>
                                  {String(name) || "—"}
                                </div>
                                {issues.map((issue, index) => (
                                  <div
                                    key={index}
                                    className={
                                      issue.severity === "warning"
                                        ? "text-amber-600"
                                        : "text-destructive"
                                    }
                                  >
                                    {issue.message}
                                  </div>
                                ))}
                              </td>
                              <td className="p-2">
                                {row.action === "create" ? (
                                  <Badge className="bg-emerald-600/90 text-[10px] hover:bg-emerald-600/90">
                                    создать
                                  </Badge>
                                ) : row.action === "update" ? (
                                  <span className="text-muted-foreground">
                                    дополнить
                                    {row.changedFields.length > 0
                                      ? `: ${row.changedFields
                                          .map(
                                            (field) =>
                                              FIELD_LABELS.find((item) => item.id === field)?.label ??
                                              field,
                                          )
                                          .join(", ")}`
                                      : ""}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">пропустить</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </ScrollArea>

                  {preview.summary.unmappedHeaders.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Не поняли колонки: {preview.summary.unmappedHeaders.join(", ")} — их можно
                      назначить выше.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {!preview && sourceName === null && text.trim() === "" && (
            <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <Upload className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Порядок: разобрать файл → проверить колонки → посмотреть, кого создадим,
                кого дополним → импортировать. После импорта заказы, у которых клиент записан
                просто именем, привяжутся к своим карточкам — история клиента соберётся сама.
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (preview) {
                setPreview(null)
                setPlan(null)
              } else {
                onOpenChange(false)
              }
            }}
          >
            {preview ? (
              <>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Изменить данные
              </>
            ) : (
              "Отмена"
            )}
          </Button>
          {plan && (
            <Button
              type="button"
              onClick={() => void handleApply()}
              disabled={isWorking || !hasNameColumn || plan.summary.create + plan.summary.update === 0}
            >
              {isWorking ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              Импортировать ({plan.summary.create + plan.summary.update})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
