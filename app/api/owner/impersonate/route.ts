// app/api/owner/impersonate/route.ts
//
// POST /api/owner/impersonate { organizationId } — вход владельца в любую
// организацию платформы. Выпускается НАСТОЯЩАЯ сессия сотрудника этой
// организации (первого активного администратора, иначе логиста): все экраны
// и API работают как обычно, изоляция организации не нарушается.
//
// Собственный токен владельца сохраняется в резервную httpOnly-cookie —
// по нему /api/owner/exit вернёт его обратно в свой аккаунт.
// Вход обязательно пишется в журнал аудита организации.

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { issueSession, requireStaff, sessionCookie } from "@/lib/auth/session";
import { ownerGuardResponse } from "@/lib/auth/owner";
import {
  OWNER_RETURN_COOKIE,
  OWNER_VIEW_COOKIE,
  STAFF_COOKIE,
  getSessionTtlSeconds,
  type UserRole,
} from "@/lib/auth/constants";

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (!auth.ok) return auth.response;
  const denied = ownerGuardResponse(auth.value);
  if (denied) return denied;
  const owner = auth.value.user;

  // Режим владельца: целевая организация НАМЕРЕННО приходит из запроса —
  // владелец выбирает её из общего списка. Право выбора подтверждено выше
  // персональной проверкой ownerGuardResponse (PLATFORM_OWNER_EMAIL),
  // а сам вход записывается в журнал аудита организации.
  let targetOrgId: string | null = null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const requested = body["organizationId"];
    targetOrgId = typeof requested === "string" ? requested.trim() : null;
  } catch {
    targetOrgId = null;
  }
  if (!targetOrgId) {
    return NextResponse.json(
      { success: false, error: "organizationId обязателен" },
      { status: 400 },
    );
  }

  try {
    const organization = await prisma.organization.findUnique({
      where: { id: targetOrgId },
      select: { id: true, name: true },
    });
    if (!organization) {
      return NextResponse.json(
        { success: false, error: "Организация не найдена" },
        { status: 404 },
      );
    }

    // Входим как первый активный администратор организации, иначе логист:
    // роль решает, что будет видно внутри (журнал, сотрудники и т.д.).
    const target = await prisma.user.findFirst({
      where: {
        organizationId: organization.id,
        isActive: true,
        role: { in: ["admin", "logist"] },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    });
    if (!target) {
      return NextResponse.json(
        { success: false, error: "В организации нет активных сотрудников" },
        { status: 400 },
      );
    }

    const ownerToken = request.cookies.get(STAFF_COOKIE)?.value || null;

    const issued = await issueSession({
      userId: target.id,
      role: target.role as UserRole,
      kind: "staff",
      name: target.name,
      request,
    });

    // След в журнале организации: кто вошёл, в кого и откуда
    await logAudit({
      organizationId: organization.id,
      actorId: owner.id,
      actorEmail: owner.email,
      action: "owner_impersonate",
      targetId: target.id,
      targetType: "user",
      targetEmail: target.email,
      metadata: {
        organizationName: organization.name,
        sessionId: issued.sessionId,
      },
    });

    const response = NextResponse.json({
      success: true,
      organizationName: organization.name,
      enteredAs: target.name,
      enteredRole: target.role,
    });
    response.cookies.set(sessionCookie(issued.cookieName, issued.token));
    if (ownerToken) {
      response.cookies.set(sessionCookie(OWNER_RETURN_COOKIE, ownerToken));
    }
    response.cookies.set({
      name: OWNER_VIEW_COOKIE,
      value: encodeURIComponent(organization.name),
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: getSessionTtlSeconds(),
    });
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "owner impersonate error";
    console.error("[owner/impersonate] POST error:", message);
    return NextResponse.json(
      { success: false, error: "Не удалось войти в организацию" },
      { status: 500 },
    );
  }
}
