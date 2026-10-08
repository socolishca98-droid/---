// app/lm/orders/new/page.tsx — создание заказа с телефона.
//
// Экран ведёт по шагам, как туннель: сначала «откуда и куда» (без этих двух
// полей заказа не будет), потом груз, потом клиент и деньги. У каждого поля
// есть подсказка-пример, а если что-то не так — текст об ошибке появляется
// под этим полем, а не всплывашкой внизу экрана.
//
// Заказчика и адреса не заставляем вводить руками: города подставляются из
// прошлых заказов, клиенты — из справочника (вместе с телефоном). Это те
// данные, которые уже есть в системе, — грех их не подсказать.
//
// Обязательный минимум — тот же, что в серверной схеме (lib/validators.ts):
// откуда, куда и что везём. Остальное можно дозаполнить в карточке заказа:
// экран карточки сам подскажет, чего не хватает.

"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRight, Check, Loader2, MapPin, User, Wallet } from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { useStaffSession } from "@/hooks/use-staff-session"
import { apiSend, useJsonApi } from "@/hooks/use-json-api"

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

type FieldName = keyof FormState

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

/** Что чаще всего везут — подсказки на старте, дальше подставляются свои. */
const CARGO_HINTS = ["Паллеты", "Продукты", "Стройматериалы", "Оборудование", "Металл"]

interface ClientSuggestion {
  id: string
  name: string
  phone: string | null
  contactName: string | null
}

