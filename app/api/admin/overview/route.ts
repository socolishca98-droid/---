// app/api/admin/overview/route.ts
//
// Стартовый экран владельца платформы: все компании, которые пользуются
// программой, с ключевыми цифрами и последней активностью.
//
// Доступ только владельцу (OWNER_EMAIL, см. lib/auth/owner.ts).
//
// GET /api/admin/overview
//   → { totals, organizations: [...], recent: [...] }

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff, unauthorized } from "@/lib/auth/session"
import { isOwnerEmail } from "@/lib/auth/owner"

export const dynamic = "force-dynamic"

// Рейс «в работе»: ещё не завершён и не отменён
const OPEN_ROUTE_STATUSES = ["planned", "active", "in_transit"]
// Заказ «в работе»: ещё не доставлен и не отменён
const CLOSED_ORDER_STATUSES = ["delivered", "cancelled"]

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  if (!isOwnerEmail(auth.value.user.email)) {
    return unauthorized("Раздел доступен только владельцу платформы")
  }

  const [orgs, userGroups, driverGroups, vehicleGroups, routeGroups, orderGroups, auditGroups, recent] =
    await Promise.all([
      prisma.organization.findMany({
        select: { id: true, name: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.user.groupBy({
        by: ["organizationId", "role"],
        _count: { _all: true },
        _max: { lastLoginAt: true },
      }),
      prisma.driver.groupBy({ by: ["organizationId"], _count: { _all: true } }),
      prisma.vehicle.groupBy({ by: ["organizationId"], _count: { _all: true } }),
      prisma.route.groupBy({ by: ["organizationId", "status"], _count: { _all: true } }),
      prisma.order.groupBy({ by: ["organizationId", "status"], _count: { _all: true } }),
      prisma.auditLog.groupBy({ by: ["organizationId"], _max: { createdAt: true } }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          createdAt: true,
          organizationId: true,
          actorEmail: true,
          action: true,
          targetType: true,
          targetEmail: true,
          organization: { select: { name: true } },
        },
      }),
    ])

  type Bucket = {
    staff: number
    admins: number
    logists: number
    drivers: number
    vehicles: number
    activeRoutes: number
    completedRoutes: number
    ordersInWork: number
    ordersDelivered: number
    lastLoginAt: Date | null
    lastAuditAt: Date | null
  }
  const empty = (): Bucket => ({
    staff: 0,
    admins: 0,
    logists: 0,
    drivers: 0,
    vehicles: 0,
    activeRoutes: 0,
    completedRoutes: 0,
    ordersInWork: 0,
    ordersDelivered: 0,
    lastLoginAt: null,
    lastAuditAt: null,
  })
  const byOrg = new Map<string, Bucket>()
  const bucket = (orgId: string | null) => {
    const key = orgId ?? ""
    let entry = byOrg.get(key)
    if (!entry) {
      entry = empty()
      byOrg.set(key, entry)
    }
    return entry
  }

  for (const group of userGroups) {
    const entry = bucket(group.organizationId)
    if (group.role === "driver") continue
    const count = group._count._all
    entry.staff += count
    if (group.role === "admin") entry.admins += count
    if (group.role === "logist") entry.logists += count
    const last = group._max.lastLoginAt
    if (last && (!entry.lastLoginAt || last > entry.lastLoginAt)) entry.lastLoginAt = last
  }
  for (const group of driverGroups) bucket(group.organizationId).drivers += group._count._all
  for (const group of vehicleGroups) bucket(group.organizationId).vehicles += group._count._all
  for (const group of routeGroups) {
    const entry = bucket(group.organizationId)
    if (OPEN_ROUTE_STATUSES.includes(group.status)) entry.activeRoutes += group._count._all
    if (group.status === "completed") entry.completedRoutes += group._count._all
  }
  for (const group of orderGroups) {
    const entry = bucket(group.organizationId)
    if (group.status === "delivered") entry.ordersDelivered += group._count._all
    if (!CLOSED_ORDER_STATUSES.includes(group.status)) entry.ordersInWork += group._count._all
  }
  for (const group of auditGroups) {
    const at = group._max.createdAt
    if (at) bucket(group.organizationId).lastAuditAt = at
  }

  const organizations = orgs.map((org) => {
    const entry = byOrg.get(org.id) ?? empty()
    const last = [entry.lastLoginAt, entry.lastAuditAt]
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0]
    return {
      id: org.id,
      name: org.name,
      createdAt: toIso(org.createdAt),
      staff: entry.staff,
      admins: entry.admins,
      logists: entry.logists,
      drivers: entry.drivers,
      vehicles: entry.vehicles,
      activeRoutes: entry.activeRoutes,
      completedRoutes: entry.completedRoutes,
      ordersInWork: entry.ordersInWork,
      ordersDelivered: entry.ordersDelivered,
      lastActivityAt: toIso(last ?? null),
    }
  })

  // Записи без организации (например, вход владельца) считаем отдельно
  const orphan = byOrg.get("")
  const totals = organizations.reduce(
    (sum, org) => ({
      organizations: sum.organizations + 1,
      staff: sum.staff + org.staff,
      drivers: sum.drivers + org.drivers,
      vehicles: sum.vehicles + org.vehicles,
      activeRoutes: sum.activeRoutes + org.activeRoutes,
      ordersInWork: sum.ordersInWork + org.ordersInWork,
      ordersDelivered: sum.ordersDelivered + org.ordersDelivered,
    }),
    {
      organizations: 0,
      staff: orphan?.staff ?? 0,
      drivers: orphan?.drivers ?? 0,
      vehicles: orphan?.vehicles ?? 0,
      activeRoutes: orphan?.activeRoutes ?? 0,
      ordersInWork: orphan?.ordersInWork ?? 0,
      ordersDelivered: orphan?.ordersDelivered ?? 0,
    },
  )

  return NextResponse.json({
    owner: { email: auth.value.user.email },
    totals,
    organizations,
    recent: recent.map((row) => ({
      id: row.id,
      createdAt: toIso(row.createdAt),
      organizationId: row.organizationId,
      organizationName: row.organization?.name ?? null,
      actorEmail: row.actorEmail,
      action: row.action,
      targetType: row.targetType,
      targetEmail: row.targetEmail,
    })),
  })
}
