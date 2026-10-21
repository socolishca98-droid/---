// app/api/ati/debug/route.ts
//
// Диагностика подключения организации к ATI.SU: моя фирма (firms/my) и
// доступ к грузам (loads/search/byboards). Запросы идут с токеном ОРГАНИЗАЦИИ;
// сам токен в ответ не попадает.
//
// Важно: эндпоинт /v1.0/users/me у ATI больше не существует (отвечает 404) —
// проверено вживую. Поэтому «кто я» определяется через фирму: токен выдаётся
// на контакт в аккаунте, и firms/my возвращает ту фирму, от имени которой
// работаем.

import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { atiFetch, atiHeaders, ATI_API_BASE } from "@/lib/ati/http"
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

  const results: any = { connected: true, firm: {}, loads: {} }

  // 1. Моя фирма (проверка токена: токен жив — ATI вернёт 200)
  try {
    const res = await atiFetch(
      `${ATI_API_BASE}/v1.0/firms/my`,
      { headers: atiHeaders(ati.token), cache: "no-store" },
      __org.organizationId,
    )
    const data = await res.json().catch(() => ({}))
    results.firm = { status: res.status, id: data.id, name: data.name, city: data.city }
  } catch (e) {
    results.firm = { error: (e as Error).message }
  }

  // 2. Доступ к грузам (проверка прав: даже пустой поиск отвечает 200)
  try {
    const res = await atiFetch(
      `${ATI_API_BASE}/v1.0/loads/search/byboards`,
      {
        method: "POST",
        headers: atiHeaders(ati.token),
        body: JSON.stringify({ page: 0, items_per_page: 1 }),
        cache: "no-store",
      },
      __org.organizationId,
    )
    results.loads = { status: res.status }
  } catch (e) {
    results.loads = { error: (e as Error).message }
  }

  return NextResponse.json(results)
}
