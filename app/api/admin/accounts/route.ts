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
import { forbidden, requireStaff } from "@/lib/auth/session"
import { isOwnerEmail } from "@/lib/auth/owner"
import { DRIVER_STATUS_META } from "@/lib/logist-mobile/types"

export const dynamic = "force-dynamic"

const LIMIT = 500

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  if (!isOwnerEmail(auth.value.user.email)) {
    // Нейтральный отказ: существование пульта владельца не раскрываем
    return forbidden()
  }

  const query = (request.nextUrl.searchParams.get("query") ?? "").trim()
  // Поиск без учёта регистра делаем в JS: SQLite не поддерживает
  // mode: "insensitive" в Prisma (то же правило, что в lib/organizations.ts),
  // а Postgres и SQLite должны вести себя одинаково. Объём ограничен LIMIT.
  const needle = query.length > 0 ? query.toLowerCase() : null
  const matches = (...fields: Array<string | null | undefined>) =>
    needle === null || fields.some((field) => (field ?? "").toLowerCase().includes(needle))

  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // Учётки берём без фильтра: они нужны целиком, чтобы связать водителей
  // с их пользователями (статус доступа), даже когда ищут только водителя.
  const allUsers = await prisma.user.findMany({
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
      suspendReason: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    take: LIMIT,
  })
  const users = allUsers.filter((user) => matches(user.name, user.email, user.phone))

  // Водители — отдельные карточки: у некоторых ещё нет входа в приложение,
  // но войти «как водитель» всё равно нужно (проверить, что он видит).
  const allDrivers = await prisma.driver.findMany({
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
  const drivers = allDrivers.filter((driver) =>
    matches(driver.name, driver.phone, driver.vehiclePlate),
  )

  // Водителю доступ закрывается через его учётную запись (User): карточке
  // Driver нужен и id учётки, и её статус — иначе кнопкам не на что опереться.
  const driverUsers = new Map(
    allUsers
      .filter((user) => user.driverId)
      .map((user) => [
        user.driverId as string,
        { id: user.id, status: user.status, suspendReason: user.suspendReason },
      ]),
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
        suspendReason: user.suspendReason,
        kind: "staff" as const,
      })),
    drivers: drivers
      .filter((driver) => driver.organizationId === org.id)
      .map((driver) => {
        const account = driverUsers.get(driver.id) ?? null
        return {
          id: driver.id,
          userId: account?.id ?? null,
          userStatus: account?.status ?? null,
          suspendReason: account?.suspendReason ?? null,
          name: driver.name,
          phone: driver.phone,
          status: driver.status,
          statusLabel: DRIVER_STATUS_META[driver.status]?.label ?? driver.status,
          vehiclePlate: driver.vehiclePlate,
          kind: "driver" as const,
        }
      }),
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
        suspendReason: user.suspendReason,
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
