/**
 * GET /api/auth/users — список учётных записей СВОЕЙ организации для страницы /users
 * (одобрение регистраций, закрытие и восстановление доступа).
 *
 * Доступ: admin, logist. Список всегда ограничен организацией из сессии —
 * filter по organizationId нельзя ни снять, ни подменить параметром запроса.
 * Пагинация настоящая (page/pageSize + total), а не «take: 50 и молча обрезать».
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireStaff } from "@/lib/auth/session"
import { requireOrganization, scopedWhere } from "@/lib/org"

import { USER_ROLES, USER_STATUSES, type UserRole, type UserStatus } from "@/lib/auth/constants"

export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  const { searchParams } = request.nextUrl
  const statusParam = searchParams.get("status") || "all"
  const roleParam = searchParams.get("role") || "all"
  const query = (searchParams.get("q") || "").trim()
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE),
  )

  const status = USER_STATUSES.includes(statusParam as UserStatus)
    ? (statusParam as UserStatus)
    : null
  const role = USER_ROLES.includes(roleParam as UserRole) ? (roleParam as UserRole) : null

  const where = scopedWhere(org.organizationId, {
    ...(status ? { status } : {}),
    ...(role ? { role } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { email: { contains: query } },
            { phone: { contains: query } },
          ],
        }
      : {}),
  })

  try {
    const [users, total, pendingCount] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          mustChangePassword: true,
          createdAt: true,
          approvedAt: true,
          approvedById: true,
          suspendedAt: true,
          suspendReason: true,
          restoredAt: true,
          lastLoginAt: true,
          failedLoginCount: true,
          lockedUntil: true,
          driverId: true,
          organizationId: true,
          driver: { select: { id: true, name: true, vehiclePlate: true, status: true } },
          inviteCode: { select: { id: true, code: true, role: true, createdById: true } },
          sessions: {
            where: { revokedAt: null, expiresAt: { gt: new Date() } },
            select: { id: true },
          },
        },
      }),
      // org-audit: ok — where построен через scopedWhere(organizationId) выше
      prisma.user.count({ where }),
      prisma.user.count({ where: scopedWhere(org.organizationId, { status: "pending" }) }),
    ])

    return NextResponse.json({
      success: true,
      users: users.map((user: any) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt,
        approvedAt: user.approvedAt,
        approvedById: user.approvedById,
        suspendedAt: user.suspendedAt,
        suspendReason: user.suspendReason,
        restoredAt: user.restoredAt,
        lastLoginAt: user.lastLoginAt,
        failedLoginCount: user.failedLoginCount,
        isLocked: Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now()),
        driverId: user.driverId,
        driver: user.driver,
        organizationId: user.organizationId,
        inviteCode: user.inviteCode,
        activeSessions: Array.isArray(user.sessions) ? user.sessions.length : 0,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      pendingCount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[auth/users] error:", message)
    return NextResponse.json(
      { success: false, error: "Не удалось загрузить список сотрудников" },
      { status: 500 },
    )
  }
}
