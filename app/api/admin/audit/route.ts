// app/api/admin/audit/route.ts - P1-4 Audit log API (admin only)
import { NextRequest, NextResponse } from "next/server"
import { getStaffSession } from "@/lib/auth-server"
import { getAuditLogs } from "@/lib/audit"

export async function GET(req: NextRequest) {
  try {
    const sessionUser = await getStaffSession(req)
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: "Требуется авторизация" }, { status: 401 })
    }

    // Only admin can view audit logs
    if ((sessionUser as any).role !== "admin") {
      return NextResponse.json({ success: false, error: "Доступ только для администратора" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get("limit") || "100", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)
    const action = searchParams.get("action") || undefined
    const actorId = searchParams.get("actorId") || undefined
    const targetId = searchParams.get("targetId") || undefined

    const logs = await getAuditLogs({
      limit: isNaN(limit) ? 100 : limit,
      offset: isNaN(offset) ? 0 : offset,
      action,
      actorId,
      targetId,
    })

    return NextResponse.json({ success: true, logs })
  } catch (error: any) {
    console.error("[Audit API] Error:", error)
    return NextResponse.json({ success: false, error: error.message || "Ошибка сервера" }, { status: 500 })
  }
}
