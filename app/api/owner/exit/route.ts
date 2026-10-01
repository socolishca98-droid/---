// app/api/owner/exit/route.ts
//
// POST /api/owner/exit — возврат владельца в свой аккаунт.
// Сессия, выпущенная для организации, отзывается в БД (жить дальше нельзя),
// из резервной httpOnly-cookie восстанавливается собственный токен владельца.
// Выход тоже пишется в журнал организации.

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import {
  badRequest,
  forbidden,
  requireStaff,
  revokeSession,
  sessionCookie,
} from "@/lib/auth/session";
import { verifySessionToken } from "@/lib/auth/token";
import { platformOwnerEmail } from "@/lib/auth/owner";
import {
  OWNER_RETURN_COOKIE,
  OWNER_VIEW_COOKIE,
  STAFF_COOKIE,
} from "@/lib/auth/constants";

export async function POST(request: NextRequest) {
  // Текущая сессия — выданная при входе в организацию (не владельца),
  // поэтому проверка «свой/чужой» идёт по резервному токену ниже.
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;

  const returnToken = request.cookies.get(OWNER_RETURN_COOKIE)?.value;
  if (!returnToken) return badRequest("Резервная сессия владельца не найдена");

  const payload = await verifySessionToken(returnToken);
  if (!payload || payload.kind !== "staff") {
    return badRequest("Резервный токен недействителен");
  }
  // org-audit: manual — читается учётка ВЛАДЕЛЬЦА (id из подписанного резервного
  // токена), чтобы подтвердить право возврата; организация здесь неприменима
  const ownerUser = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true },
  });
  const ownerEmail = platformOwnerEmail();
  if (
    !ownerUser ||
    !ownerEmail ||
    (ownerUser.email || "").trim().toLowerCase() !== ownerEmail
  ) {
    return forbidden("Возврат доступен только владельцу платформы");
  }

  try {
    // Сессия внутри организации больше не должна работать
    await revokeSession(auth.value.sessionId, "owner_exit");

    await logAudit({
      organizationId: auth.value.user.organizationId,
      actorId: ownerUser.id,
      actorEmail: ownerUser.email,
      action: "owner_exit",
      targetId: auth.value.user.id,
      targetType: "user",
      targetEmail: auth.value.user.email,
      metadata: { sessionId: auth.value.sessionId },
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set(sessionCookie(STAFF_COOKIE, returnToken));
    response.cookies.set({
      name: OWNER_RETURN_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    response.cookies.set({
      name: OWNER_VIEW_COOKIE,
      value: "",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "owner exit error";
    console.error("[owner/exit] POST error:", message);
    return NextResponse.json(
      { success: false, error: "Не удалось вернуться в свой аккаунт" },
      { status: 500 },
    );
  }
}
