// app/api/admin/dev/route.ts
//
// Кабинет разработчика (и60): всё, чем разбирались жалобы №7–№12, —
// внутри программы, а не в стороннем SQL-клиенте.
//
// GET /api/admin/dev?hours=24
//   → {
//       build, serverTime, uptimeSec, node,
//       counts: { organizations, users, drivers, orders, liveSessions },
//       sessions: [ { who, role, sessionPrefix, createdAt, expiresAt, lastSeenAt, device, ip } ],
//       events:   [ { id, createdAt, action, actor, org, targetType, targetEmail, ip, metadata } ]
//     }
//
// Права — как у журнала владельца: только владелец платформы (requireStaff +
// isOwnerEmail). Идентификаторы сессий — обрезанные префиксы: полный id и
// есть секрет, показывать его целиком на экране нельзя.

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { forbidden, requireStaff } from "@/lib/auth/session"
import { isOwnerEmail } from "@/lib/auth/owner"

export const dynamic = "force-dynamic"

const MAX_HOURS = 168
const MAX_EVENTS = 400
const MAX_SESSIONS = 100

/** Метаданные записи журнала: в базе лежат строкой JSON. */
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
  const hours = Math.min(Math.max(parseInt(params.get("hours") ?? "24", 10) || 24, 1), MAX_HOURS)
  const since = new Date(Date.now() - hours * 3_600_000)

  const [eventsRaw, sessionsRaw, orgCount, userCount, driverCount, orderCount] = await Promise.all([
    prisma.auditLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_EVENTS,
      select: {
        id: true,
        createdAt: true,
        action: true,
        actorId: true,
        actorEmail: true,
        targetType: true,
        targetEmail: true,
        metadata: true,
        ip: true,
        organization: { select: { name: true } },
      },
    }),
    prisma.session.findMany({
      where: { expiresAt: { gt: new Date() }, revokedAt: null },
      orderBy: { createdAt: "desc" },
      take: MAX_SESSIONS,
      select: {
        id: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        lastSeenAt: true,
        userAgent: true,
        ip: true,
        user: { select: { name: true, email: true, phone: true } },
      },
    }),
    prisma.organization.count(),
    prisma.user.count(),
    prisma.driver.count(),
    prisma.order.count(),
  ])

  // Имена актёров: у водителей почты нет — подтягиваем имя и телефон
  // (как в журнале). «diagnostic» — датчики, им имя не нужно.
  const missingActorIds = [
    ...new Set(eventsRaw.filter((e) => !e.actorEmail && e.actorId !== "diagnostic").map((e) => e.actorId)),
  ]
  const actorNames = new Map<string, { name: string | null; phone: string | null }>()
  if (missingActorIds.length > 0) {
    const rows = await prisma.user.findMany({
      where: { id: { in: missingActorIds } },
      select: { id: true, name: true, phone: true },
    })
    for (const row of rows) actorNames.set(row.id, { name: row.name, phone: row.phone })
  }

  const events = eventsRaw.map((row) => {
    const extra = actorNames.get(row.actorId)
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      actorEmail: row.actorEmail,
      actorName: extra?.name ?? null,
      actorPhone: extra?.phone ?? null,
      org: row.organization?.name ?? null,
      targetType: row.targetType,
      targetEmail: row.targetEmail,
      ip: row.ip,
      metadata: parseMetadata(row.metadata),
    }
  })

  const liveSessionCount = await prisma.session.count({
    where: { expiresAt: { gt: new Date() }, revokedAt: null },
  })

  const sessions = sessionsRaw.map((s) => {
    const who = s.user.name ?? s.user.email ?? s.user.phone ?? "—"
    const contact = s.user.email ?? s.user.phone ?? null
    return {
      who,
      contact,
      role: s.role,
      sessionPrefix: `${s.id.slice(0, 8)}…`,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      lastSeenAt: s.lastSeenAt ? s.lastSeenAt.toISOString() : null,
      device: s.userAgent ?? "",
      ip: s.ip,
    }
  })

  return NextResponse.json({
    build: (process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7),
    serverTime: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
    hours,
    counts: {
      organizations: orgCount,
      users: userCount,
      drivers: driverCount,
      orders: orderCount,
      liveSessions: liveSessionCount,
    },
    sessions,
    events,
  })
}
