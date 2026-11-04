"use client"

// app/settings/page.tsx
//
// Настоящие настройки программы в одном месте: автопарк и база, реквизиты
// перевозчика для документов, подложка карты и нормы труда и отдыха.
// Раньше «Настройки» в меню открывали страницу организации — теперь у
// настроек свой дом, а организация осталась про компанию и инвайт-коды.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Building2, Fuel, Map as MapIcon, Save, Timer } from "lucide-react"
import { PageLayout } from "@/components/page-layout"
import { PushCard } from "@/components/settings/push-card"
import { AddressInput } from "@/components/address-input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

const THEME_STORAGE_KEY = "tms_map_theme"

const THEMES: Array<{ value: string; label: string }> = [
  { value: "dark", label: "Тёмная" },
  { value: "graphite", label: "Графит" },
  { value: "satellite", label: "Спутник" },
]

const REQUISITE_FIELDS: Array<{ key: string; label: string; placeholder?: string }> = [
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

type SettingsState = Record<string, string>

const EMPTY: SettingsState = {}

function minutesHuman(value: string): string {
  const total = Number(value)
  if (!Number.isFinite(total) || total <= 0) return ""
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes} мин`
  if (minutes === 0) return `${hours} ч`
  return `${hours} ч ${minutes} мин`
}

export default function SettingsPage() {
  const { toast } = useToast()
  const [form, setForm] = useState<SettingsState>(EMPTY)
  const [theme, setTheme] = useState("dark")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState("")

  const set = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const response = await fetch("/api/fleet/settings", { credentials: "include" })
        const data = await response.json().catch(() => null)
        if (!alive) return
        if (!response.ok || !data?.settings) {
          setLoadError("Не удалось загрузить настройки")
          return
        }
        const settings = data.settings as Record<string, unknown>
        const next: SettingsState = {}
        for (const [key, value] of Object.entries(settings)) {
          next[key] = value === null || value === undefined ? "" : String(value)
        }
        setForm(next)
      } catch {
        if (alive) setLoadError("Не удалось загрузить настройки")
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored && THEMES.some((item) => item.value === stored)) setTheme(stored)
    } catch {
      /* приватный режим — останемся на тёмной */
    }
    return () => {
      alive = false
    }
  }, [])

  const pickTheme = (value: string) => {
    setTheme(value)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value)
    } catch {
      /* не критично */
    }
    toast({ title: "Тема карты сохранена", description: "Карта откроется с этой подложкой." })
  }

  const save = async () => {
    setSaving(true)
    try {
      const baseLat = form.baseLat === "" ? null : Number(form.baseLat)
      const baseLng = form.baseLng === "" ? null : Number(form.baseLng)
      if (form.baseAddress && (baseLat === null || baseLng === null || !Number.isFinite(baseLat) || !Number.isFinite(baseLng))) {
        toast({ title: "Нужны координаты базы", description: "Выберите адрес из подсказок или введите широту и долготу.", variant: "destructive" })
        setSaving(false)
        return
      }
      const payload: Record<string, unknown> = {
        parkName: form.parkName || undefined,
        baseAddress: form.baseAddress ?? null,
        baseLat,
        baseLng,
      }
      for (const field of REQUISITE_FIELDS) payload[field.key] = form[field.key] ?? null
      if (form.restDriveLimitMin) payload.restDriveLimitMin = Number(form.restDriveLimitMin)
      if (form.restMinBreakMin) payload.restMinBreakMin = Number(form.restMinBreakMin)
      // Работа машины, ₽/км — из неё помощник считает «сколько останется»
      if (form.operatingCostPerKm !== "" && form.operatingCostPerKm !== undefined) {
        payload.operatingCostPerKm = Number(form.operatingCostPerKm)
      }
      // Оплата водителя: правило своё у каждой организации. Пусто — водитель
      // считается внутри ставки ₽/км (историческая конвенция).
      payload.driverPayKind = (form.driverPayKind ?? "").trim() || null
      for (const field of [
        "driverPayPerShift",
        "driverPayPerKm",
        "driverPayPerHour",
        "driverPayPerTrip",
        "driverPayBasePerShift",
      ] as const) {
        const raw = (form[field] ?? "").trim()
        payload[field] = raw === "" ? null : Number(raw)
      }
      payload.operatingCostIncludesDriver = (form.operatingCostIncludesDriver ?? "true") === "true"

      const response = await fetch("/api/fleet/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Ошибка сохранения")
      }
      toast({ title: "Настройки сохранены" })
    } catch (error) {
      toast({
        title: "Не сохранилось",
        description: error instanceof Error ? error.message : "Попробуйте ещё раз",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const driveHint = useMemo(() => minutesHuman(form.restDriveLimitMin || ""), [form.restDriveLimitMin])
  const breakHint = useMemo(() => minutesHuman(form.restMinBreakMin || ""), [form.restMinBreakMin])

  return (
    <PageLayout
      title="Настройки"
      description="Автопарк, реквизиты для документов, карта и нормы отдыха — всё в одном месте"
      actions={
        <Button onClick={save} disabled={saving || loading}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Сохраняем…" : "Сохранить"}
        </Button>
      }
    >
      <div className="space-y-6">
        {loadError && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{loadError}</div>
        )}

        <div className="grid gap-6 xl:grid-cols-2">
          {/* ── Автопарк и база ─────────────────────────────────────── */}
          <Card className="border-border/50" id="fleet">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-4 w-4" />
                Автопарк и база
              </CardTitle>
              <CardDescription>
                Название парка и точка базы: от неё считается возврат на базу и
                от неё строятся маршруты смены
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="parkName">Название автопарка</Label>
                <Input
                  id="parkName"
                  value={form.parkName ?? ""}
                  onChange={(event) => set("parkName", event.target.value)}
                  placeholder="Наш автопарк"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="baseAddress">Адрес базы</Label>
                <AddressInput
                  id="baseAddress"
                  value={form.baseAddress ?? ""}
                  onChange={(value) => set("baseAddress", value)}
                  onPick={(item) => {
                    set("baseLat", item.lat.toFixed(6))
                    set("baseLng", item.lng.toFixed(6))
                  }}
                  placeholder="Город, улица, дом — подскажем варианты"
                />
                <p className="text-xs text-muted-foreground">
                  Начните печатать адрес — ниже появятся подсказки. Выбор подставит
                  координаты сам; если места в подсказках нет, координаты можно ввести руками.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="baseLat">Широта</Label>
                  <Input
                    id="baseLat"
                    value={form.baseLat ?? ""}
                    onChange={(event) => set("baseLat", event.target.value)}
                    placeholder="57.6261"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="baseLng">Долгота</Label>
                  <Input
                    id="baseLng"
                    value={form.baseLng ?? ""}
                    onChange={(event) => set("baseLng", event.target.value)}
                    placeholder="39.8847"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Карта и нормы ───────────────────────────────────────── */}
          <div className="space-y-6">
            <Card className="border-border/50" id="map">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <MapIcon className="h-4 w-4" />
                  Карта
                </CardTitle>
                <CardDescription>Подложка по умолчанию на вашем рабочем месте</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="inline-flex rounded-lg border border-border/70 p-1">
                  {THEMES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => pickTheme(item.value)}
                      className={cn(
                        "rounded-md px-4 py-1.5 text-sm transition-colors",
                        theme === item.value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50" id="rest">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Timer className="h-4 w-4" />
                  Труд и отдых
                </CardTitle>
                <CardDescription>
                  Через сколько непрерывного движения программа напомнит водителю
                  об отдыхе и какой перерыв засчитает как отдых
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="restDriveLimitMin">Движение до отдыха, мин</Label>
                  <Input
                    id="restDriveLimitMin"
                    inputMode="numeric"
                    value={form.restDriveLimitMin ?? ""}
                    onChange={(event) => set("restDriveLimitMin", event.target.value.replace(/\D/g, ""))}
                    placeholder="270"
                  />
                  {driveHint && <p className="text-xs text-muted-foreground">это {driveHint}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="restMinBreakMin">Перерыв, мин</Label>
                  <Input
                    id="restMinBreakMin"
                    inputMode="numeric"
                    value={form.restMinBreakMin ?? ""}
                    onChange={(event) => set("restMinBreakMin", event.target.value.replace(/\D/g, ""))}
                    placeholder="45"
                  />
                  {breakHint && <p className="text-xs text-muted-foreground">это {breakHint}</p>}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Fuel className="h-4 w-4" />
                  Работа машины
                </CardTitle>
                <CardDescription>
                  Водитель, износ, ТО, шины, платные дороги, стоянки — всё, кроме топлива.
                  Помощник вычитает это из выручки и показывает, сколько реально останется.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="operatingCostPerKm">Ставка на километр, ₽</Label>
                  <Input
                    id="operatingCostPerKm"
                    inputMode="decimal"
                    value={form.operatingCostPerKm ?? ""}
                    onChange={(event) =>
                      set("operatingCostPerKm", event.target.value.replace(/[^\d.,]/g, "").replace(",", "."))
                    }
                    placeholder="25"
                  />
                  <p className="text-xs text-muted-foreground">
                    20-тонник — 25–30 ₽/км, пятитонка — 15–18 ₽/км. Отдельной машине
                    можно поставить свою ставку в её карточке. 0 — не вычитать.
                  </p>
                </div>

                {/* Оплата водителя — своё правило у каждой организации. */}
                <div className="space-y-1.5">
                  <Label htmlFor="driverPayKind">Оплата водителя</Label>
                  <select
                    id="driverPayKind"
                    value={form.driverPayKind ?? "includedInPerKm"}
                    onChange={(event) => set("driverPayKind", event.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="includedInPerKm">Уже внутри ставки ₽/км</option>
                    <option value="perShift">За смену</option>
                    <option value="perKm">За километр</option>
                    <option value="perHour">За час работы</option>
                    <option value="perTrip">За рейс</option>
                    <option value="mixed">Оклад за смену + за километр</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Пока правило не выбрано, водитель считается внутри ставки ₽/км.
                  </p>
                </div>

                {(form.driverPayKind ?? "") === "perShift" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="driverPayPerShift">Смена, ₽</Label>
                    <Input
                      id="driverPayPerShift"
                      inputMode="decimal"
                      value={form.driverPayPerShift ?? ""}
                      onChange={(event) => set("driverPayPerShift", event.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                    />
                  </div>
                ) : null}
                {(form.driverPayKind ?? "") === "perKm" || (form.driverPayKind ?? "") === "mixed" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="driverPayPerKm">Километр, ₽</Label>
                    <Input
                      id="driverPayPerKm"
                      inputMode="decimal"
                      value={form.driverPayPerKm ?? ""}
                      onChange={(event) => set("driverPayPerKm", event.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                    />
                  </div>
                ) : null}
                {(form.driverPayKind ?? "") === "mixed" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="driverPayBasePerShift">Оклад за смену, ₽</Label>
                    <Input
                      id="driverPayBasePerShift"
                      inputMode="decimal"
                      value={form.driverPayBasePerShift ?? ""}
                      onChange={(event) => set("driverPayBasePerShift", event.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                    />
                  </div>
                ) : null}
                {(form.driverPayKind ?? "") === "perHour" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="driverPayPerHour">Час работы, ₽</Label>
                    <Input
                      id="driverPayPerHour"
                      inputMode="decimal"
                      value={form.driverPayPerHour ?? ""}
                      onChange={(event) => set("driverPayPerHour", event.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Час — это и движение, и погрузка, и ожидание окна.
                    </p>
                  </div>
                ) : null}
                {(form.driverPayKind ?? "") === "perTrip" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="driverPayPerTrip">Рейс, ₽</Label>
                    <Input
                      id="driverPayPerTrip"
                      inputMode="decimal"
                      value={form.driverPayPerTrip ?? ""}
                      onChange={(event) => set("driverPayPerTrip", event.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
                    />
                  </div>
                ) : null}
                {(form.driverPayKind ?? "includedInPerKm") !== "includedInPerKm" ? (
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        "operatingCostIncludesDriver",
                        (form.operatingCostIncludesDriver ?? "true") === "true" ? "false" : "true",
                      )
                    }
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-input px-3 py-2 text-left text-sm"
                  >
                    <span>
                      Ставка ₽/км включает водителя
                      <span className="block text-xs text-muted-foreground">
                        Если платите водителю отдельно — выключите, иначе двойной учёт
                      </span>
                    </span>
                    <span className="shrink-0 font-medium">
                      {(form.operatingCostIncludesDriver ?? "true") === "true" ? "да" : "нет"}
                    </span>
                  </button>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Реквизиты перевозчика ─────────────────────────────────── */}
        <Card className="border-border/50" id="requisites">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Fuel className="h-4 w-4" />
              Реквизиты для документов
            </CardTitle>
            <CardDescription>
              Реквизиты перевозчика: печатаются в транспортной накладной, путевом
              листе, договоре-заявке, счёте и акте от имени вашей организации.
              Пустое поле остаётся в бланке пустой строкой — дописать можно от руки
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {REQUISITE_FIELDS.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`req-${field.key}`}>{field.label}</Label>
                <Input
                  id={`req-${field.key}`}
                  value={form[field.key] ?? ""}
                  onChange={(event) => set(field.key, event.target.value)}
                  placeholder={field.placeholder}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── Уведомления на устройства ─────────────────────────────── */}
        <PushCard />
      </div>
    </PageLayout>
  )
}
