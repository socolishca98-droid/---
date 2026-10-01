// app/api/org-settings/route.ts
//
// Возможности организации (см. lib/org-settings.ts).
//   GET  /api/org-settings — текущие настройки (любой сотрудник);
//   POST /api/org-settings { atiEnabled } — изменить (только администратор).
//
// Организация всегда берётся из проверенной сессии, не из тела запроса.

import { NextRequest, NextResponse } from "next/server";

import { forbidden, requireStaff } from "@/lib/auth/session";
import { requireOrganization } from "@/lib/org";
import { getOrgSettings, setOrgSettings } from "@/lib/org-settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;
  const org = requireOrganization(auth.value);
  if (!org.ok) return org.response;

  try {
    const settings = await getOrgSettings(org.organizationId);
    return NextResponse.json({ success: true, settings });
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
  } | null;
  if (!body || typeof body.atiEnabled !== "boolean") {
    return NextResponse.json(
      { success: false, error: "Ожидается { atiEnabled: boolean }" },
      { status: 400 },
    );
  }

  try {
    const settings = await setOrgSettings(org.organizationId, {
      atiEnabled: body.atiEnabled,
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
