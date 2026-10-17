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
import { forbidden, requireStaff } from "@/lib/auth/session"
import { isOwnerEmail } from "@/lib/auth/owner"

export const dynamic = "force-dynamic"

const MAX_LIMIT = 200

/** Метаданные записи: в базе лежат строкой JSON. */
function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  if (!isOwnerEmail(auth.value.user.email)) {
    // Нейтральный отказ: существование пульта владельца не раскрываем
    return forbidden()
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
        actorId: true,
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

  // Исполнитель должен быть опознан даже без почты: у водителей почты нет
  // вовсе, и без подстановки имени/телефона журнал показывает прочерк —
  // непонятно, кто сделал действие.
  const missingActorIds = [
    ...new Set(rows.filter((row) => !row.actorEmail && row.actorId).map((row) => row.actorId)),
  ]
  const actorFallback = new Map<string, { name: string | null; phone: string | null }>()
  if (missingActorIds.length > 0) {
    const actors = await prisma.user.findMany({
      where: { id: { in: missingActorIds } },
      select: { id: true, name: true, phone: true },
    })
    for (const actor of actors) {
      actorFallback.set(actor.id, { name: actor.name, phone: actor.phone })
    }
  }

  return NextResponse.json({
    total,
    limit,
    offset,
    items: rows.map((row) => {
      const meta = parseMetadata(row.metadata)
      const fallback = row.actorEmail ? null : (actorFallback.get(row.actorId) ?? null)
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        organizationId: row.organizationId,
        organizationName: row.organization?.name ?? null,
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        actorName: fallback?.name ?? null,
        actorPhone: fallback?.phone ?? null,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        targetEmail: row.targetEmail,
        // Идентификатор запроса: если понадобится разобрать инцидент, одну и ту
        // же операцию можно найти по номеру в логах и в журнале.
        requestId: typeof meta?.requestId === "string" ? meta.requestId : null,
        metadata: meta,
        ip: row.ip,
      }
    }),
  })
}
