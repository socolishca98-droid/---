// ВРЕМЕННЫЙ диагностический роут. Удаляется после проверки.
import { NextRequest, NextResponse } from "next/server"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { atiHeaders } from "@/lib/ati/http"

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  const ati = await getActiveAtiToken(org.organizationId)
  if (!ati.ok) return NextResponse.json({ error: "no token" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const firmId = String(body.firmId ?? "2465093")
  const h = atiHeaders(ati.token)
  const out: Record<string, unknown> = {}

  // Официальный документированный метод: контакты другой фирмы.
  // Лимит ATI — 1000 запросов в сутки (п. «Получение реквизитов других фирм»).
  const paths = [
    `/v1.0/firms/${firmId}/contacts/summary`,
    `/gw/oauth2/firms/v1.0/firms/${firmId}/contacts/summary`,
    `/v1.0/firms/${firmId}/contacts`,
    `/v1.0/firms/${firmId}/summary`,
  ]
  for (const path of paths) {
    try {
      const res = await fetch(`https://api.ati.su${path}`, {
        headers: { ...h, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      })
      const text = await res.text()
      out[path] = { status: res.status, body: text.slice(0, 700) }
    } catch (error) {
      out[path] = { status: 0, error: String(error) }
    }
  }

  return NextResponse.json(out)
}
