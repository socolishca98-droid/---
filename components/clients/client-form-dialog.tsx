"use client"

// components/clients/client-form-dialog.tsx
//
// Карточка клиента: создание и правка (задача 5).
// Телефон, ИНН, КПП и отсрочка приводятся к одному виду на сервере — здесь
// только ввод, поэтому форма не мешает писать так, как удобно человеку.

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
import { Textarea } from "@/components/ui/textarea"

export type ClientFormValues = {
  name: string
  inn: string
  kpp: string
  address: string
  contactName: string
  phone: string
  email: string
  paymentType: string
  vatType: string
  deferredDays: string
  notes: string
}

export const EMPTY_CLIENT: ClientFormValues = {
  name: "",
  inn: "",
  kpp: "",
  address: "",
  contactName: "",
  phone: "",
  email: "",
  paymentType: "",
  vatType: "",
  deferredDays: "",
  notes: "",
}

export function clientToForm(client: Record<string, unknown> | null): ClientFormValues {
  if (!client) return EMPTY_CLIENT

  const pick = (key: string) => {
    const value = client[key]
    return value === null || value === undefined ? "" : String(value)
  }

  return {
    name: pick("name"),
    inn: pick("inn"),
    kpp: pick("kpp"),
    address: pick("address"),
    contactName: pick("contactName"),
    phone: pick("phone"),
    email: pick("email"),
    paymentType: pick("paymentType"),
    vatType: pick("vatType"),
    deferredDays: pick("deferredDays"),
    notes: pick("notes"),
  }
}

interface ClientFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null — создание нового клиента. */
  clientId: string | null
  initial: ClientFormValues
  onSaved: () => void
}

export function ClientFormDialog({
  open,
  onOpenChange,
  clientId,
  initial,
  onSaved,
}: ClientFormDialogProps) {
  const [values, setValues] = useState<ClientFormValues>(initial)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setValues(initial)
      setError(null)
    }
  }, [open, initial])

  const update = (key: keyof ClientFormValues, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {
        name: values.name,
        inn: values.inn || null,
        kpp: values.kpp || null,
        address: values.address || null,
        contactName: values.contactName || null,
        phone: values.phone || null,
        email: values.email || null,
        paymentType: values.paymentType || null,
        vatType: values.vatType || null,
        deferredDays: values.deferredDays === "" ? null : values.deferredDays,
        notes: values.notes || null,
      }

      const res = await fetch(clientId ? `/api/clients/${clientId}` : "/api/clients", {
        method: clientId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Не удалось сохранить клиента")
      }

      toast.success(clientId ? "Клиент обновлён" : "Клиент добавлен")
      onSaved()
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить клиента")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{clientId ? "Карточка клиента" : "Новый клиент"}</DialogTitle>
          <DialogDescription>
            Телефон, ИНН, КПП и отсрочку можно писать как удобно — система приведёт
            их к одному виду.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Название *</Label>
            <Input
              value={values.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="ООО Ромашка"
              required
            />
            <p className="text-xs text-muted-foreground">
              Дубликат не заведётся: «ООО &quot;Ромашка&quot;» и «Ромашка» — один клиент.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>ИНН</Label>
              <Input value={values.inn} onChange={(e) => update("inn", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>КПП</Label>
              <Input value={values.kpp} onChange={(e) => update("kpp", e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Адрес</Label>
            <Input
              value={values.address}
              onChange={(e) => update("address", e.target.value)}
              placeholder="150000, г. Ярославль, ул. Промышленная, д. 5"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Контактное лицо</Label>
              <Input
                value={values.contactName}
                onChange={(e) => update("contactName", e.target.value)}
                placeholder="Пётр Иванов"
              />
            </div>
            <div className="space-y-2">
              <Label>Телефон</Label>
              <Input
                value={values.phone}
                onChange={(e) => update("phone", e.target.value)}
                placeholder="+7 900 000-00-00"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input value={values.email} onChange={(e) => update("email", e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Оплата</Label>
              <Input
                value={values.paymentType}
                onChange={(e) => update("paymentType", e.target.value)}
                placeholder="безнал"
              />
            </div>
            <div className="space-y-2">
              <Label>НДС</Label>
              <Input
                value={values.vatType}
                onChange={(e) => update("vatType", e.target.value)}
                placeholder="без НДС"
              />
            </div>
            <div className="space-y-2">
              <Label>Отсрочка, дней</Label>
              <Input
                value={values.deferredDays}
                onChange={(e) => update("deferredDays", e.target.value)}
                placeholder="14"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Примечание</Label>
            <Textarea
              value={values.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={3}
              placeholder="Постоянный клиент, платит по средам"
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
