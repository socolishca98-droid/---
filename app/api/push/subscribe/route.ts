// app/api/push/subscribe/route.ts
//
// POST /api/push/subscribe { subscription } — сохранить браузерную подписку
// на пуш. Работает и для сотрудников, и для водителей (requireAnySession):
// организация и пользователь берутся из проверенной сессии.
//
// DELETE /api/push/subscribe { endpoint } — отписать устройство.

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAnySession, type AnySession } from "@/lib/auth/session";
import { pushConfigured } from "@/lib/push";

function identityOf(session: AnySession): {
  userId: string;
  organizationId: string | null;
} {
  if (session.kind === "staff") {
    return {
      userId: session.user.id,
      organizationId: session.user.organizationId ?? null,
    };
  }
  return {
    userId: session.userId,
    organizationId: session.driver.organizationId ?? null,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAnySession(request);
  if (!auth.ok) return auth.response;

  if (!pushConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Пуш не настроен: добавьте VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY в .env (npx web-push generate-vapid-keys)",
      },
      { status: 501 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    subscription?: {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    };
  } | null;

  const endpoint = body?.subscription?.endpoint;
  const p256dh = body?.subscription?.keys?.p256dh;
  const keyAuth = body?.subscription?.keys?.auth;
  if (
    typeof endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof keyAuth !== "string" ||
    !endpoint
  ) {
    return NextResponse.json(
      { success: false, error: "Ожидается subscription с endpoint и keys" },
      { status: 400 },
    );
  }

  const { userId, organizationId } = identityOf(auth.value);

  try {
    // Одна подписка = одна строка: повторная подписка того же браузера
    // просто обновляет владельца (endpoint уникален).
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        organizationId,
        userId,
        endpoint,
        p256dh,
        auth: keyAuth,
        userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      update: { organizationId, userId, p256dh, auth: keyAuth },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось включить уведомления";
    console.error("[push/subscribe] POST error:", message);
    return NextResponse.json(
      { success: false, error: "Не удалось сохранить подписку" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAnySession(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    endpoint?: unknown;
  } | null;
  const { userId } = identityOf(auth.value);

  try {
    // Отписать можно только себя
    await prisma.pushSubscription.deleteMany({
      where: {
        userId,
        ...(typeof body?.endpoint === "string" && body.endpoint
          ? { endpoint: body.endpoint }
          : {}),
      },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось отключить уведомления";
    console.error("[push/subscribe] DELETE error:", message);
    return NextResponse.json(
      { success: false, error: "Не удалось отписать устройство" },
      { status: 500 },
    );
  }
}
