// lib/billing/plans.ts — тарифные планы организации.
//
// Источник правды по лимитам и ценам. Trial длится TRIAL_DAYS дней от
// создания организации и даёт лимиты «Компании»; когда он истекает, а план
// не выбран, действует «Бесплатный». План хранится в OrganizationSettings.plan
// (по умолчанию "trial" — новая организация сразу получает пробный период).
//
// Ограничение пока одно и главное — количество машин: это естественная
// метрика ценности TMS (парк растёт — подписка растёт). Проверка лимита —
// в POST /api/vehicles (409 plan_limit).

export const PLAN_KEYS = ["trial", "free", "start", "park", "company"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export interface PlanInfo {
  key: PlanKey;
  label: string;
  priceRubPerMonth: number;
  /** Лимит машин; null — без ограничения */
  vehicleLimit: number | null;
  description: string;
}

export const PLANS: Record<PlanKey, PlanInfo> = {
  trial: {
    key: "trial",
    label: "Пробный",
    priceRubPerMonth: 0,
    vehicleLimit: null,
    description: "14 дней без ограничений — как «Компания»",
  },
  free: {
    key: "free",
    label: "Бесплатный",
    priceRubPerMonth: 0,
    vehicleLimit: 2,
    description: "До 2 машин, все основные возможности",
  },
  start: {
    key: "start",
    label: "Старт",
    priceRubPerMonth: 3500,
    vehicleLimit: 3,
    description: "До 3 машин, виртуальный логист и умный диспетчер",
  },
  park: {
    key: "park",
    label: "Парк",
    priceRubPerMonth: 12000,
    vehicleLimit: 15,
    description: "До 15 машин, пуш-уведомления и экономика рейсов",
  },
  company: {
    key: "company",
    label: "Компания",
    priceRubPerMonth: 35000,
    vehicleLimit: 50,
    description: "До 50 машин, режим владельца и отчёты по всей компании",
  },
};

/** Длительность пробного периода, дней. */
export const TRIAL_DAYS = 14;

/**
 * «5 дней», «1 день», «3 дня» — мелочь, но в интерфейсе режет глаз.
 * Чистая функция: склонение покрыто тестами.
 */
export function pluralDays(days: number): string {
  const value = Math.max(0, Math.trunc(days));
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} дня`;
  return `${value} дней`;
}

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export interface ResolvedPlan extends PlanInfo {
  /** План, фактически действующий сейчас (trial после истечения → free) */
  plan: PlanKey;
  /** Что записано в настройках организации */
  storedPlan: PlanKey;
  isTrialing: boolean;
  /** Сколько полных дней пробного периода осталось; null — не на trial */
  trialDaysLeft: number | null;
}

/**
 * Действующий план организации: stored-план из настроек + expiry пробного
 * периода по дате создания организации. Чистая функция — удобно тестировать
 * с фиксированным «сейчас».
 */
export function resolvePlan(params: {
  storedPlan?: string | null;
  organizationCreatedAt?: Date | string | null;
  now?: Date;
}): ResolvedPlan {
  const now = params.now ?? new Date();
  const stored: PlanKey = isPlanKey(params.storedPlan) ? params.storedPlan : "trial";

  if (stored !== "trial") {
    const info = PLANS[stored];
    return { ...info, plan: stored, storedPlan: stored, isTrialing: false, trialDaysLeft: null };
  }

  const created = params.organizationCreatedAt ? new Date(params.organizationCreatedAt) : null;
  const daysLeft =
    created && !Number.isNaN(created.getTime())
      ? Math.ceil((created.getTime() + TRIAL_DAYS * 86400000 - now.getTime()) / 86400000)
      : 0;

  if (daysLeft > 0) {
    const info = PLANS.trial;
    return { ...info, plan: "trial", storedPlan: "trial", isTrialing: true, trialDaysLeft: daysLeft };
  }

  // Trial истёк, платный план не выбран — действует бесплатный
  const free = PLANS.free;
  return { ...free, plan: "free", storedPlan: "trial", isTrialing: false, trialDaysLeft: 0 };
}
