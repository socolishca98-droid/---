// ВРЕМЕННЫЙ диагностический роут. Удаляется после проверки.
import { NextRequest, NextResponse } from "next/server"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { atiFetch, atiHeaders } from "@/lib/ati/http"

const API = "https://api.ati.su/v1.0"

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  const ati = await getActiveAtiToken(org.organizationId)
  if (!ati.ok) return NextResponse.json({ error: "no token" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const firmId = String(body.firmId ?? "26310")
  const out: Record<string, unknown> = {}

  const h = atiHeaders(ati.token)

  const tries: Array<[string, string]> = [
    ["dict-regions", `${API}/dictionaries/regions`],
    ["regions", `${API}/regions`],
    ["dict-geo", `${API}/dictionaries/geo`],
    ["dict-cities", `${API}/dictionaries/cities`],
    ["dict-all", `${API}/dictionaries`],
    ["firm-contacts", `${API}/firms/2465093/contacts`],
    ["firm-contact", `${API}/firms/2465093/contact`],
    ["load-contacts", `${API}/loads/2465093/contacts`],
    ["firms", `${API}/firms`],
  ]
  for (const [label, url] of tries) {
    try {
      const res = await atiFetch(url, { headers: h, signal: AbortSignal.timeout(8000) }, org.organizationId)
      const text = await res.text()
      out[label] = { status: res.status, body: text.slice(0, 500) }
    } catch (e: any) {
      out[label] = { error: e?.message }
    }
  }

  return NextResponse.json(out)
}
