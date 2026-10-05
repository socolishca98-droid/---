// app/api/ati/scan/route.ts
import { requireStaffAuth } from "@/lib/api-auth";
import { requireStaffOrganization } from "@/lib/org";
import { NextRequest, NextResponse } from "next/server";
import { scanAtiLoads } from "@/lib/ati-client";
import { getActiveAtiToken } from "@/lib/ati/connection";
import { atiFeatureGate } from "@/lib/org-settings";

export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;
  const atiGate = await atiFeatureGate(__org.organizationId);
  if (atiGate) return atiGate;

  try {
    const body = await request.json().catch(() => ({}));

    // Скан идёт в аккаунт ATI самой организации: её токен, её площадки, её лимиты
    const ati = await getActiveAtiToken(__org.organizationId);
    if (!ati.ok) {
      return NextResponse.json(
        { success: false, code: ati.code, error: ati.error },
        { status: 400 },
      );
    }

    const result = await scanAtiLoads({
      ...body,
      token: ati.token,
      organizationId: __org.organizationId,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[ATI Scan] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Не удалось распознать документ" },
      { status: 500 },
    );
  }
}
