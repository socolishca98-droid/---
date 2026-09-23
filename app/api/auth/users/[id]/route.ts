/**
 * PATCH /api/auth/users/[id] — управление доступом сотрудника.
 *
 * Действия:
 *   approve       — одобрить регистрацию (pending → active)
 *   suspend       — закрыть доступ (active|pending → suspended), все сессии отзываются.
 *                    Запись НЕ удаляется — доступ можно восстановить
 *   restore       — восстановить доступ (suspended → active)
 *   setRole       — изменить роль (только admin; для admin/logist)
 *   resetPassword — задать новый временный пароль и обязать сменить его при входе
 *   unlock        — снять блокировку после серии неудачных попыток входа
 *
 * Защита: нельзя закрыть доступ самому себе и нельзя оставить систему без
 * активного администратора.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"
import { releaseInvite } from "@/lib/invites"

import {
  generateTemporaryPassword,
  hashPassword,
  validatePasswordStrength,
} from "@/lib/auth/password"
import { revokeAllSessions } from "@/lib/auth/session"

import { USER_ROLES, type UserRole } from "@/lib/auth/constants"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

const ACTIONS = [
  "approve",
  "reject",
  "suspend",
  "restore",
  "setRole",
  "resetPassword",
  "unlock",
] as const
type Action = (typeof ACTIONS)[number]

/** Администраторы СВОЕЙ организации: «последний админ» считается по компании. */
async function countActiveAdmins(organizationId: string, excludeUserId?: string): Promise<number> {
  return prisma.user.count({
    where: scopedWhere(organizationId, {
      role: "admin",
      status: "active",
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    }),
  })
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const actor = auth.value.user

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const { id } = await params

  /** Каждое административное действие пишется в AuditLog (GET /api/admin/audit). */
  async function audit(
    logAction: string,
    target: { id: string; name?: string | null; email?: string | null },
    metadata?: Record<string, unknown>,
  ) {
    await logAudit({
      actorId: actor.id,
      actorEmail: actor.email ?? null,
      action: logAction,
      targetId: target.id,
      targetType: "user",
      targetEmail: target.email ?? null,
      metadata: metadata ? { ...metadata, targetName: target.name ?? null } : null,
      ip: getClientIp(request),
    })
  }

  if (!id) {
    return NextResponse.json(
      { success: false, error: "Не указан идентификатор учётной записи" },
      { status: 400 },
    )
  }

  let body: { action?: unknown; reason?: unknown; role?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректное тело запроса" },
      { status: 400 },
    )
  }

  const action = String(body.action ?? "") as Action
  if (!ACTIONS.includes(action)) {
    return NextResponse.json(
      {
        success: false,
        error: `Неизвестное действие. Доступно: ${ACTIONS.join(", ")}`,
      },
      { status: 400 },
    )
  }

  // Любое изменение доступа — только администратор организации.
  // Логист видит список сотрудников, но доступом не управляет.
  if (!org.isAdmin) {
    return NextResponse.json(
      {
        success: false,
        error: "Управлять доступом сотрудников может только администратор организации",
        code: "forbidden",
      },
      { status: 403 },
    )
  }

  try {
    // Запись ищется внутри своей организации: чужой id даёт 404, а не 403,
    // чтобы не подтверждать существование учётной записи в другой компании.
    const target = await prisma.user.findFirst({
      where: scopedWhere(org.organizationId, { id }),
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        driverId: true,
        inviteCodeId: true,
      },
    })

    if (!target) {
      return NextResponse.json(
        { success: false, error: "Учётная запись не найдена" },
        { status: 404 },
      )
    }

    // --- Одобрение регистрации -------------------------------------------
    if (action === "approve") {
      if (target.status !== "pending") {
        return NextResponse.json(
          { success: false, error: "Одобрить можно только заявку в статусе «ожидает одобрения»" },
          { status: 400 },
        )
      }
      const updated = await prisma.user.update({
        where: { id },
        data: { status: "active", approvedById: actor.id, approvedAt: new Date() },
        select: { id: true, name: true, email: true, role: true, status: true },
      })
      await audit("approve", updated, { role: updated.role })
      return NextResponse.json({
        success: true,
        message: `Доступ разрешён: ${updated.name}`,
        user: updated,
      })
    }

    // --- Отклонение заявки -------------------------------------------------
    if (action === "reject") {
      if (target.status !== "pending") {
        return NextResponse.json(
          { success: false, error: "Отклонить можно только заявку в статусе «ожидает одобрения»" },
          { status: 400 },
        )
      }

      const inviteCodeId = target.inviteCodeId ?? null
      // Заявка удаляется вместе с её сессиями; использование кода возвращаем,
      // чтобы код не «сгорал» из-за отклонённого человека.
      await prisma.user.delete({ where: { id } })
      if (inviteCodeId) {
        await releaseInvite(inviteCodeId).catch((error) => {
          console.error("[auth/users] releaseInvite error:", error)
        })
      }

      await audit("reject", target, { inviteCodeId })

      return NextResponse.json({
        success: true,
        message: `Заявка отклонена: ${target.name}`,
      })
    }

    // --- Закрытие доступа (увольнение) -----------------------------------
    if (action === "suspend") {
      if (target.id === actor.id) {
        return NextResponse.json(
          { success: false, error: "Нельзя закрыть доступ самому себе" },
          { status: 400 },
        )
      }
      if (target.status === "suspended") {
        return NextResponse.json(
          { success: false, error: "Доступ уже закрыт" },
          { status: 400 },
        )
      }
      if (target.role === "admin" && (await countActiveAdmins(org.organizationId, target.id)) === 0) {
        return NextResponse.json(
          { success: false, error: "Это единственный активный администратор — доступ закрыть нельзя" },
          { status: 400 },
        )
      }

      const reason = String(body.reason ?? "").trim() || "Доступ закрыт логистом"
      const revoked = await revokeAllSessions(target.id, "suspended")
      const updated = await prisma.user.update({
        where: { id },
        data: {
          status: "suspended",
          suspendedAt: new Date(),
          suspendReason: reason,
          restoredAt: null,
          restoredById: null,
        },
        select: { id: true, name: true, status: true, suspendReason: true },
      })
      await audit("deactivate", { ...updated, email: target.email }, {
        reason,
        revokedSessions: revoked,
      })
      return NextResponse.json({
        success: true,
        message: `Доступ закрыт: ${updated.name}. Завершено сессий: ${revoked}`,
        user: updated,
        revokedSessions: revoked,
      })
    }

    // --- Восстановление доступа ------------------------------------------
    if (action === "restore") {
      if (target.status !== "suspended") {
        return NextResponse.json(
          { success: false, error: "Восстановить можно только закрытый доступ" },
          { status: 400 },
        )
      }
      const updated = await prisma.user.update({
        where: { id },
        data: {
          status: "active",
          restoredAt: new Date(),
          restoredById: actor.id,
          suspendedAt: null,
          suspendReason: null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
        select: { id: true, name: true, status: true },
      })
      await audit("activate", { ...updated, email: target.email })
      return NextResponse.json({
        success: true,
        message: `Доступ восстановлен: ${updated.name}`,
        user: updated,
      })
    }

    // --- Смена роли (только администратор) --------------------------------
    if (action === "setRole") {
      if (actor.role !== "admin") {
        return NextResponse.json(
          { success: false, error: "Менять роль может только администратор" },
          { status: 403 },
        )
      }
      const role = String(body.role ?? "") as UserRole
      if (!USER_ROLES.includes(role)) {
        return NextResponse.json(
          { success: false, error: `Недопустимая роль. Доступно: ${USER_ROLES.join(", ")}` },
          { status: 400 },
        )
      }
      if (target.driverId) {
        return NextResponse.json(
          {
            success: false,
            error: "Учётная запись привязана к карточке водителя — роль меняется через автопарк",
          },
          { status: 400 },
        )
      }
      if (target.role === "admin" && role !== "admin" && (await countActiveAdmins(org.organizationId, target.id)) === 0) {
        return NextResponse.json(
          { success: false, error: "Это единственный активный администратор — понизить роль нельзя" },
          { status: 400 },
        )
      }

      const updated = await prisma.user.update({
        where: { id },
        data: { role },
        select: { id: true, name: true, role: true },
      })
      await audit("change_role", { ...updated, email: target.email }, {
        oldRole: target.role,
        newRole: role,
      })
      return NextResponse.json({
        success: true,
        message: `Роль изменена: ${updated.name} → ${role}`,
        user: updated,
      })
    }

    // --- Сброс пароля ------------------------------------------------------
    if (action === "resetPassword") {
      const provided = String(body.password ?? "")
      const password = provided || generateTemporaryPassword()

      if (provided) {
        const strength = validatePasswordStrength(provided)
        if (!strength.ok) {
          return NextResponse.json({ success: false, error: strength.error }, { status: 400 })
        }
      }

      const { hash, salt } = await hashPassword(password)
      const revoked = await revokeAllSessions(target.id, "password_reset")
      await prisma.user.update({
        where: { id },
        data: {
          passwordHash: hash,
          passwordSalt: salt,
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      })

      await audit("reset_password", target, {
        generated: !provided,
        revokedSessions: revoked,
      })

      return NextResponse.json({
        success: true,
        message: `Пароль сброшен: ${target.name}. Пользователь обязан сменить его при входе`,
        temporaryPassword: password,
        revokedSessions: revoked,
      })
    }

    // --- Снятие блокировки входа -------------------------------------------
    const updated = await prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null },
      select: { id: true, name: true, status: true },
    })
    await audit("unlock", { ...updated, email: target.email })
    return NextResponse.json({
      success: true,
      message: `Блокировка входа снята: ${updated.name}`,
      user: updated,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error(`[auth/users/${id}] ${action} error:`, message)
    return NextResponse.json(
      { success: false, error: "Не удалось изменить доступ" },
      { status: 500 },
    )
  }
}
