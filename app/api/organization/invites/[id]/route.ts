/**
 * DELETE /api/organization/invites/[id] — отозвать инвайт-код своей организации.
 *
 * После отзыва регистрация по коду невозможна (evaluateInvite → reason "revoked"),
 * но уже созданные по нему заявки остаются: их админ одобряет или отклоняет отдельно.
 */

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { logAudit } from "@/lib/audit"
import { revokeInvite } from "@/lib/invites"
import { requireOrganization } from "@/lib/org"
import { getClientIp } from "@/lib/rate-limiter"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ id: string }> }

function forbidden(message: string) {
  return NextResponse.json({ success: false, error: message, code: "forbidden" }, { status: 403 })
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response
  if (!org.isAdmin) return forbidden("Отзывать инвайт-коды может только администратор организации")

  const { id } = await params
  if (!id) {
    return NextResponse.json(
      { success: false, error: "Не указан код приглашения" },
      { status: 400 },
    )
  }

  try {
    // Код ищется вместе с организацией: чужой id просто не находится
    const existing = await prisma.inviteCode.findFirst({
      where: { id, organizationId: org.organizationId },
      select: { id: true, code: true, revokedAt: true },
    })

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Приглашение не найдено" },
        { status: 404 },
      )
    }

    if (existing.revokedAt) {
      return NextResponse.json(
        { success: false, error: "Приглашение уже отозвано" },
        { status: 400 },
      )
    }

    const revoked = await revokeInvite({
      id,
      organizationId: org.organizationId,
      revokedById: org.userId,
    })

    if (!revoked) {
      return NextResponse.json(
        { success: false, error: "Не удалось отозвать приглашение" },
        { status: 409 },
      )
    }

    await logAudit({
      actorId: org.userId,
      actorEmail: auth.value.user.email ?? null,
      action: "invite_revoke",
      targetId: id,
      targetType: "invite_code",
      metadata: { organizationId: org.organizationId },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, message: "Приглашение отозвано" })
  } catch (error) {
    console.error(`DELETE /api/organization/invites/${id} error:`, error)
    return NextResponse.json(
      { success: false, error: "Не удалось отозвать приглашение" },
      { status: 500 },
    )
  }
}
