// app/api/org-settings/route.ts
//
// Возможности организации (см. lib/org-settings.ts).
//   GET  /api/org-settings — текущие настройки (любой сотрудник);
//   POST /api/org-settings { atiEnabled } — изменить (только администратор).
//
// Организация всегда берётся из проверенной сессии, не из тела запроса.

import { NextRequest, NextResponse } from "next/server";

import { forbidden, requireStaff } from "@/lib/auth/session";
import { isPlanKey, resolvePlan } from "@/lib/billing/plans";
import { requireOrganization, scopedWhere } from "@/lib/org";
import { getOrgSettings, setOrgSettings } from "@/lib/org-settings";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;
  const org = requireOrganization(auth.value);
  if (!org.ok) return org.response;

  try {
    const [settings, organization, vehicleCount] = await Promise.all([
      getOrgSettings(org.organizationId),
      prisma.organization.findUnique({
        where: { id: org.organizationId },
        select: { createdAt: true },
      }) as Promise<{ createdAt?: Date } | null>,
      prisma.vehicle.count({ where: scopedWhere(org.organizationId, {}) }),
    ]);
    // Действующий план: trial истекает через 14 дней от создания организации
    const resolved = resolvePlan({
      storedPlan: settings.plan,
      organizationCreatedAt: organization?.createdAt ?? null,
    });
    return NextResponse.json({
      success: true,
      settings,
      billing: { ...resolved, vehicleCount },
      canManage: auth.value.user.role === "admin",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "org settings error";
    console.error("[org-settings] GET error:", message);
    return NextResponse.json(
      { success: false, error: "Не удалось прочитать настройки" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;
  const org = requireOrganization(auth.value);
  if (!org.ok) return org.response;

  // Возможности организации переключает только администратор
  if (auth.value.user.role !== "admin") {
    return forbidden("Переключать возможности может только администратор");
  }

  const body = (await request.json().catch(() => null)) as {
    atiEnabled?: unknown;
    plan?: unknown;
  } | null;
  const hasAti = body && body.atiEnabled !== undefined;
  const hasPlan = body && body.plan !== undefined;
  if (!body || (!hasAti && !hasPlan) || (hasAti && typeof body.atiEnabled !== "boolean")) {
    return NextResponse.json(
      { success: false, error: "Ожидается { atiEnabled?: boolean, plan?: string }" },
      { status: 400 },
    );
  }
  if (hasPlan && !isPlanKey(body.plan)) {
    return NextResponse.json(
      { success: false, error: "Неизвестный тариф" },
      { status: 400 },
    );
  }

  try {
    const settings = await setOrgSettings(org.organizationId, {
      ...(hasAti ? { atiEnabled: body.atiEnabled as boolean } : {}),
      ...(hasPlan ? { plan: body.plan } : {}),
    });
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "org settings error";
    console.error("[org-settings] POST error:", message);
    return NextResponse.json(
      { success: false, error: "Не удалось сохранить настройки" },
      { status: 500 },
    );
  }
}
