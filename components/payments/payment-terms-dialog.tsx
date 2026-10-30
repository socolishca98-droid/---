"use client"

// components/payments/payment-terms-dialog.tsx
//
// Условия оплаты заказа (задача 6): форма оплаты, НДС, отсрочка, срок и суммы.
// Меняется то же, что и в бухгалтерии: когда выставлять счёт и по какой сумме.

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { toDateInputValue } from "@/lib/dates"
import { normalizePaymentType, normalizeVatType } from "@/lib/payments/summary"

const NONE = "__none__"

const PAYMENT_TYPES = [
  { id: "cash", label: "Наличные" },
  { id: "bank", label: "Безнал" },
  { id: "card", label: "Карта" },
]

/** Подписи для значений, которых нет в списке (встречаются в старых заказах). */
const PAYMENT_LABELS_EXTRA: Record<string, string> = {
  prepay: "Предоплата",
  cash_on_delivery: "Оплата при получении",
  deferred: "Отсрочка платежа",
}

const VAT_LABELS_EXTRA: Record<string, string> = {
  no_vat: "Без НДС",
  without_vat: "Без НДС",
  with_vat: "С НДС",
}

const VAT_TYPES = [
  { id: "none", label: "Без НДС" },
  { id: "vat20", label: "НДС 20%" },
  { id: "vat10", label: "НДС 10%" },
  { id: "included", label: "НДС включён" },
]

export type PaymentTermsTarget = {
  id: string
  clientName: string
  amount: number
  paymentType: string | null
  vatType: string | null
  deferredDays: number
  dueDate: string | null
}

interface PaymentTermsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: PaymentTermsTarget | null
  onSaved: () => void
}

function toDateInput(value: string | null) {
  // Календарная дата приходит с сервера строкой «2026-09-28»: пересчёт через
  // toISOString() показывал бы в поле день раньше (lib/dates.ts)
  return toDateInputValue(value)
}

export function PaymentTermsDialog({
  open,
  onOpenChange,
  target,
  onSaved,
}: PaymentTermsDialogProps) {
  const [paymentType, setPaymentType] = useState<string>(NONE)
  const [vatType, setVatType] = useState<string>(NONE)
  // Исходное значение из базы, если справочник его не знает («prepay»,
  // «cash_on_delivery»): показываем как есть и сохраняем без изменений, а не
  // стираем молча.
  const [rawPaymentType, setRawPaymentType] = useState<string | null>(null)
  const [rawVatType, setRawVatType] = useState<string | null>(null)
  const [deferredDays, setDeferredDays] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [amount, setAmount] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !target) return

    // Старые значения («prepay», «no_vat», «20») приводим к списку формы,
    // иначе поле показывало пусто и сохранение стирало условие.
    const payment = normalizePaymentType(target.paymentType)
    const vat = normalizeVatType(target.vatType)
    // Неизвестное справочнику значение оставляем выбранным: сохранить без
    // изменений — значит не потерять, а «Не указана» — осознанно стереть.
    setPaymentType(payment ?? target.paymentType ?? NONE)
    setVatType(vat ?? target.vatType ?? NONE)
    setRawPaymentType(!payment && target.paymentType ? target.paymentType : null)
    setRawVatType(!vat && target.vatType ? target.vatType : null)
    setDeferredDays(target.deferredDays > 0 ? String(target.deferredDays) : "")
    setDueDate(toDateInput(target.dueDate))
    setAmount(String(target.amount || ""))
    setError(null)
  }, [open, target])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return

    setIsSaving(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {
        orderId: target.id,
        paymentType: paymentType === NONE ? null : paymentType,
        vatType: vatType === NONE ? null : vatType,
        deferredDays: deferredDays === "" ? null : Number(deferredDays),
      }

      // Срок оплаты отправляем только когда его задали руками: иначе сервер
      // сам пересчитает его от отсрочки и даты заказа.
      if (dueDate !== toDateInput(target.dueDate)) {
        payload.dueDate = dueDate === "" ? null : dueDate
      }

      if (amount !== "" && Number(amount) !== target.amount) {
        payload.agreedPrice = Number(amount)
      }

      const res = await fetch("/api/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось сохранить условия оплаты")
      }

      toast.success("Условия оплаты обновлены")
      onSaved()
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить условия оплаты")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Условия оплаты</DialogTitle>
          <DialogDescription>
            {target ? `${target.clientName} · заказ ${target.id}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Форма оплаты</Label>
              <Select value={paymentType} onValueChange={setPaymentType}>
                <SelectTrigger>
                  <SelectValue placeholder="Не указана" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Не указана</SelectItem>
                  {rawPaymentType ? (
                    <SelectItem value={rawPaymentType}>
                      {PAYMENT_LABELS_EXTRA[rawPaymentType] ?? rawPaymentType}
                    </SelectItem>
                  ) : null}
                  {PAYMENT_TYPES.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>НДС</Label>
              <Select value={vatType} onValueChange={setVatType}>
                <SelectTrigger>
                  <SelectValue placeholder="Не указан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Не указан</SelectItem>
                  {rawVatType ? (
                    <SelectItem value={rawVatType}>
                      {VAT_LABELS_EXTRA[rawVatType] ?? rawVatType}
                    </SelectItem>
                  ) : null}
                  {VAT_TYPES.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Отсрочка, дней</Label>
              <Input
                value={deferredDays}
                onChange={(event) => setDeferredDays(event.target.value)}
                placeholder="14"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                Срок пересчитается от даты заказа.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Срок оплаты</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Сумма к оплате, ₽</Label>
            <Input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="numeric"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
