// app/api/assistant/briefing/route.ts
//
// GET /api/assistant/briefing — утренний брифинг организации (движок правил
// в lib/assistant/briefing.ts). Те же данные, что видят экраны, собранные в
// короткий список «что сегодня важно».

import { NextRequest, NextResponse } from "next/server";

import { requireStaff } from "@/lib/auth/session";
import { requireOrganization } from "@/lib/org";
import { buildBriefing } from "@/lib/assistant/briefing";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;
  const org = requireOrganization(auth.value);
  if (!org.ok) return org.response;

  try {
    const items = await buildBriefing(org.organizationId);
    return NextResponse.json({ success: true, items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось собрать сводку";
    console.error("[assistant/briefing] GET error:", message);
    return NextResponse.json(
      { success: false, error: "Не удалось собрать брифинг", items: [] },
      { status: 500 },
    );
  }
}
