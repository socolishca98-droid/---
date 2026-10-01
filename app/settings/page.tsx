"use client";

// app/settings/page.tsx
//
// Настоящие настройки программы в одном месте: автопарк и база, подложка
// карты, нормы труда и отдыха и подключение интеграции ATI.SU.
// Информация об организации (реквизиты, люди, инвайты) — на странице «Организация».
// Раньше «Настройки» в меню открывали страницу организации — теперь у
// настроек свой дом, а организация осталась про компанию и инвайт-коды.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Map as MapIcon, Plug, Save, Timer } from "lucide-react";
import { PageLayout } from "@/components/page-layout";
import { AddressInput } from "@/components/address-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { AtiConnectionCard } from "@/components/organization/ati-connection-card";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth-context";

const THEME_STORAGE_KEY = "tms_map_theme";

const THEMES: Array<{ value: string; label: string }> = [
  { value: "dark", label: "Тёмная" },
  { value: "graphite", label: "Графит" },
  { value: "satellite", label: "Спутник" },
];

type SettingsState = Record<string, string>;

const EMPTY: SettingsState = {};

function minutesHuman(value: string): string {
  const total = Number(value);
  if (!Number.isFinite(total) || total <= 0) return "";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} ч`;
  return `${hours} ч ${minutes} мин`;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [form, setForm] = useState<SettingsState>(EMPTY);
  const [theme, setTheme] = useState("dark");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  // Возможности организации: ATI включён/выключен (переключает администратор)
  const { user } = useAuth();
  const [atiEnabled, setAtiEnabled] = useState(true);
  const [atiSaving, setAtiSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/org-settings", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data?.success)
          setAtiEnabled(data.settings?.atiEnabled !== false);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const toggleAti = async (next: boolean) => {
    setAtiSaving(true);
    try {
      const res = await fetch("/api/org-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atiEnabled: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        toast({
          title: "Не переключилось",
          description: data?.error || "Попробуйте ещё раз",
          variant: "destructive",
        });
        return;
      }
      setAtiEnabled(next);
      toast({
        title: next ? "ATI.SU включён" : "ATI.SU выключен",
        description: next
          ? "Поиск грузов и кабинет ATI снова в меню."
          : "ATI-разделы скрыты; заказы создавайте из клиентской базы.",
      });
    } catch {
      toast({ title: "Ошибка соединения", variant: "destructive" });
    } finally {
      setAtiSaving(false);
    }
  };

  const set = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/fleet/settings", {
          credentials: "include",
        });
        const data = await response.json().catch(() => null);
        if (!alive) return;
        if (!response.ok || !data?.settings) {
          setLoadError("Не удалось загрузить настройки");
          return;
        }
        const settings = data.settings as Record<string, unknown>;
        const next: SettingsState = {};
        for (const [key, value] of Object.entries(settings)) {
          next[key] =
            value === null || value === undefined ? "" : String(value);
        }
        setForm(next);
      } catch {
        if (alive) setLoadError("Не удалось загрузить настройки");
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored && THEMES.some((item) => item.value === stored))
        setTheme(stored);
    } catch {
      /* приватный режим — останемся на тёмной */
    }
    return () => {
      alive = false;
    };
  }, []);

  const pickTheme = (value: string) => {
    setTheme(value);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      /* не критично */
    }
    toast({
      title: "Тема карты сохранена",
      description: "Карта откроется с этой подложкой.",
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const baseLat = form.baseLat === "" ? null : Number(form.baseLat);
      const baseLng = form.baseLng === "" ? null : Number(form.baseLng);
      if (
        form.baseAddress &&
        (baseLat === null ||
          baseLng === null ||
          !Number.isFinite(baseLat) ||
          !Number.isFinite(baseLng))
      ) {
        toast({
          title: "Нужны координаты базы",
          description:
            "Выберите адрес из подсказок или введите широту и долготу.",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      const payload: Record<string, unknown> = {
        parkName: form.parkName || undefined,
        baseAddress: form.baseAddress ?? null,
        baseLat,
        baseLng,
      };
      if (form.restDriveLimitMin)
        payload.restDriveLimitMin = Number(form.restDriveLimitMin);
      if (form.restMinBreakMin)
        payload.restMinBreakMin = Number(form.restMinBreakMin);

      const response = await fetch("/api/fleet/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Ошибка сохранения");
      }
      toast({ title: "Настройки сохранены" });
    } catch (error) {
      toast({
        title: "Не сохранилось",
        description:
          error instanceof Error ? error.message : "Попробуйте ещё раз",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const driveHint = useMemo(
    () => minutesHuman(form.restDriveLimitMin || ""),
    [form.restDriveLimitMin],
  );
  const breakHint = useMemo(
    () => minutesHuman(form.restMinBreakMin || ""),
    [form.restMinBreakMin],
  );

  return (
    <PageLayout
      title="Настройки"
      description="Автопарк и база, карта, нормы труда и отдыха, подключение ATI.SU — всё в одном месте"
      actions={
        <Button onClick={save} disabled={saving || loading}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Сохраняем…" : "Сохранить"}
        </Button>
      }
    >
      <div className="space-y-6">
        {loadError && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {loadError}
          </div>
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
                    set("baseLat", item.lat.toFixed(6));
                    set("baseLng", item.lng.toFixed(6));
                  }}
                  placeholder="Город, улица, дом — подскажем варианты"
                />
                <p className="text-xs text-muted-foreground">
                  Начните печатать адрес — ниже появятся подсказки. Выбор
                  подставит координаты сам; если места в подсказках нет,
                  координаты можно ввести руками.
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
                <CardDescription>
                  Подложка по умолчанию на вашем рабочем месте
                </CardDescription>
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
                  Через сколько непрерывного движения программа напомнит
                  водителю об отдыхе и какой перерыв засчитает как отдых
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="restDriveLimitMin">
                    Движение до отдыха, мин
                  </Label>
                  <Input
                    id="restDriveLimitMin"
                    inputMode="numeric"
                    value={form.restDriveLimitMin ?? ""}
                    onChange={(event) =>
                      set(
                        "restDriveLimitMin",
                        event.target.value.replace(/\D/g, ""),
                      )
                    }
                    placeholder="270"
                  />
                  {driveHint && (
                    <p className="text-xs text-muted-foreground">
                      это {driveHint}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="restMinBreakMin">Перерыв, мин</Label>
                  <Input
                    id="restMinBreakMin"
                    inputMode="numeric"
                    value={form.restMinBreakMin ?? ""}
                    onChange={(event) =>
                      set(
                        "restMinBreakMin",
                        event.target.value.replace(/\D/g, ""),
                      )
                    }
                    placeholder="45"
                  />
                  {breakHint && (
                    <p className="text-xs text-muted-foreground">
                      это {breakHint}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Возможности организации ─────────────────────────────── */}
        <Card className="border-border/50" id="features">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plug className="h-5 w-5 text-primary" />
              Возможности
            </CardTitle>
            <CardDescription>
              Что использует ваша компания. Отключённое перестаёт занимать место
              в меню и на экранах — воронка заказов при этом не меняется.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border/50 bg-white/[0.02] p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Работаем через ATI.SU</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Поиск грузов, накопленная база, кабинет ATI и сканирование по
                  расписанию. Выключите, если возите только постоянным клиентам
                  — заказы для них создаются в один клик из карточки клиента.
                </p>
              </div>
              <Switch
                checked={atiEnabled}
                onCheckedChange={(next) => void toggleAti(next)}
                disabled={atiSaving || user?.role !== "admin"}
                aria-label="Использовать ATI.SU"
              />
            </div>
            {user?.role !== "admin" && (
              <p className="text-[11px] text-muted-foreground">
                Переключать возможности может только администратор организации.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Подключение ATI.SU — настройка интеграции, поэтому живёт здесь.
            Когда биржа выключена, карточка подключения не показывается. */}
        {atiEnabled && <AtiConnectionCard />}
      </div>
    </PageLayout>
  );
}
