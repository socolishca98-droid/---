// app/api/assistant/act/route.ts
//
// POST /api/assistant/act { action } — «руки» виртуального логиста:
// выполняет безопасное рутинное действие (напомнить о просроченных оплатах,
// отложить просроченные напоминания о контакте на завтра). Организация —
// только из сессии; неизвестное действие — 400. Полный список и логика —
// lib/assistant/actions.ts.

import { NextRequest, NextResponse } from "next/server";

import { requireStaff } from "@/lib/auth/session";
import { requireOrganization } from "@/lib/org";
import {
  ASSISTANT_ACTIONS,
  isAssistantAction,
  runAssistantAction,
} from "@/lib/assistant/actions";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;

  const org = requireOrganization(auth.value);
  if (!org.ok) return org.response;

  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
    } | null;

    if (!isAssistantAction(body?.action)) {
      return NextResponse.json(
        {
          success: false,
          error: "Неизвестное действие ассистента",
          allowed: [...ASSISTANT_ACTIONS],
        },
        { status: 400 },
      );
    }

    const result = await runAssistantAction(org.organizationId, body.action);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось выполнить действие";
    console.error("[api/assistant/act POST] Error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
