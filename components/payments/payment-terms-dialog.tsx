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

const NONE = "__none__"

const PAYMENT_TYPES = [
  { id: "cash", label: "Наличные" },
  { id: "bank", label: "Безнал" },
  { id: "card", label: "Карта" },
]

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
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toISOString().slice(0, 10)
}

export function PaymentTermsDialog({
  open,
  onOpenChange,
  target,
  onSaved,
}: PaymentTermsDialogProps) {
  const [paymentType, setPaymentType] = useState<string>(NONE)
  const [vatType, setVatType] = useState<string>(NONE)
  const [deferredDays, setDeferredDays] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [amount, setAmount] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !target) return

    setPaymentType(target.paymentType ?? NONE)
    setVatType(target.vatType ?? NONE)
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
