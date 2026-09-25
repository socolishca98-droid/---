// app/api/notifications/route.ts
//
// Колокольчик штаба: уведомления логисту/администратору.
//
// Раньше уведомления только писались в базу (SOS от водителя, новое фото,
// просроченный платёж, догруз), но посмотреть их было негде — теперь их
// отдаёт этот роут, а показывает components/notifications-bell.tsx.
//
// GET  /api/notifications           — список + количество непрочитанных
// POST /api/notifications           — отметить прочитанным / все / очистить
//                                     { action: "read", id } | { action: "readAll" }
//                                     | { action: "clear" }

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { prisma } from "@/lib/prisma"

/** Роли, которым адресованы штабные уведомления. */
const STAFF_ROLES = ["admin", "logist", "staff"]

/**
 * Часть уведомлений адресуется роли, а не человеку: в базе это записано
 * служебными значениями («logist», «all_logists»). Их должен видеть каждый
 * сотрудник подходящей роли из той же организации.
 */
const ROLE_ADDRESSES = ["logist", "all_logists", "admin", "all_admins", "staff", "all_staff"]

/**
 * Кому адресовано уведомление: конкретному сотруднику, служебному «всем
 * логистам» или всей роли. Фильтр по организации добавляет scopedWhere прямо
 * в запросе — так его видит и проверка изоляции (npm run audit:orgs).
 */
function addressedTo(userId: string, role: string) {
  return {
    // уведомления водителям (route_assigned, sos_status) штабу не показываем
    NOT: { userRole: "driver" },
    OR: [{ userId }, { userId: { in: ROLE_ADDRESSES } }, { userRole: role }],
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const user = auth.value.user
  const org = requireStaffOrganization(user)
  if (!org.ok) return org.response
  if (!STAFF_ROLES.includes(user.role)) {
    return NextResponse.json(
      { success: false, error: "Недостаточно прав для этого действия" },
      { status: 403 },
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 30, 1), 100)
    const onlyUnread = searchParams.get("unread") === "1"
    const filter = addressedTo(user.id, user.role)

    const [notifications, unread] = await Promise.all([
      prisma.notification.findMany({
        where: scopedWhere(org.organizationId, onlyUnread ? { ...filter, isRead: false } : filter),
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.notification.count({
        where: scopedWhere(org.organizationId, { ...filter, isRead: false }),
      }),
    ])

    return NextResponse.json({ success: true, unread, notifications })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response

  const user = auth.value.user
  const org = requireStaffOrganization(user)
  if (!org.ok) return org.response
  if (!STAFF_ROLES.includes(user.role)) {
    return NextResponse.json(
      { success: false, error: "Недостаточно прав для этого действия" },
      { status: 403 },
    )
  }

  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body.action !== "string") {
      return NextResponse.json({ success: false, error: "Укажите действие" }, { status: 400 })
    }

    const filter = addressedTo(user.id, user.role)
    const now = new Date()

    if (body.action === "read") {
      if (!body.id || typeof body.id !== "string") {
        return NextResponse.json({ success: false, error: "Укажите id уведомления" }, { status: 400 })
      }
      const result = await prisma.notification.updateMany({
        where: scopedWhere(org.organizationId, { ...filter, id: body.id }),
        data: { isRead: true, readAt: now },
      })
      if (result.count === 0) {
        return NextResponse.json({ success: false, error: "Уведомление не найдено" }, { status: 404 })
      }
      return NextResponse.json({ success: true })
    }

    if (body.action === "readAll") {
      const result = await prisma.notification.updateMany({
        where: scopedWhere(org.organizationId, { ...filter, isRead: false }),
        data: { isRead: true, readAt: now },
      })
      return NextResponse.json({ success: true, updated: result.count })
    }

    if (body.action === "clear") {
      const result = await prisma.notification.deleteMany({
        where: scopedWhere(org.organizationId, { ...filter, isRead: true }),
      })
      return NextResponse.json({ success: true, deleted: result.count })
    }

    return NextResponse.json({ success: false, error: "Неизвестное действие" }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
