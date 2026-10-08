// app/api/admin/accounts/route.ts
//
// Список аккаунтов для страницы администрирования (вход в любой аккаунт).
//
// Доступен только владельцу платформы (OWNER_EMAIL, см. lib/auth/owner.ts):
// он один видит все организации и всех пользователей сразу.
//
// GET /api/admin/accounts?query=иван
//   → { organizations: [{ id, name, users: [...], drivers: [...] }], totals }

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { requireStaff, unauthorized } from "@/lib/auth/session"
import { isOwnerEmail } from "@/lib/auth/owner"
import { DRIVER_STATUS_META } from "@/lib/logist-mobile/types"

export const dynamic = "force-dynamic"

const LIMIT = 500

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  if (!isOwnerEmail(auth.value.user.email)) {
    return unauthorized("Раздел доступен только владельцу платформы")
  }

  const query = (request.nextUrl.searchParams.get("query") ?? "").trim()
  const like = query.length > 0 ? query : null

  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const where = like
    ? {
        OR: [
          { name: { contains: like, mode: "insensitive" as const } },
          { email: { contains: like, mode: "insensitive" as const } },
          { phone: { contains: like } },
        ],
      }
    : {}

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      organizationId: true,
      driverId: true,
      lastLoginAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    take: LIMIT,
  })

  // Водители — отдельные карточки: у некоторых ещё нет входа в приложение,
  // но войти «как водитель» всё равно нужно (проверить, что он видит).
  const drivers = await prisma.driver.findMany({
    where: like
      ? {
          OR: [
            { name: { contains: like, mode: "insensitive" as const } },
            { phone: { contains: like } },
            { vehiclePlate: { contains: like, mode: "insensitive" as const } },
          ],
        }
      : {},
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      organizationId: true,
      vehiclePlate: true,
    },
    orderBy: { name: "asc" },
    take: LIMIT,
  })

  const driverUserIds = new Map(
    users.filter((user) => user.driverId).map((user) => [user.driverId as string, user.id]),
  )

  const orgName = new Map(organizations.map((org) => [org.id, org.name]))

  const grouped = organizations.map((org) => ({
    id: org.id,
    name: org.name,
    users: users
      .filter((user) => user.organizationId === org.id && user.role !== "driver")
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        kind: "staff" as const,
      })),
    drivers: drivers
      .filter((driver) => driver.organizationId === org.id)
      .map((driver) => ({
        id: driver.id,
        userId: driverUserIds.get(driver.id) ?? null,
        name: driver.name,
        phone: driver.phone,
        status: driver.status,
        statusLabel: DRIVER_STATUS_META[driver.status]?.label ?? driver.status,
        vehiclePlate: driver.vehiclePlate,
        kind: "driver" as const,
      })),
  }))

  // Пользователи без организации (например, владелец до привязки) — отдельной группой
  const orphanStaff = users.filter((user) => !user.organizationId && user.role !== "driver")
  if (orphanStaff.length > 0) {
    grouped.unshift({
      id: "__none__",
      name: "Без организации",
      users: orphanStaff.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
        kind: "staff" as const,
      })),
      drivers: [],
    })
  }

  const visible = grouped.filter((group) => group.users.length > 0 || group.drivers.length > 0)

  return NextResponse.json({
    success: true,
    owner: { email: auth.value.user.email, organizations: orgName.size },
    organizations: visible,
    totals: {
      organizations: visible.length,
      staff: visible.reduce((sum, group) => sum + group.users.length, 0),
      drivers: visible.reduce((sum, group) => sum + group.drivers.length, 0),
    },
  })
}
