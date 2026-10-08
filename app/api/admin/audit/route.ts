// app/api/admin/audit/route.ts - журнал действий организации (админ и логист)
import { NextRequest, NextResponse } from "next/server"
import { getStaffSession } from "@/lib/api-auth"
import { getAuditLogs } from "@/lib/audit"
import { requireStaffOrganization } from "@/lib/org"
import { STAFF_ROLES } from "@/lib/auth/constants"

export async function GET(req: NextRequest) {
  try {
    const sessionUser = await getStaffSession(req)
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: "Требуется авторизация" }, { status: 401 })
    }

    // Админ и логист — один профиль: журнал доступен обоим
    if (!STAFF_ROLES.includes(sessionUser.role as (typeof STAFF_ROLES)[number])) {
      return NextResponse.json({ success: false, error: "Доступ только для сотрудников" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get("limit") || "100", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)
    const action = searchParams.get("action") || undefined
    const actorId = searchParams.get("actorId") || undefined
    const targetId = searchParams.get("targetId") || undefined

    const org = requireStaffOrganization(sessionUser)
    if (!org.ok) return org.response

    const logs = await getAuditLogs({
      limit: isNaN(limit) ? 100 : limit,
      offset: isNaN(offset) ? 0 : offset,
      action,
      actorId,
      targetId,
      organizationId: org.organizationId,
    })

    return NextResponse.json({ success: true, logs })
  } catch (error: any) {
    console.error("[Audit API] Error:", error)
    return NextResponse.json({ success: false, error: error.message || "Ошибка сервера" }, { status: 500 })
  }
}
