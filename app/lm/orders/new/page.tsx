// app/lm/orders/new/page.tsx — создание заказа с телефона.
//
// Форма повторяет обязательный минимум серверной схемы (lib/validators.ts):
// откуда, куда и что везём. Остальное — цена, срок, контакт — по возможности.
// Ничего лишнего: логист на телефоне вводит данные в дороге, а не в офисе.

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { useStaffSession } from "@/hooks/use-staff-session"
import { apiSend } from "@/hooks/use-json-api"

interface FormState {
  routeFrom: string
  routeTo: string
  cargoType: string
  weight: string
  volume: string
  price: string
  clientName: string
  clientContact: string
  deadline: string
}

const EMPTY: FormState = {
  routeFrom: "",
  routeTo: "",
  cargoType: "",
  weight: "",
  volume: "",
  price: "",
  clientName: "",
  clientContact: "",
  deadline: "",
}

export default function NewOrderPage() {
  const router = useRouter()
  const { user } = useStaffSession()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)

  function update(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const canSubmit = form.routeFrom.trim().length > 0 && form.routeTo.trim().length > 0 && !saving

  async function submit() {
    if (!canSubmit) return
    setSaving(true)

    const payload: Record<string, unknown> = {
      routeFrom: form.routeFrom.trim(),
      routeTo: form.routeTo.trim(),
      cargoType: form.cargoType.trim() || "Груз",
      weight: form.weight.trim() || 0,
      volume: form.volume.trim() || undefined,
      price: form.price.trim() || 0,
      clientName: form.clientName.trim() || undefined,
      clientContact: form.clientContact.trim() || "",
    }
    if (form.deadline.trim()) {
      // <input type="date"> отдаёт «2026-10-12» — сервер принимает строку даты
      payload.deadline = new Date(`${form.deadline}T18:00:00`).toISOString()
    }

    const result = await apiSend<{ order?: { id: string } }>("/api/orders", "POST", payload)
    setSaving(false)

    if (!result.ok) {
      toast.error(result.error || "Не удалось создать заказ")
      return
    }

    toast.success("Заказ создан")
    const created = result.data?.order?.id
    router.replace(created ? `/lm/orders/${created}` : "/lm/orders")
  }

  return (
    <>
      <LogistHeader title="Новый заказ" subtitle="минимум данных" back userName={user?.name} />

      <div className="space-y-3 px-4 pt-4">
        <Field label="Откуда *">
          <input
            value={form.routeFrom}
            onChange={(event) => update("routeFrom", event.target.value)}
            placeholder="Москва, склад на Ленина, 5"
            className={inputClass}
          />
        </Field>

        <Field label="Куда *">
          <input
            value={form.routeTo}
            onChange={(event) => update("routeTo", event.target.value)}
            placeholder="Калуга, улица Московская, 289"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Груз">
            <input
              value={form.cargoType}
              onChange={(event) => update("cargoType", event.target.value)}
              placeholder="Паллеты, продукты"
              className={inputClass}
            />
          </Field>
          <Field label="Вес, кг">
            <input
              value={form.weight}
              onChange={(event) => update("weight", event.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="4200"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Объём, м³">
            <input
              value={form.volume}
              onChange={(event) => update("volume", event.target.value.replace(/[^\d.,]/g, ""))}
              inputMode="decimal"
              placeholder="26"
              className={inputClass}
            />
          </Field>
          <Field label="Цена, ₽">
            <input
              value={form.price}
              onChange={(event) => update("price", event.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="38000"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Клиент">
          <input
            value={form.clientName}
            onChange={(event) => update("clientName", event.target.value)}
            placeholder="ООО «Ромашка»"
            className={inputClass}
          />
        </Field>

        <Field label="Контакт клиента">
          <input
            value={form.clientContact}
            onChange={(event) => update("clientContact", event.target.value)}
            placeholder="Петрова Ольга, +7 495 123-45-67"
            className={inputClass}
          />
        </Field>

        <Field label="Выгрузить до">
          <input
            type="date"
            value={form.deadline}
            onChange={(event) => update("deadline", event.target.value)}
            className={`${inputClass} [color-scheme:dark]`}
          />
        </Field>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="mt-1 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 text-[15px] font-semibold text-white active:bg-orange-600 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {saving ? "Создаю…" : "Создать заказ"}
        </button>

        <p className="pb-2 text-center text-[12px] text-zinc-600">
          * обязательные поля — откуда и куда. Водителя и машину можно назначить после создания.
        </p>
      </div>
    </>
  )
}

const inputClass =
  "min-h-[48px] w-full rounded-xl border border-white/8 bg-white/[0.04] px-3.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-orange-500/50 focus:outline-none"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