export default function NewOrderPage() {
  const router = useRouter()
  const { user } = useStaffSession()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [saving, setSaving] = useState(false)
  const [focus, setFocus] = useState<FieldName | null>(null)
  const [ownDate, setOwnDate] = useState(false)
  const [pickedClient, setPickedClient] = useState<string | null>(null)

  const fromRef = useRef<HTMLInputElement | null>(null)
  const toRef = useRef<HTMLInputElement | null>(null)

  // Подсказки берём из того, что уже есть: адреса прошлых заказов и клиенты
  const recentOrders = useJsonApi<{ orders: { routeFrom: string; routeTo: string; cargoType: string | null }[] }>(
    user ? "/api/orders?limit=200" : null,
  )
  const clientsState = useJsonApi<{ clients: ClientSuggestion[] }>(user ? "/api/clients" : null)

  const addressSuggestions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const order of recentOrders.data?.orders ?? []) {
      for (const address of [order.routeFrom, order.routeTo]) {
        const clean = address?.trim()
        if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean)
      }
    }
    return [...seen.values()]
  }, [recentOrders.data])

  const cargoSuggestions = useMemo(() => {
    const seen = new Set<string>()
    for (const order of recentOrders.data?.orders ?? []) {
      const clean = order.cargoType?.trim()
      if (clean && clean !== "Груз") seen.add(clean)
    }
    return [...CARGO_HINTS.filter((item) => !seen.has(item)), ...seen].slice(0, 8)
  }, [recentOrders.data])

  function update(field: FieldName, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (field === "clientName") setPickedClient(null)
  }

  function suggestAddress(field: "routeFrom" | "routeTo"): string[] {
    const value = form[field].trim().toLowerCase()
    const other = field === "routeFrom" ? form.routeTo.trim().toLowerCase() : form.routeFrom.trim().toLowerCase()
    return addressSuggestions
      .filter((item) => item.toLowerCase() !== other)
      .filter((item) => (value.length === 0 ? true : item.toLowerCase().includes(value)))
      .slice(0, 4)
  }

  function suggestClients(): ClientSuggestion[] {
    const value = form.clientName.trim().toLowerCase()
    const list = clientsState.data?.clients ?? []
    return list
      .filter((client) => (value.length === 0 ? false : client.name.toLowerCase().includes(value)))
      .slice(0, 4)
  }

  function pickDeadline(days: number | null) {
    if (days === null) {
      setOwnDate(true)
      return
    }
    const date = new Date()
    date.setDate(date.getDate() + days)
    setOwnDate(false)
    update("deadline", date.toISOString().slice(0, 10))
  }

  /** Проверка перед отправкой: возвращает поля с ошибками. */
  function validate(): Partial<Record<FieldName, string>> {
    const next: Partial<Record<FieldName, string>> = {}
    if (!form.routeFrom.trim()) next.routeFrom = "Укажите, откуда везём — это обязательное поле"
    if (!form.routeTo.trim()) next.routeTo = "Укажите, куда везём — это обязательное поле"
    else if (form.routeTo.trim().toLowerCase() === form.routeFrom.trim().toLowerCase()) {
      next.routeTo = "Откуда и куда совпадают — проверьте адреса"
    }
    const weight = Number(form.weight || 0)
    if (weight > 40000) next.weight = "Больше 40 тонн в одну машину не влезет — проверьте вес"
    return next
  }

  async function submit() {
    const found = validate()
    setErrors(found)

    if (Object.keys(found).length > 0) {
      toast.error("Проверьте выделенные поля")
      if (found.routeFrom) fromRef.current?.focus()
      else if (found.routeTo) toRef.current?.focus()
      return
    }

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
      // <input type="date"> отдаёт «2026-10-12»; сервер принимает строку даты
      payload.deadline = new Date(`${form.deadline}T18:00:00`).toISOString()
    }

    const result = await apiSend<{ order?: { id: string } }>("/api/orders", "POST", payload)
    setSaving(false)

    if (!result.ok) {
      toast.error(result.error || "Не удалось создать заказ")
      return
    }

    toast.success("Заказ создан — в карточке подскажем, что дальше")
    const created = result.data?.order?.id
    router.replace(created ? `/lm/orders/${created}` : "/lm/orders")
  }

  const readyToSave = form.routeFrom.trim().length > 0 && form.routeTo.trim().length > 0

  return (
    <>
      <LogistHeader title="Новый заказ" subtitle="Два поля — и заказ готов" back userName={user?.name} />

      <div className="space-y-3 px-4 pt-4">
        {/* Шаг 1. Маршрут */}
        <Step n={1} title="Откуда и куда" hint="Обязательное. Города подставим из прошлых заказов.">
          <div className="space-y-3">
            <SuggestionField
              label="Откуда"
              value={form.routeFrom}
              error={errors.routeFrom}
              placeholder="Москва, склад на Ленина, 5"
              icon={<MapPin className="h-4 w-4" />}
              suggestions={focus === "routeFrom" ? suggestAddress("routeFrom") : []}
              onFocus={() => setFocus("routeFrom")}
              onBlur={() => setFocus(null)}
              onChange={(value) => update("routeFrom", value)}
              onPick={(value) => {
                update("routeFrom", value)
                setFocus(null)
              }}
              inputRef={fromRef}
            />
            <SuggestionField
              label="Куда"
              value={form.routeTo}
              error={errors.routeTo}
              placeholder="Калуга, улица Московская, 289"
              icon={<MapPin className="h-4 w-4" />}
              suggestions={focus === "routeTo" ? suggestAddress("routeTo") : []}
              onFocus={() => setFocus("routeTo")}
              onBlur={() => setFocus(null)}
              onChange={(value) => update("routeTo", value)}
              onPick={(value) => {
                update("routeTo", value)
                setFocus(null)
              }}
              inputRef={toRef}
            />
          </div>
        </Step>

        {/* Шаг 2. Груз */}
        <Step n={2} title="Груз" hint="Можно пропустить: вес и объём уточните позже.">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] text-zinc-500">Что везём</span>
              <input
                value={form.cargoType}
                onChange={(event) => update("cargoType", event.target.value)}
                placeholder="Паллеты, продукты…"
                className={inputClass}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {cargoSuggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => update("cargoType", item)}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] ${
                    form.cargoType === item
                      ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                      : "border-white/10 text-zinc-300"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] text-zinc-500">Вес, кг</span>
                <input
                  value={form.weight}
                  onChange={(event) => update("weight", event.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  placeholder="4200"
                  className={fieldClass(Boolean(errors.weight))}
                />
                {errors.weight ? <ErrorText>{errors.weight}</ErrorText> : null}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] text-zinc-500">Объём, м³</span>
                <input
                  value={form.volume}
                  onChange={(event) => update("volume", event.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  placeholder="26"
                  className={inputClass}
                />
              </label>
            </div>
          </div>
        </Step>

        {/* Шаг 3. Клиент и деньги */}
        <Step n={3} title="Клиент и деньги" hint="Можно заполнить потом — карточка напомнит.">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-zinc-500">
                <User className="h-3.5 w-3.5" /> Клиент
              </span>
              <input
                value={form.clientName}
                onChange={(event) => update("clientName", event.target.value)}
                onFocus={() => setFocus("clientName")}
                onBlur={() => window.setTimeout(() => setFocus(null), 150)}
                placeholder="ООО «Ромашка»"
                className={pickedClient ? `${inputClass} border-emerald-500/40` : inputClass}
              />
              {pickedClient ? (
                <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-emerald-300">
                  <Check className="h-3.5 w-3.5" /> {pickedClient}
                </span>
              ) : (
                <span className="mt-1.5 block text-[12px] text-zinc-600">
                  Начните вводить — подставим контакт из справочника
                </span>
              )}
            </label>

            {focus === "clientName" && suggestClients().length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {suggestClients().map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => {
                      update("clientName", client.name)
                      if (client.phone) update("clientContact", client.phone)
                      setPickedClient(
                        client.phone ? `Контакт подставлен: ${client.phone}` : "Клиент из справочника",
                      )
                      setFocus(null)
                    }}
                    className="rounded-full border border-white/10 px-3 py-1.5 text-[12.5px] text-zinc-200"
                  >
                    {client.name}
                    {client.phone ? ` · ${client.phone}` : ""}
                  </button>
                ))}
              </div>
            ) : null}

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] text-zinc-500">Контакт клиента</span>
              <input
                value={form.clientContact}
                onChange={(event) => update("clientContact", event.target.value)}
                inputMode="tel"
                placeholder="Петрова Ольга, +7 495 123-45-67"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-zinc-500">
                <Wallet className="h-3.5 w-3.5" /> Цена, ₽
              </span>
              <input
                value={form.price}
                onChange={(event) => update("price", event.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="38000"
                className={inputClass}
              />
            </label>

            <div>
              <span className="mb-1.5 block text-[12.5px] text-zinc-500">Выгрузить до</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: "today", label: "Сегодня", days: 0 },
                  { id: "tomorrow", label: "Завтра", days: 1 },
                  { id: "plus3", label: "Через 3 дня", days: 3 },
                ].map((item) => {
                  const active = !ownDate && form.deadline === isoDay(item.days)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pickDeadline(item.days)}
                      className={`rounded-full border px-3 py-1.5 text-[12.5px] ${
                        active
                          ? "border-orange-500/40 bg-orange-500/15 text-orange-300"
                          : "border-white/10 text-zinc-300"
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => pickDeadline(null)}
                  className={`rounded-full border px-3 py-1.5 text-[12.5px] ${
                    ownDate ? "border-orange-500/40 bg-orange-500/15 text-orange-300" : "border-white/10 text-zinc-300"
                  }`}
                >
                  Своя дата
                </button>
              </div>
              {ownDate ? (
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(event) => update("deadline", event.target.value)}
                  className={`${inputClass} mt-2 [color-scheme:dark]`}
                />
              ) : null}
            </div>
          </div>
        </Step>

        {/* Итог перед сохранением: видно, что получится */}
        {readyToSave ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
            <p className="text-[12px] uppercase tracking-wide text-zinc-500">Получится</p>
            <p className="mt-1 flex items-center gap-1.5 text-[14px] font-medium text-white">
              <span className="truncate">{form.routeFrom.trim()}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />
              <span className="truncate">{form.routeTo.trim()}</span>
            </p>
            <p className="mt-0.5 text-[12.5px] text-zinc-400">
              {[
                form.cargoType.trim() || "груз",
                form.weight.trim() ? `${form.weight.trim()} кг` : null,
                form.price.trim() ? `${Number(form.price).toLocaleString("ru-RU")} ₽` : "цена потом",
                form.clientName.trim() || "клиент потом",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ) : null}

        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className="mt-1 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-orange-500 text-[15px] font-semibold text-white active:bg-orange-600 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {saving ? "Создаю…" : "Создать заказ"}
        </button>

        <p className="pb-2 text-center text-[12px] text-zinc-600">
          Водителя и машину назначите в карточке — или соберёте заказ в рейс.
        </p>
      </div>
    </>
  )
}

function isoDay(daysFromToday: number): string {
  const date = new Date()
  date.setDate(date.getDate() + daysFromToday)
  return date.toISOString().slice(0, 10)
}

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.02] p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-[12px] font-semibold text-orange-300">
          {n}
        </span>
        <div className="min-w-0">
          <p className="text-[14.5px] font-semibold text-white">{title}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-zinc-500">{hint}</p>
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** Поле адреса с подсказками из прошлых заказов. */
function SuggestionField({
  label,
  value,
  error,
  placeholder,
  icon,
  suggestions,
  onFocus,
  onBlur,
  onChange,
  onPick,
  inputRef,
}: {
  label: string
  value: string
  error?: string
  placeholder: string
  icon: React.ReactNode
  suggestions: string[]
  onFocus: () => void
  onBlur: () => void
  onChange: (value: string) => void
  onPick: (value: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-zinc-500">
          {icon} {label}
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          className={fieldClass(Boolean(error))}
        />
      </label>
      {error ? (
        <ErrorText>{error}</ErrorText>
      ) : suggestions.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onPick(item)}
              className="max-w-full truncate rounded-full border border-white/10 px-3 py-1.5 text-[12.5px] text-zinc-300"
            >
              {item}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <span className="mt-1.5 block text-[12px] text-red-300">{children}</span>
}

const inputClass =
  "min-h-[48px] w-full rounded-xl border border-white/8 bg-white/[0.04] px-3.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-orange-500/50 focus:outline-none"

function fieldClass(invalid: boolean): string {
  return invalid
    ? "min-h-[48px] w-full rounded-xl border border-red-500/50 bg-red-500/[0.06] px-3.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-red-500/70 focus:outline-none"
    : inputClass
}
