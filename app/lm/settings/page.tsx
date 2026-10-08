// app/lm/settings/page.tsx — настройки автопарка с телефона.
//
// Полная версия прячет эти поля в длинную форму на широком экране; здесь они
// разложены по сворачиваемым секциям, а кнопка «Сохранить» всегда под рукой.
//
// API: GET|POST /api/fleet/settings. Подсказки адреса — Nominatim через
// lib/geo/nominatim (запрос уходит из браузера, как и в полной версии).

"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Building2,
  ChevronDown,
  FileText,
  Loader2,
  MapPin,
  Palette,
  Save,
  Sparkles,
  Timer,
} from "lucide-react"

import { LogistHeader } from "@/components/logist-mobile/app-header"
import { Card, ErrorState, ListSkeleton } from "@/components/logist-mobile/ui"
import { useStaffSession } from "@/hooks/use-staff-session"
import { searchPlaces, type GeoItem } from "@/lib/geo/nominatim"

const THEME_STORAGE_KEY = "tms_map_theme"

const THEMES = [
  { value: "dark", label: "Тёмная" },
  { value: "graphite", label: "Графит" },
  { value: "satellite", label: "Спутник" },
]

const REQUISITE_FIELDS: Array<{ key: string; label: string; placeholder?: string; inputMode?: "text" | "tel" | "email" | "numeric" }> = [
  { key: "legalName", label: "Юридическое имя", placeholder: "ООО «…»" },
  { key: "inn", label: "ИНН", inputMode: "numeric" },
  { key: "kpp", label: "КПП", inputMode: "numeric" },
  { key: "ogrn", label: "ОГРН", inputMode: "numeric" },
  { key: "legalAddress", label: "Юридический адрес" },
  { key: "phone", label: "Телефон", inputMode: "tel" },
  { key: "email", label: "E-mail", inputMode: "email" },
  { key: "bankName", label: "Банк" },
  { key: "bankBic", label: "БИК", inputMode: "numeric" },
  { key: "bankAccount", label: "Расчётный счёт", inputMode: "numeric" },
  { key: "signerName", label: "Подписант" },
  { key: "signerPosition", label: "Должность подписанта" },
]

