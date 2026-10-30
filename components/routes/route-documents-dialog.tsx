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

import Link from "next/link"

import { useEffect, useState } from "react"
import { AlertTriangle, ArrowUpRight, FileText, Loader2, Printer } from "lucide-react"

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
import { missingForDocuments, type MissingRouteLike } from "@/lib/documents/missing"

interface RouteDocumentsDialogProps {
  routeId: string
  ordersCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Данные рейса для проверки «чего не хватает»: экипаж и заказы.
   * Если не переданы (например, карточка активного рейса не грузила заказы),
   * диалог проверяет только реквизиты организации, как раньше.
   */
  routeData?: MissingRouteLike
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
  routeData,
}: RouteDocumentsDialogProps) {
  // По умолчанию — комплект ttn/waybill/contract (DEFAULT_DOCUMENT_KINDS):
  // обычно печатают его сразу. Счёт и акт — по явному выбору: это документы
  // денег, их готовят осознанно, когда переговоры закончены.
  const [kinds, setKinds] = useState<Record<DocumentKind, boolean>>({
    ttn: true,
    waybill: true,
    contract: true,
    invoice: false,
    act: false,
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

  // «Чего не хватает» считаем сразу, как только пришли настройки и известны
  // данные рейса: диалог всегда получает routeData (оба места вызова), но на
  // случай его отсутствия — реквизиты проверяем по-прежнему.
  const requisitesLike = settings
    ? {
        legalName: settings.legalName,
        inn: settings.inn,
        legalAddress: settings.legalAddress,
      }
    : null

  const missingItems = missingForDocuments({
    route: routeData ?? { driverName: null, vehiclePlate: null, orders: [] },
    requisites: requisitesLike,
  })

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

          {ordersCount === 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                В рейсе пока нет заказов — напечатается только путевой лист. Накладные,
                счета и акты появятся, когда в рейс добавят грузы.
              </span>
            </div>
          ) : null}
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
              Проверяю документы и реквизиты…
            </div>
          ) : missingItems.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span>
                Для документов всё есть: экипаж, цены, клиенты и реквизиты заполнены.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                Чего не хватает: {missingItems.length}{" "}
                {missingItems.length === 1 ? "пункт" : missingItems.length < 5 ? "пункта" : "пунктов"}
              </div>
              {missingItems.map((item) => (
                <div
                  key={item.key}
                  className={`rounded-lg border p-2.5 text-xs ${
                    item.severity === "blocker"
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  }`}
                >
                  <div className="font-medium">
                    {item.severity === "blocker" ? "Без этого документ недействителен: " : ""}
                    {item.label}
                  </div>
                  <div className="mt-0.5 text-muted-foreground/90">{item.hint}</div>
                  {/* Прямой переход к тому, что надо дозаполнить: искать
                      «Настройки → Реквизиты» по меню логист не должен. */}
                  {item.fix && (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 px-2 text-xs"
                    >
                      <Link href={item.fix.href} onClick={() => onOpenChange(false)}>
                        {item.fix.label}
                        <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

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
