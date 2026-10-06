// app/pricing/page.tsx — тарифы организации.
//
// Текущий план, остаток пробного периода, лимит машин и выбор плана
// (только администратор: POST /api/org-settings { plan }). Лимиты и цены
// источника правды — lib/billing/plans.ts; страница отображает их же.
// Оплата пока вне приложения: план переключается вручную после подтверждения
// оплаты (интеграция эквайринга — отдельный этап).

"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CreditCard, Loader2, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BillingInfo {
  plan: string;
  storedPlan: string;
  label: string;
  description: string;
  isTrialing: boolean;
  trialDaysLeft: number | null;
  vehicleLimit: number | null;
  priceRubPerMonth: number;
  vehicleCount: number;
}

interface PricingPayload {
  success: boolean;
  billing?: BillingInfo;
  canManage?: boolean;
  error?: string;
  canSelectPaidPlan?: boolean;
  billingContact?: string | null;
}

const PLAN_CARDS: Array<{
  key: string;
  /** Платный тариф: подключается владельцем платформы после оплаты */
  needsPayment?: boolean;
  label: string;
  priceRubPerMonth: number;
  vehicleLimit: number | null;
  features: string[];
}> = [
  {
    key: "free",
    label: "Бесплатный",
    priceRubPerMonth: 0,
    vehicleLimit: 2,
    features: ["До 2 машин", "Заказы, рейсы, расходы", "Мобильное приложение водителя"],
  },
  {
    key: "start",
    needsPayment: true,
    label: "Старт",
    priceRubPerMonth: 3500,
    vehicleLimit: 3,
    features: ["До 3 машин", "Виртуальный логист", "Умный диспетчер", "Экономика рейсов"],
  },
  {
    key: "park",
    needsPayment: true,
    label: "Парк",
    priceRubPerMonth: 12000,
    vehicleLimit: 15,
    features: ["До 15 машин", "Пуш-уведомления", "Топливо и обслуживание", "Отчёты"],
  },
  {
    key: "company",
    needsPayment: true,
    label: "Компания",
    priceRubPerMonth: 35000,
    vehicleLimit: 50,
    features: ["До 50 машин", "Режим владельца", "Журнал аудита", "Приоритетная поддержка"],
  },
];

export default function PricingPage() {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [canManage, setCanManage] = useState(false);
  // Платный тариф подключает владелец платформы: оплата пока внешняя
  const [canSelectPaid, setCanSelectPaid] = useState(false);
  const [contact, setContact] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/org-settings");
      const payload = (await response.json().catch(() => null)) as PricingPayload | null;
      if (!response.ok || !payload?.success || !payload.billing) {
        setError(payload?.error ?? "Не удалось прочитать тариф");
        return;
      }
      setBilling(payload.billing);
      setCanManage(Boolean(payload.canManage));
      setCanSelectPaid(Boolean(payload.canSelectPaidPlan));
      setContact(payload.billingContact ?? null);
      setError(null);
    } catch {
      setError("Сервер недоступен");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function choose(planKey: string) {
    if (saving) return;
    setSaving(planKey);
    setError(null);
    try {
      const response = await fetch("/api/org-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !payload?.success) {
        setError(payload?.error ?? "Не удалось изменить тариф");
        return;
      }
      await load();
    } catch {
      setError("Сервер недоступен");
    } finally {
      setSaving(null);
    }
  }

  if (loading && !billing) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загружаем тариф…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <CreditCard className="h-5 w-5 text-orange-400" />
          Тарифы
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Подписка растёт вместе с парком: платите за машины в работе, а не за
          строчки в прайсе. Пробный период — 14 дней без ограничений.
        </p>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {billing && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Текущий план: {billing.label}
              {billing.isTrialing && (
                <span className="rounded-full border border-orange-400/40 px-2 py-0.5 text-[11px] font-normal text-orange-400">
                  пробный · осталось {billing.trialDaysLeft} дн.
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <Truck className="h-4 w-4" />
              Машин в парке: {billing.vehicleCount}
              {billing.vehicleLimit !== null ? ` из ${billing.vehicleLimit}` : " — лимита нет"}
            </p>
            {!canManage && (
              <p className="mt-2 text-xs">
                Менять тариф может только администратор организации.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLAN_CARDS.map((plan) => {
          const active = billing?.plan === plan.key;
          return (
            <Card key={plan.key} className={active ? "border-orange-400/60" : undefined}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  {plan.label}
                  {active && <Check className="h-4 w-4 text-orange-400" />}
                </CardTitle>
                <p className="text-2xl font-bold">
                  {plan.priceRubPerMonth === 0
                    ? "0 ₽"
                    : `${plan.priceRubPerMonth.toLocaleString("ru-RU")} ₽`}
                  <span className="text-xs font-normal text-muted-foreground"> /мес</span>
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant={active ? "outline" : "default"}
                  className="w-full"
                  disabled={
                    !canManage ||
                    active ||
                    saving !== null ||
                    (plan.needsPayment && !canSelectPaid)
                  }
                  onClick={() => void choose(plan.key)}
                >
                  {saving === plan.key ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {active
                    ? "Текущий план"
                    : plan.needsPayment && !canSelectPaid
                      ? "После оплаты"
                      : "Выбрать"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {canSelectPaid
          ? "Вы владелец платформы: платный тариф подключается вами после оплаты. "
          : "Платный тариф подключается после оплаты"}
        {!canSelectPaid && contact ? (
          <>
            {" — напишите на "}
            <a href={`mailto:${contact}`} className="underline underline-offset-2">
              {contact}
            </a>
            .{" "}
          </>
        ) : (
          ". "
        )}
        Бесплатный план можно выбрать самостоятельно: понижать тариф
        организация вправе в любой момент. Эквайринг и автоматическое
        продление — следующий этап. Лимит машин проверяется при добавлении
        машины в парк.
      </p>
    </div>
  );
}
