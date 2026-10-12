/**
 * POST /api/auth/change-password — смена собственного пароля.
 *
 * Доступно любой авторизованной роли (сотрудник и водитель).
 * После смены все остальные сессии пользователя отзываются — украденный
 * токен перестаёт работать, текущая сессия сохраняется.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password"
import { requireAnySession } from "@/lib/auth/session"
import { logAudit } from "@/lib/audit"
import { getClientIp } from "@/lib/rate-limiter"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const auth = await requireAnySession(request)
  if (!auth.ok) return auth.response

  const userId = auth.value.kind === "staff" ? auth.value.user.id : auth.value.userId
  const currentSessionId = auth.value.sessionId

  let body: { currentPassword?: unknown; newPassword?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректное тело запроса" },
      { status: 400 },
    )
  }

  const currentPassword = String(body.currentPassword ?? "")
  const newPassword = String(body.newPassword ?? "")

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { success: false, error: "Укажите текущий и новый пароли" },
      { status: 400 },
    )
  }

  const strength = validatePasswordStrength(newPassword)
  if (!strength.ok) {
    return NextResponse.json({ success: false, error: strength.error }, { status: 400 })
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        organizationId: true,
        passwordHash: true,
        passwordSalt: true,
      },
    })
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Пользователь не найден" },
        { status: 404 },
      )
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash, user.passwordSalt)
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "Текущий пароль указан неверно" },
        { status: 403 },
      )
    }

    const { hash, salt } = await hashPassword(newPassword)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: hash, passwordSalt: salt, mustChangePassword: false },
      }),
      // остальные сессии — отозвать, текущую оставить
      prisma.session.updateMany({
        where: { userId, revokedAt: null, NOT: { id: currentSessionId } },
        data: { revokedAt: new Date(), revokeReason: "password_changed" },
      }),
    ])

    // Журнал действий: смена пароля — это событие безопасности, его видно
    // в «Журнале действий» организации (GET /api/admin/audit).
    await logAudit({
      organizationId: user.organizationId,
      actorId: user.id,
      actorEmail: user.email,
      action: "password_change",
      targetId: user.id,
      targetType: "user",
      targetEmail: user.email,
      metadata: { scope: "password", role: user.role },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, message: "Пароль изменён" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[auth/change-password] error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось сменить пароль" },
      { status: 500 },
    )
  }
}
