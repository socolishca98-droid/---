// app/api/push/vapid/route.ts
//
// GET /api/push/vapid — публичный VAPID-ключ для подписки браузера и признак,
// настроен ли пуш вообще (без ключей в .env подписка не предлагается).

import { NextRequest, NextResponse } from "next/server";

import { requireAnySession } from "@/lib/auth/session";
import { vapidPublicKey } from "@/lib/push";

export async function GET(request: NextRequest) {
  const auth = await requireAnySession(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    success: true,
    enabled: vapidPublicKey() !== null,
    publicKey: vapidPublicKey(),
  });
}
