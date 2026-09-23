/**
 * GET /api/organization — организация текущего пользователя.
 *
 * Организация берётся из проверенной сессии (lib/org.ts). Запрос не принимает
 * идентификатор организации ни в теле, ни в query: иначе можно было бы прочитать
 * чужую компанию.
 */

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { getOrganizationSummary } from "@/lib/organizations"
import { requireOrganization } from "@/lib/org"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  try {
    const [organization, summary, activeInvites] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: org.organizationId },
        select: { id: true, name: true, createdAt: true },
      }),
      getOrganizationSummary(org.organizationId),
      prisma.inviteCode.count({
        where: { organizationId: org.organizationId, revokedAt: null },
      }),
    ])

    if (!organization) {
      return NextResponse.json(
        { success: false, error: "Организация не найдена" },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      organization: {
        id: organization.id,
        name: organization.name,
        createdAt: organization.createdAt,
      },
      summary: { ...summary, activeInvites },
      me: {
        id: org.userId,
        role: org.role,
        isAdmin: org.isAdmin,
      },
    })
  } catch (error) {
    console.error("GET /api/organization error:", error)
    return NextResponse.json(
      { success: false, error: "Не удалось прочитать данные организации" },
      { status: 500 },
    )
  }
}
