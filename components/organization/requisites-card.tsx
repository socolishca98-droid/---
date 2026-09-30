"use client"

// components/organization/requisites-card.tsx
//
// Реквизиты организации — это ИНФОРМАЦИЯ о ней, поэтому карточка живёт на
// странице «Организация», а не в «Настройках». Печатаются в ТТН, путевом
// листе и договоре-заявке; сохраняются отдельно от прочих настроек
// (POST /api/fleet/settings обновляет только переданные поля).

import { useEffect, useState } from "react"
import { Save, Stamp } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const FIELDS: Array<{ key: string; label: string; placeholder?: string }> = [
  { key: "legalName", label: "Юридическое имя", placeholder: "ООО «…»" },
  { key: "inn", label: "ИНН" },
  { key: "kpp", label: "КПП" },
  { key: "ogrn", label: "ОГРН" },
  { key: "legalAddress", label: "Юридический адрес" },
  { key: "phone", label: "Телефон" },
  { key: "email", label: "E-mail" },
  { key: "bankName", label: "Банк" },
  { key: "bankBic", label: "БИК" },
  { key: "bankAccount", label: "Расчётный счёт" },
  { key: "signerName", label: "Подписант" },
  { key: "signerPosition", label: "Должность подписанта" },
]

export function RequisitesCard() {
  const [form, setForm] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch("/api/fleet/settings", { credentials: "include" })
        const data = await res.json().catch(() => null)
        if (!alive || !res.ok || !data?.settings) return
        const next: Record<string, string> = {}
        for (const field of FIELDS) {
          const value = (data.settings as Record<string, unknown>)[field.key]
          next[field.key] = value === null || value === undefined ? "" : String(value)
        }
        setForm(next)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {}
      for (const field of FIELDS) payload[field.key] = form[field.key] ?? null
      const res = await fetch("/api/fleet/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "Ошибка сохранения")
      }
      toast.success("Реквизиты сохранены — документы будут печататься с ними")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не сохранилось")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Stamp className="h-5 w-5 text-primary" />
          Реквизиты организации
        </CardTitle>
        <CardDescription>
          Печатаются в ТТН, путевом листе и договоре-заявке от имени вашей
          организации. Пустое поле уходит в документ строкой для заполнения от
          руки
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`org-req-${field.key}`}>{field.label}</Label>
              <Input
                id={`org-req-${field.key}`}
                value={form[field.key] ?? ""}
                disabled={loading}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
                placeholder={field.placeholder}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving || loading}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Сохраняем…" : "Сохранить реквизиты"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
