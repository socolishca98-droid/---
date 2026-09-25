/**
 * /api/organization/invites — инвайт-коды своей организации.
 *
 * GET  — список кодов (админ организации)
 * POST — создать код (админ организации)
 *
 * Организация всегда берётся из сессии: передать чужой organizationId в теле
 * запроса нельзя. Код — единственный способ присоединиться к компании,
 * поэтому создавать и отзывать его может только админ.
 */

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { logAudit } from "@/lib/audit"
import { createInvite, describeInvite, listInvites, type InviteRole } from "@/lib/invites"
import { requireOrganization } from "@/lib/org"
import { getClientIp } from "@/lib/rate-limiter"
import { createInviteSchema } from "@/lib/validators"

export const dynamic = "force-dynamic"

function forbidden(message: string) {
  return NextResponse.json({ success: false, error: message, code: "forbidden" }, { status: 403 })
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response
  if (!org.isAdmin) return forbidden("Инвайт-коды видит только администратор организации")

  try {
    const invites = await listInvites(org.organizationId)
    return NextResponse.json({
      success: true,
      invites: invites.map((invite) => describeInvite(invite)),
    })
  } catch (error) {
    console.error("GET /api/organization/invites error:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось прочитать список приглашений" },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response
  if (!org.isAdmin) return forbidden("Создавать инвайт-коды может только администратор организации")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Некорректное тело запроса" },
      { status: 400 },
    )
  }

  const parsed = createInviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Проверьте параметры приглашения",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    )
  }

  const { role, expiresInDays, maxUses } = parsed.data
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null

  try {
    const invite = await createInvite({
      organizationId: org.organizationId,
      createdById: org.userId,
      role: role as InviteRole,
      expiresAt,
      maxUses: maxUses ?? null,
    })

    await logAudit({
      organizationId: org.organizationId,
      actorId: org.userId,
      actorEmail: auth.value.user.email ?? null,
      action: "invite_create",
      targetId: invite.id,
      targetType: "invite_code",
      metadata: {
        organizationId: org.organizationId,
        role: invite.role,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
      },
      ip: getClientIp(request),
    })

    return NextResponse.json({
      success: true,
      invite: describeInvite(invite),
      message: "Код приглашения создан",
    })
  } catch (error) {
    console.error("POST /api/organization/invites error:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось создать код приглашения" },
      { status: 500 },
    )
  }
}