function minutesHuman(value: string): string {
  const total = Number(value)
  if (!Number.isFinite(total) || total <= 0) return ""
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes} мин`
  if (minutes === 0) return `${hours} ч`
  return `${hours} ч ${minutes} мин`
}

const inputClass =
  "min-h-[48px] w-full rounded-xl border border-white/8 bg-white/[0.04] px-3.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-orange-500/50 focus:outline-none"

export default function MobileSettingsPage() {
  const { user } = useStaffSession()

  const [form, setForm] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [theme, setTheme] = useState("dark")
  const [suggestions, setSuggestions] = useState<GeoItem[]>([])
  const [searching, setSearching] = useState(false)

  const set = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/fleet/settings", { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.settings) {
        setError("Не удалось загрузить настройки")
        return
      }
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(data.settings as Record<string, unknown>)) {
        next[key] = value === null || value === undefined ? "" : String(value)
      }
      setForm(next)
    } catch {
      setError("Сервер недоступен")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void load()
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored && THEMES.some((item) => item.value === stored)) setTheme(stored)
    } catch {
      /* закрытый режим — остаётся тёмная */
    }
  }, [user, load])

  const findBase = async () => {
    const address = (form.baseAddress ?? "").trim()
    if (address.length < 3) {
      toast.error("Сначала введите адрес базы")
      return
    }
    setSearching(true)
    const found = await searchPlaces(address, 4)
    setSearching(false)
    setSuggestions(found)
    if (found.length === 0) toast.error("Подсказок не нашлось — введите координаты вручную")
  }

  const pickPlace = (item: GeoItem) => {
    setForm((prev) => ({
      ...prev,
      baseAddress: item.label,
      baseLat: String(item.lat),
      baseLng: String(item.lng),
    }))
    setSuggestions([])
    toast.success("Адрес и координаты заполнены")
  }

  const save = async () => {
    const baseLat = form.baseLat === "" ? null : Number(form.baseLat)
    const baseLng = form.baseLng === "" ? null : Number(form.baseLng)
    if (
      (form.baseAddress ?? "").trim() &&
      (baseLat === null || baseLng === null || !Number.isFinite(baseLat) || !Number.isFinite(baseLng))
    ) {
      toast.error("Нужны координаты базы", { description: "Нажмите «Найти координаты» или введите их вручную" })
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        parkName: (form.parkName ?? "").trim() || undefined,
        baseAddress: form.baseAddress ?? null,
        baseLat,
        baseLng,
      }
      // Реквизиты отправляем все: пустая строка = стереть значение
      for (const field of REQUISITE_FIELDS) payload[field.key] = form[field.key] ?? null
      if ((form.restDriveLimitMin ?? "") !== "") payload.restDriveLimitMin = Number(form.restDriveLimitMin)
      if ((form.restMinBreakMin ?? "") !== "") payload.restMinBreakMin = Number(form.restMinBreakMin)

      const response = await fetch("/api/fleet/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        toast.error(data?.error || "Не удалось сохранить настройки")
        return
      }
      toast.success("Настройки сохранены")
    } catch {
      toast.error("Ошибка соединения")
    } finally {
      setSaving(false)
    }
  }

  const pickTheme = (value: string) => {
    setTheme(value)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value)
    } catch {
      /* не критично */
    }
    toast.success("Тема карты сохранена", { description: "Карта откроется с этой подложкой" })
  }

  const filledRequisites = REQUISITE_FIELDS.filter((field) => (form[field.key] ?? "").trim()).length

  return (
    <>
      <LogistHeader title="Настройки" subtitle="Автопарк, документы и нормы" back userName={user?.name} />

      <div className="space-y-3 px-4 pb-[76px] pt-4">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : loading ? (
          <ListSkeleton rows={3} />
        ) : (
          <>
            <Card className="space-y-3">
              <SectionHeading icon={<Building2 className="h-4 w-4" />} title="Автопарк и база" />
              <Field
                label="Название парка"
                value={form.parkName ?? ""}
                onChange={(value) => set("parkName", value)}
                placeholder="Автопарк Логинекс"
              />
              <Field
                label="Адрес базы"
                value={form.baseAddress ?? ""}
                onChange={(value) => set("baseAddress", value)}
                placeholder="Город, улица, дом"
              />

              {suggestions.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-white/10">
                  {suggestions.map((item, index) => (
                    <button
                      key={`${item.lat}-${item.lng}-${index}`}
                      type="button"
                      onClick={() => pickPlace(item)}
                      className="flex min-h-[48px] w-full items-start gap-2 border-b border-white/5 px-3 py-2.5 text-left text-[13.5px] text-zinc-200 last:border-b-0 active:bg-white/8"
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                      <span className="line-clamp-2">{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2.5">
                <Field
                  label="Широта"
                  value={form.baseLat ?? ""}
                  onChange={(value) => set("baseLat", value)}
                  placeholder="55.4207"
                  inputMode="decimal"
                />
                <Field
                  label="Долгота"
                  value={form.baseLng ?? ""}
                  onChange={(value) => set("baseLng", value)}
                  placeholder="37.7376"
                  inputMode="decimal"
                />
              </div>

              <button
                type="button"
                onClick={() => void findBase()}
                disabled={searching}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-white/8 text-[13.5px] font-medium text-white active:bg-white/12 disabled:opacity-50"
              >
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Найти координаты по адресу
              </button>
            </Card>

            <Card className="space-y-3">
              <button
                type="button"
                onClick={() => setOpenSection(openSection === "rest" ? null : "rest")}
                className="flex w-full items-center justify-between gap-3"
              >
                <SectionHeading icon={<Timer className="h-4 w-4" />} title="Нормы труда и отдыха" />
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${openSection === "rest" ? "rotate-180" : ""}`}
                />
              </button>
              <p className="-mt-1 text-[12.5px] text-zinc-500">
                По этим минутам считается переработка в рейсах и подсказки логисту.
              </p>

              {openSection === "rest" ? (
                <div className="space-y-3">
                  <Field
                    label="Непрерывное движение, минут"
                    value={form.restDriveLimitMin ?? ""}
                    onChange={(value) => set("restDriveLimitMin", value)}
                    placeholder="240"
                    inputMode="numeric"
                    hint={minutesHuman(form.restDriveLimitMin ?? "")}
                  />
                  <Field
                    label="Перерыв, минут"
                    value={form.restMinBreakMin ?? ""}
                    onChange={(value) => set("restMinBreakMin", value)}
                    placeholder="45"
                    inputMode="numeric"
                    hint={minutesHuman(form.restMinBreakMin ?? "")}
                  />
                </div>
              ) : null}
            </Card>

            <Card className="space-y-3">
              <button
                type="button"
                onClick={() => setOpenSection(openSection === "requisites" ? null : "requisites")}
                className="flex w-full items-center justify-between gap-3"
              >
                <SectionHeading icon={<FileText className="h-4 w-4" />} title="Реквизиты для документов" />
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[12px] text-zinc-500">
                    {filledRequisites} из {REQUISITE_FIELDS.length}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-zinc-500 transition-transform ${openSection === "requisites" ? "rotate-180" : ""}`}
                  />
                </div>
              </button>
              <p className="-mt-1 text-[12.5px] text-zinc-500">
                Печатаются в заявке, ТТН и путевом листе от имени компании.
              </p>

              {openSection === "requisites" ? (
                <div className="space-y-3">
                  {REQUISITE_FIELDS.map((field) => (
                    <Field
                      key={field.key}
                      label={field.label}
                      value={form[field.key] ?? ""}
                      onChange={(value) => set(field.key, value)}
                      placeholder={field.placeholder}
                      inputMode={field.inputMode}
                    />
                  ))}
                </div>
              ) : null}
            </Card>

            <Card className="space-y-3">
              <SectionHeading icon={<Palette className="h-4 w-4" />} title="Подложка карты" />
              <div className="grid grid-cols-3 gap-2">
                {THEMES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => pickTheme(item.value)}
                    className={`min-h-[44px] rounded-xl text-[13.5px] font-medium ${
                      theme === item.value
                        ? "bg-orange-500/20 text-orange-200"
                        : "bg-white/8 text-white active:bg-white/12"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>

      {!error && !loading ? (
        <div
          className="fixed left-0 right-0 z-30 border-t border-white/8 bg-[#0b0b0e]/95 px-4 py-2.5 backdrop-blur"
          style={{ bottom: "calc(72px + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto max-w-md">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-orange-500 text-[15px] font-semibold text-white active:bg-orange-600 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Save className="h-4.5 w-4.5" />}
              Сохранить
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
      <span className="shrink-0 text-zinc-500">{icon}</span>
      <h2 className="min-w-0 text-left text-[15px] font-semibold text-white">{title}</h2>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal"
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] text-zinc-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={inputClass}
      />
      {hint ? <span className="mt-1 block text-[11.5px] text-zinc-500">{hint}</span> : null}
    </label>
  )
}
