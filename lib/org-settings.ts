// lib/org-settings.ts — возможности организации (OrganizationSettings).
//
// Одна строка настроек на организацию. Сейчас единственная возможность —
// atiEnabled: использовать ли ATI.SU (поиск, кабинет, сканирование).
// Компании, возящие постоянным клиентам, выключают её — интерфейс прячет
// ATI-разделы. Строки может не быть (организация создана до появления
// настроек) — тогда действуют значения по умолчанию: ATI включён.

import { NextResponse } from "next/server";

import { isPlanKey, type PlanKey } from "@/lib/billing/plans";
import { prisma } from "@/lib/prisma";

export interface OrgSettings {
  atiEnabled: boolean;
  /** Тарифный план (lib/billing/plans.ts); новое значение из тела проверяется isPlanKey */
  plan: PlanKey;
}

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  atiEnabled: true,
  plan: "trial",
};

/** Прочитать настройки организации (без строки — значения по умолчанию). */
export async function getOrgSettings(
  organizationId: string | null | undefined,
): Promise<OrgSettings> {
  if (!organizationId) return { ...DEFAULT_ORG_SETTINGS };
  const row = await prisma.organizationSettings.findUnique({
    where: { organizationId },
    select: { atiEnabled: true, plan: true },
  });
  if (!row) return { ...DEFAULT_ORG_SETTINGS };
  return {
    atiEnabled: Boolean(row.atiEnabled),
    plan: isPlanKey(row.plan) ? row.plan : "trial",
  };
}

/** Записать настройки организации (upsert: строка создаётся при первом изменении). */
export async function setOrgSettings(
  organizationId: string,
  patch: { atiEnabled?: boolean; plan?: unknown },
): Promise<OrgSettings> {
  const data: Record<string, unknown> = {};
  if (typeof patch.atiEnabled === "boolean") data.atiEnabled = patch.atiEnabled;
  if (isPlanKey(patch.plan)) data.plan = patch.plan;

  await prisma.organizationSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });
  return getOrgSettings(organizationId);
}

/**
 * Гейт для ATI-роутов: null — организация использует ATI, можно работать;
 * иначе готовый ответ 403 с кодом ati_disabled (интерфейс покажет заглушку).
 */
export async function atiFeatureGate(
  organizationId: string | null | undefined,
): Promise<NextResponse | null> {
  const settings = await getOrgSettings(organizationId);
  if (settings.atiEnabled) return null;
  return NextResponse.json(
    {
      success: false,
      error: "ATI.SU выключен в настройках организации",
      code: "ati_disabled",
    },
    { status: 403 },
  );
}
