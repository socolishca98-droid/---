// app/api/ati/connection/check/route.ts
//
// Живая проверка подключения организации к ATI.SU: GET /v1.0/firms/my
// с токеном организации. Заполняет firmId/firmName и статус (active/invalid).
// Только админ: результат меняет запись подключения организации.

import { NextRequest, NextResponse } from "next/server"

import { requireStaff } from "@/lib/auth/session"
import { requireOrganization } from "@/lib/org"
import { verifyConnection } from "@/lib/ati/connection"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const org = requireOrganization(auth.value)
  if (!org.ok) return org.response

  if (auth.value.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: "Проверять подключение может только администратор организации" },
      { status: 403 },
    )
  }

  const result = await verifyConnection(org.organizationId)
  if (result.ok) {
    return NextResponse.json({ success: true, firmId: result.firmId, firmName: result.firmName })
  }
  const status = result.code === "ati_not_connected" ? 404 : 400
  return NextResponse.json({ success: false, code: result.code, error: result.error }, { status })
}
