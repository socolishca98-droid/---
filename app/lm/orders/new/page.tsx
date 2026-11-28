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
  requirements: string
  notes: string
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
  requirements: "",
  notes: "",
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
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState<string | null>(null)

  async function handleScreenshotUpload(file: File) {
    setScanning(true)
    setScanNote(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ""))
        reader.onerror = () => reject(new Error("Не удалось прочитать файл"))
        reader.readAsDataURL(file)
      })
      const res = await apiSend<{ fields?: Partial<FormState>; code?: string; error?: string }>(
        "/api/orders/parse-screenshot",
        "POST",
        { imageDataUrl: dataUrl },
      )
      if (!res.ok || !res.data?.fields) {
        // Запасной бесплатный режим без ключей — распознаём текст прямо в браузере
        setScanNote("Распознаём текст с фото…")
        const w = window as unknown as { Tesseract?: { recognize: (img: string, lang: string) => Promise<{ data: { text: string } }> } }
        if (!w.Tesseract) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement("script")
            s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"
            s.onload = () => resolve()
            s.onerror = () => reject(new Error("OCR не загрузился"))
            document.head.appendChild(s)
          })
        }
        const ocr = await w.Tesseract!.recognize(dataUrl, "rus+eng")
        const text = String(ocr?.data?.text ?? "")
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

        const routeMatch = text.match(/([А-ЯЁ][а-яёА-ЯЁ\s.,()-]{2,45}?)\s+[-–—>→]+\s+([А-ЯЁ][а-яёА-ЯЁ\s.,()-]{2,45}?)(?=\s+\d|\s*$|\n)/m)
        const routeFromAlt = routeMatch?.[1]?.trim() ?? lines.find((l) => /\([А-ЯЁа-яё.\s]+\)/.test(l) && !/км|руб|НДС|Код/i.test(l))
        const arrowLine = lines.find((l) => /^→\s*[А-ЯЁ]/.test(l))
        const routeToAlt = routeMatch?.[2]?.trim() ?? arrowLine?.replace(/^→\s*/, "").trim()
        const tysMatch = text.match(/(\d+(?:[.,]\d+)?)\s*тыс\.?\s*руб/i)
        const rubMatch = text.match(/(\d[\d\s]{3,})\s*(?:₽|руб)/i)
        const weightMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:т\b|тонн|кг)/i)
        const slashMatch = text.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s+([^\n]+)/)
        const volMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:м3|м³|куб)/i)

        const allPhones = Array.from(
          new Set(
            (text.match(/(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g) ?? []).map((p) =>
              p.trim(),
            ),
          ),
        )
        const managerMatch = text.match(/(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}[,\s]+([А-ЯЁ][а-яё]{2,20})/)
        const contactStr = allPhones[0] ? `${allPhones[0]}${managerMatch?.[1] ? ` (${managerMatch[1]})` : ""}` : ""
        const contactStr2 = allPhones[1] ?? ""

        const contactsIdx = lines.findIndex((l) => /^КОНТАКТЫ$/i.test(l))
        const firmLine =
          lines.find((l) => /(?:^|\s)(?:ИП|ООО|АО|ПАО)\b/i.test(l) || /,\s*ИП\b/i.test(l)) ??
          (contactsIdx >= 0 ? lines[contactsIdx + 1] : undefined)

        const refMatch = text.match(/(реф\.?\s*[-+]?\d*°?|тент|фургон|изотерм|борт|трал)/i)
        const extraLines = lines
          .filter(
            (l) =>
              /(\d[\d\s.,]*\s*(?:тыс\.?\s*руб|₽|руб).*(?:НДС|нал)|предопл|загр\/выгр|отд\.машина|без торга|прям\.дог)/i.test(l) &&
              !/нояб|дек|янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ТракРадар|^\d+\s*т,/i.test(l),
          )
          .map((l) => l.replace(/\s+\d+[.,]?\d*\s*руб\/км.*$/i, "").trim())
        const notesVal = Array.from(new Set(extraLines)).slice(0, 6).join("\n")

        let priceVal = ""
        if (tysMatch) {
          priceVal = String(Math.round(parseFloat(tysMatch[1].replace(",", ".")) * 1000))
        } else if (rubMatch) {
          priceVal = rubMatch[1].replace(/\s+/g, "")
        }

        let weightKg = ""
        if (weightMatch) {
          const num = parseFloat(weightMatch[1].replace(",", "."))
          weightKg = /кг/i.test(weightMatch[0]) ? String(Math.round(num)) : String(Math.round(num * 1000))
        } else if (slashMatch) {
          weightKg = String(Math.round(parseFloat(slashMatch[1].replace(",", ".")) * 1000))
        }

        const volVal = volMatch?.[1]?.replace(",", ".") ?? slashMatch?.[2]?.replace(",", ".") ?? ""
        const baseCargo = slashMatch?.[3]?.trim() ?? ""
        const cargoVal = [baseCargo, refMatch?.[1]?.trim()].filter(Boolean).join(" · ")

        setForm((prev) => ({
          ...prev,
          routeFrom: routeFromAlt ?? prev.routeFrom,
          routeTo: routeToAlt ?? prev.routeTo,
          weight: weightKg || prev.weight,
          volume: volVal || prev.volume,
          price: priceVal || prev.price,
          clientName: firmLine?.trim() || prev.clientName,
          clientContact: contactStr || prev.clientContact,
          clientContact2: contactStr2 || prev.clientContact2,
          cargoType: baseCargo || prev.cargoType,
          requirements: refMatch?.[1]?.trim() || prev.requirements,
          notes: notesVal || prev.notes,
        }))
        setScanNote("Текст распознан — проверьте и поправьте поля")
        return
      }
      const f = res.data.fields
      setForm((prev) => ({
        ...prev,
        routeFrom: f.routeFrom ? String(f.routeFrom) : prev.routeFrom,
        routeTo: f.routeTo ? String(f.routeTo) : prev.routeTo,
        cargoType: f.cargoType ? String(f.cargoType) : prev.cargoType,
        weight: f.weight ? String(f.weight) : prev.weight,
        volume: f.volume ? String(f.volume) : prev.volume,
        price: f.price ? String(f.price) : prev.price,
        clientName: f.clientName ? String(f.clientName) : prev.clientName,
        clientContact: f.clientContact ? String(f.clientContact) : prev.clientContact,
      }))
      setScanNote("Поля заполнены с фото — проверьте и сохраните")
    } catch {
      setScanNote("Не удалось обработать изображение")
    } finally {
      setScanning(false)
    }
  }

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
      requirements: [form.requirements.trim(), form.notes.trim()].filter(Boolean).join(" · ") || undefined,
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

      <div className="mx-auto max-w-md px-4 pt-3">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 transition-colors active:opacity-75">
          <div>
            <p className="text-[13.5px] font-semibold text-amber-300">
              {scanning ? "Распознаём заявку…" : "Заполнить по фото / скриншоту"}
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              {scanNote ?? "Выберите скриншот или фото — поля заполнятся сами"}
            </p>
          </div>
          <input
            type="file"
            accept="image/*"
            disabled={scanning}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleScreenshotUpload(file)
              e.target.value = ""
            }}
          />
        </label>
      </div>

      <div className="space-y-3 px-4 pt-4">
        {/* Шаг 1. Маршрут */}
        <Step n={1} title="Откуда и куда" hint="Обязательное. Города подставим из прошлых заказов.">
          <div className="space-y-3">
            <SuggestionField
              label="Откуда"
              value={form.routeFrom}
              error={errors.routeFrom}
              placeholder="Город и адрес склада"
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
              placeholder="Город и адрес выгрузки"
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
              <span className="mb-1.5 block text-[12.5px] text-muted-foreground">Что везём</span>
              <input
                value={form.cargoType}
                onChange={(event) => update("cargoType", event.target.value)}
                placeholder="Что везём"
                className={inputClass}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {cargoSuggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => update("cargoType", item)}
                  className={`rounded-md border px-3 py-1.5 text-[12.5px] ${
                    form.cargoType === item
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border text-foreground/90"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] text-muted-foreground">Вес, кг</span>
                <input
                  value={form.weight}
                  onChange={(event) => update("weight", event.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  placeholder="Сколько весит"
                  className={fieldClass(Boolean(errors.weight))}
                />
                {errors.weight ? <ErrorText>{errors.weight}</ErrorText> : null}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] text-muted-foreground">Объём, м³</span>
                <input
                  value={form.volume}
                  onChange={(event) => update("volume", event.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  placeholder="Сколько кубов"
                  className={inputClass}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] text-muted-foreground">Тип кузова / требования</span>
              <input
                value={form.requirements}
                onChange={(event) => update("requirements", event.target.value)}
                placeholder="реф. -18°, тент, задн. загр."
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] text-muted-foreground">Дополнительно (ставки, НДС, предоплата)</span>
              <textarea
                value={form.notes}
                onChange={(event) => update("notes", event.target.value)}
                rows={4}
                placeholder="Варианты ставок, предоплата 80%, погрузка..."
                className={`${inputClass} py-2.5`}
              />
            </label>
          </div>
        </Step>

        {/* Шаг 3. Клиент и деньги */}
        <Step n={3} title="Клиент и деньги" hint="Можно заполнить потом — карточка напомнит.">
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <User className="h-3.5 w-3.5" /> Клиент
              </span>
              <input
                value={form.clientName}
                onChange={(event) => update("clientName", event.target.value)}
                onFocus={() => setFocus("clientName")}
                onBlur={() => window.setTimeout(() => setFocus(null), 150)}
                placeholder="Название клиента"
                className={pickedClient ? `${inputClass} border-success/40` : inputClass}
              />
              {pickedClient ? (
                <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-success">
                  <Check className="h-3.5 w-3.5" /> {pickedClient}
                </span>
              ) : (
                <span className="mt-1.5 block text-[12px] text-muted-foreground/80">
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
                    className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-foreground"
                  >
                    {client.name}
                    {client.phone ? ` · ${client.phone}` : ""}
                  </button>
                ))}
              </div>
            ) : null}

            <label className="block">
              <span className="mb-1.5 block text-[12.5px] text-muted-foreground">Контакт клиента</span>
              <div className="space-y-2">
                <input
                  value={form.clientContact}
                  onChange={(event) => update("clientContact", event.target.value)}
                  inputMode="tel"
                  placeholder="Телефон и имя менеджера"
                  className={inputClass}
                />
                <input
                  value={form.clientContact2}
                  onChange={(event) => update("clientContact2", event.target.value)}
                  inputMode="tel"
                  placeholder="Второй телефон (если есть)"
                  className={inputClass}
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" /> Цена, ₽
              </span>
              <input
                value={form.price}
                onChange={(event) => update("price", event.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="Сумма"
                className={inputClass}
              />
            </label>

            <div>
              <span className="mb-1.5 block text-[12.5px] text-muted-foreground">Выгрузить до</span>
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
                      className={`rounded-md border px-3 py-1.5 text-[12.5px] ${
                        active
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-border text-foreground/90"
                      }`}
                    >
                      {item.label}
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => pickDeadline(null)}
                  className={`rounded-md border px-3 py-1.5 text-[12.5px] ${
                    ownDate ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-foreground/90"
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
          <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
            <p className="text-[12px] uppercase tracking-wide text-muted-foreground">Получится</p>
            <p className="mt-1 flex items-center gap-1.5 text-[14px] font-medium text-foreground">
              <span className="truncate">{form.routeFrom.trim()}</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{form.routeTo.trim()}</span>
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
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
          className="mt-1 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-70 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {saving ? "Создаю…" : "Создать заказ"}
        </button>

        <p className="pb-2 text-center text-[12px] text-muted-foreground/80">
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
    <section className="rounded-xl border border-border bg-card shadow-sm/60 p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[12px] font-semibold text-primary">
          {n}
        </span>
        <div className="min-w-0">
          <p className="text-[14.5px] font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{hint}</p>
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
        <span className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
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
              className="max-w-full truncate rounded-md border border-border px-3 py-1.5 text-[12.5px] text-foreground/90"
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
  return <span className="mt-1.5 block text-[12px] text-destructive">{children}</span>
}

const inputClass =
  "min-h-[48px] w-full rounded-xl border border-border bg-card px-3.5 text-[15px] text-foreground placeholder:text-muted-foreground/80 focus:border-primary/50 focus:outline-none"

function fieldClass(invalid: boolean): string {
  return invalid
    ? "min-h-[48px] w-full rounded-xl border border-destructive/50 bg-destructive/10 px-3.5 text-[15px] text-foreground placeholder:text-muted-foreground/80 focus:border-destructive/70 focus:outline-none"
    : inputClass
}
