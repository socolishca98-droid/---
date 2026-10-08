// app/api/admin/journal/route.ts
//
// Журнал действий по всем компаниям — для владельца платформы.
// В отличие от /api/admin/audit (только своя организация), здесь видно всё:
// кто, в какой компании, что сделал и когда.
//
// GET /api/admin/journal?organizationId=&action=&limit=50&offset=0
//   → { items: [...], total, limit, offset }

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff, unauthorized } from "@/lib/auth/session"
import { isOwnerEmail } from "@/lib/auth/owner"

export const dynamic = "force-dynamic"

const MAX_LIMIT = 200

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  if (!isOwnerEmail(auth.value.user.email)) {
    return unauthorized("Раздел доступен только владельцу платформы")
  }

  const params = request.nextUrl.searchParams
  const organizationId = (params.get("organizationId") ?? "").trim()
  const action = (params.get("action") ?? "").trim()
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "50", 10) || 50, 1), MAX_LIMIT)
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0)

  const where = {
    ...(organizationId ? { organizationId } : {}),
    ...(action ? { action } : {}),
  }

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        createdAt: true,
        organizationId: true,
        actorEmail: true,
        action: true,
        targetType: true,
        targetId: true,
        targetEmail: true,
        metadata: true,
        ip: true,
        organization: { select: { name: true } },
      },
    }),
  ])

  return NextResponse.json({
    total,
    limit,
    offset,
    items: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      actorEmail: row.actorEmail,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      targetEmail: row.targetEmail,
      metadata: row.metadata,
      ip: row.ip,
    })),
  })
}
