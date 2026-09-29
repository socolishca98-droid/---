// app/api/ati/debug/route.ts
//
// Диагностика подключения организации к ATI.SU: кто я (users/me) и моя фирма
// (firms/my). Запросы идут с токеном ОРГАНИЗАЦИИ; сам токен в ответ не попадает.

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { atiHeaders, ATI_API_BASE } from "@/lib/ati/http"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error
  const __org = requireStaffOrganization(__auth.user)
  if (!__org.ok) return __org.response

  const ati = await getActiveAtiToken(__org.organizationId)
  if (!ati.ok) {
    return NextResponse.json({ success: false, code: ati.code, error: ati.error }, { status: 400 })
  }

  const results: any = { connected: true, me: {}, firm: {} }

  // 1. Кто я? (Проверка токена)
  try {
    const res = await fetch(`${ATI_API_BASE}/v1.0/users/me`, {
      headers: atiHeaders(ati.token),
      cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))
    results.me = { status: res.status, data }
  } catch (e) {
    results.me = { error: (e as Error).message }
  }

  // 2. Моя фирма (Проверка связи с аккаунтом)
  try {
    const res = await fetch(`${ATI_API_BASE}/v1.0/firms/my`, {
      headers: atiHeaders(ati.token),
      cache: "no-store",
    })
    const data = await res.json().catch(() => ({}))
    results.firm = { status: res.status, id: data.id, name: data.name, city: data.city }
  } catch (e) {
    results.firm = { error: (e as Error).message }
  }

  return NextResponse.json(results)
}
