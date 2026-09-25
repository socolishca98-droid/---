"use client"

// components/routes/route-documents-dialog.tsx
//
// Формирование документов по маршруту (задача 3, пункт 3).
//
// Логист галочками выбирает, что печатать: транспортные накладные и заявки
// печатаются по каждому заказу рейса, путевой лист — один на рейс. Дальше
// открывается печатная страница, откуда документы уходят на принтер или
// сохраняются в PDF средствами браузера.
//
// Перед печатью проверяем, что в настройках заполнены реквизиты организации:
// без них бланк уйдёт с пустыми полями, и это лучше увидеть здесь, а не на
// бумаге.

import { useEffect, useState } from "react"
import { AlertTriangle, FileText, Loader2, Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DOCUMENT_HINTS, DOCUMENT_KINDS, DOCUMENT_TITLES, type DocumentKind } from "@/lib/documents/types"

interface RouteDocumentsDialogProps {
  routeId: string
  ordersCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsLike = {
  legalName?: string | null
  inn?: string | null
  legalAddress?: string | null
}

export function RouteDocumentsDialog({
  routeId,
  ordersCount,
  open,
  onOpenChange,
}: RouteDocumentsDialogProps) {
  // По умолчанию — полный комплект: обычно печатают всё сразу
  const [kinds, setKinds] = useState<Record<DocumentKind, boolean>>({
    ttn: true,
    waybill: true,
    contract: true,
  })
  const [settings, setSettings] = useState<SettingsLike | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setIsChecking(true)

    fetch("/api/fleet/settings")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.success) setSettings(data.settings || {})
      })
      .catch(() => {
        if (!cancelled) setSettings(null)
      })
      .finally(() => {
        if (!cancelled) setIsChecking(false)
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const selected = DOCUMENT_KINDS.filter((kind) => kinds[kind])
  const missingRequisites =
    settings !== null && (!settings.legalName || !settings.inn || !settings.legalAddress)

  const canPrintOrders = ordersCount > 0

  const handlePrint = () => {
    if (selected.length === 0) return
    const types = selected.join(",")
    window.open(`/print/route/${routeId}?types=${encodeURIComponent(types)}`, "_blank")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Документы по рейсу
          </DialogTitle>
          <DialogDescription>
            Выберите, что печатать. Накладные и заявки печатаются по каждому заказу
            рейса, путевой лист — один на рейс.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {DOCUMENT_KINDS.map((kind) => {
            const isPerOrder = kind !== "waybill"
            const disabled = isPerOrder && !canPrintOrders

            return (
              <label
                key={kind}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  disabled ? "cursor-not-allowed opacity-60" : "hover:border-primary/40"
                }`}
              >
                <Checkbox
                  checked={kinds[kind]}
                  disabled={disabled}
                  onCheckedChange={(value) =>
                    setKinds((prev) => ({ ...prev, [kind]: value === true }))
                  }
                  className="mt-0.5"
                />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">
                    {DOCUMENT_TITLES[kind]}
                    {isPerOrder ? ` — ${ordersCount} шт.` : " — 1 шт."}
                  </div>
                  <div className="text-xs text-muted-foreground">{DOCUMENT_HINTS[kind]}</div>
                  {disabled ? (
                    <div className="text-xs text-amber-600">
                      В рейсе пока нет заказов
                    </div>
                  ) : null}
                </div>
              </label>
            )
          })}

          {isChecking ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Проверяю реквизиты организации…
            </div>
          ) : missingRequisites ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                В настройках автопарка не заполнены реквизиты организации (наименование,
                ИНН, адрес). Документ напечатается с пустыми строками — заполнить можно
                во вкладке «Автопарк» → «Настройки».
              </span>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={handlePrint} disabled={selected.length === 0}>
              <Printer className="mr-2 h-4 w-4" />
              Открыть для печати
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
