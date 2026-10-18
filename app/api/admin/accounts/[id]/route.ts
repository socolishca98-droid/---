// app/api/admin/accounts/[id]/route.ts
//
// PATCH /api/admin/accounts/[id] — владелец платформы управляет доступом
// любой учётной записи (сотрудника или водителя, [id] — User.id).
//
// Действия (тело: { action, reason? }):
//   suspend        — закрыть доступ: статус suspended + все сессии отзываются.
//                    Запись не удаляется, доступ можно открыть обратно.
//   restore        — открыть доступ: статус active, счётчики неудачных входов
//                    сбрасываются.
//   revokeSessions — «Завершить сессии»: все сессии отзываются, но доступ
//                    НЕ закрывается — человек может снова войти по паролю.
//
// Защита (lib/auth/owner.ts, ownerActionBlockReason):
//   - самоотзыв запрещён: владелец не трогает собственный аккаунт;
//   - аккаунт другого владельца платформы неприкосновенен.
//
// Каждое действие пишется в журнал (AuditLog) с организацией цели — его видно
// и в журнале владельца, и в журнале компании.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { forbidden, requireStaff, revokeAllSessions } from "@/lib/auth/session"
import {
  OWNER_ACCOUNT_ACTIONS,
  type OwnerAccountAction,
  isOwnerEmail,
  ownerActionBlockReason,
} from "@/lib/auth/owner"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const actor = auth.value.user
  if (!isOwnerEmail(actor.email)) {
    // Нейтральный отказ: существование пульта владельца не раскрываем
    return forbidden()
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json(
      { success: false, error: "Не указан идентификатор учётной записи" },
      { status: 400 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    reason?: unknown
  } | null
  const action = body?.action
  if (typeof action !== "string" || !OWNER_ACCOUNT_ACTIONS.includes(action as OwnerAccountAction)) {
    return NextResponse.json(
      { success: false, error: "Неизвестное действие. Доступно: suspend, restore, revokeSessions" },
      { status: 400 },
    )
  }
  const reason =
    typeof body?.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : null

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      organizationId: true,
    },
  })
  if (!target) {
    return NextResponse.json(
      { success: false, error: "Учётная запись не найдена" },
      { status: 404 },
    )
  }

  const blockReason = ownerActionBlockReason({
    actorId: actor.id,
    targetId: target.id,
    targetEmail: target.email,
  })
  if (blockReason) {
    return NextResponse.json({ success: false, error: blockReason }, { status: 400 })
  }

  /** Идентификатор запроса — чтобы запись в журнале можно было найти в логах. */
  const requestId = request.headers.get("x-request-id") ?? request.headers.get("x-correlation-id") ?? null

  /**
   * Запись в журнал. Возвращает признак успеха: если журнал не сохранился,
   * действие всё равно выполнено (доступ закрыть или открыть важнее), но
   * об этом обязано быть сказано в ответе — иначе операция над доступом
   * проходит бесследно.
   */
  async function audit(logAction: string, metadata: Record<string, unknown>): Promise<boolean> {
    return logAudit({
      organizationId: target!.organizationId,
      actorId: actor.id,
      actorEmail: actor.email ?? null,
      action: logAction,
      targetId: target!.id,
      targetType: "user",
      targetEmail: target!.email ?? null,
      metadata: { ...metadata, targetName: target!.name, byPlatformOwner: true, requestId },
      ip: getClientIp(request),
    })
  }

  /** Предупреждение, которое добавляем к успешному ответу. */
  function withAuditWarning<T extends Record<string, unknown>>(logged: boolean, body: T): T {
    return logged
      ? body
      : {
          ...body,
          warning:
            "Действие выполнено, но запись в журнал не сохранилась. Проверьте журнал позже.",
        }
  }

  if (action === "suspend") {
    if (target.status === "suspended") {
      return NextResponse.json(
        { success: false, error: "Доступ уже закрыт" },
        { status: 400 },
      )
    }
    await prisma.user.update({
      where: { id: target.id },
      data: {
        status: "suspended",
        suspendedAt: new Date(),
        suspendReason: reason ?? "Доступ закрыт владельцем платформы",
        restoredAt: null,
        restoredById: null,
      },
    })
    const revoked = await revokeAllSessions(target.id, "Доступ закрыт владельцем платформы")
    const logged = await audit("deactivate", { reason, revokedSessions: revoked })
    return NextResponse.json(
      withAuditWarning(logged, {
        success: true,
        status: "suspended",
        revokedSessions: revoked,
        message: `Доступ закрыт: ${target.name}`,
      }),
    )
  }

  if (action === "restore") {
    if (target.status === "active") {
      return NextResponse.json(
        { success: false, error: "Доступ уже открыт" },
        { status: 400 },
      )
    }
    await prisma.user.update({
      where: { id: target.id },
      data: {
        status: "active",
        suspendedAt: null,
        suspendReason: null,
        restoredAt: new Date(),
        restoredById: actor.id,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    })
    const logged = await audit("activate", { reason })
    return NextResponse.json(
      withAuditWarning(logged, {
        success: true,
        status: "active",
        message: `Доступ открыт: ${target.name}`,
      }),
    )
  }

  // action === "revokeSessions": завершить сессии БЕЗ блокировки — статус не меняем
  const revoked = await revokeAllSessions(target.id, "Сессии завершены владельцем платформы")
  const logged = await audit("sessions_revoked", { reason, revokedSessions: revoked })
  return NextResponse.json(
    withAuditWarning(logged, {
      success: true,
      status: target.status,
      revokedSessions: revoked,
      message:
        revoked > 0
          ? `Завершено сессий: ${revoked}. Доступ не закрыт — вход по паролю работает.`
          : "Активных сессий не было. Доступ не менялся.",
    }),
  )
}
