// ВРЕМЕННЫЙ диагностический роут: чем ATI отдаёт грузы по фильтру города.
// Создан, чтобы проверить, доступен ли общий поиск по бирже (а не только
// по своим площадкам). После проверки удаляется.
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { atiFetch, atiHeaders, ATI_API_BASE } from "@/lib/ati/http"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  const ati = await getActiveAtiToken(org.organizationId)
  if (!ati.ok) {
    return NextResponse.json({ success: false, code: ati.code, error: ati.error }, { status: 400 })
  }

  const probes: Array<{ name: string; url: string }> = [
    { name: "loads/search", url: `${ATI_API_BASE}/v1.0/loads/search` },
    { name: "loads/search.json", url: `${ATI_API_BASE}/v1.0/loads/search.json` },
    { name: "loads/search?from.city_id=88", url: `${ATI_API_BASE}/v1.0/loads/search?from.city_id=88&from.radius=300` },
    { name: "loads?to=88", url: `${ATI_API_BASE}/v1.0/loads?to=88` },
    { name: "loads/search/byboards (эталон)", url: `${ATI_API_BASE}/v1.0/loads/search/byboards` },
    { name: "boards/list (публичные)", url: `${ATI_API_BASE}/v2/boards/public/boards/list` },
    { name: "boards/canView (мои)", url: `${ATI_API_BASE}/v2/boards/public/boards/canView` },
    { name: "boards/participating (участвую)", url: `${ATI_API_BASE}/v2/boards/public/boards/participating` },
    { name: "boards/my (свои)", url: `${ATI_API_BASE}/v2/boards/public/boards/my` },
  ]

  // Разбор выдачи byboards: в ответе только CityId — имена городов
  // резолвим тем же резолвером, что и боевой сканер.
  const { resolveAtiCities } = await import("@/lib/ati/ati-city-resolver")
  const { collectCityIds } = await import("@/lib/ati/boards-mapping")
  const boardRes = await atiFetch(
    `${ATI_API_BASE}/v1.0/loads/search/byboards`,
    { headers: atiHeaders(ati.token), cache: "no-store", signal: AbortSignal.timeout(20_000) },
    org.organizationId,
  )
  const boardText = await boardRes.text()
  let boardStats: Record<string, unknown> = {}
  try {
    const rows: any[] = JSON.parse(boardText)
    const cities = await resolveAtiCities(collectCityIds(rows))
    const from: Record<string, number> = {}
    const to: Record<string, number> = {}
    for (const row of rows) {
      const name = (id: any): string => {
        const cid = Number(id) || 0
        const hit = cid ? cities.get(cid) : undefined
        return hit ? `${hit.name} (${cid})` : cid ? `Город #${cid}` : "?"
      }
      const f = name(row?.Loading?.CityId)
      const t = name(row?.Unloading?.CityId)
      from[f] = (from[f] ?? 0) + 1
      to[t] = (to[t] ?? 0) + 1
    }
    const yarFrom = Object.entries(from).filter(([k]) => k.startsWith("Ярославль")).reduce((a, [, v]) => a + v, 0)
    const yarTo = Object.entries(to).filter(([k]) => k.startsWith("Ярославль")).reduce((a, [, v]) => a + v, 0)
    boardStats = {
      total: rows.length,
      yaroslavlFrom: yarFrom,
      yaroslavlTo: yarTo,
      fromTop: Object.entries(from).sort((a, b) => b[1] - a[1]).slice(0, 15),
      toTop: Object.entries(to).sort((a, b) => b[1] - a[1]).slice(0, 15),
      sampleKeys: Object.keys(rows[0] ?? {}).slice(0, 30),
    }
  } catch (error) {
    boardStats = { error: error instanceof Error ? error.message : String(error) }
  }

  const out: Record<string, unknown> = { byboardsCities: boardStats }
  for (const probe of probes) {
    try {
      const res = await atiFetch(
        probe.url,
        { headers: atiHeaders(ati.token), cache: "no-store", signal: AbortSignal.timeout(20_000) },
        org.organizationId,
      )
      const text = await res.text()
      let count: number | null = null
      try {
        const parsed = JSON.parse(text)
        const rows = Array.isArray(parsed) ? parsed : parsed?.loads ?? parsed?.items ?? []
        count = Array.isArray(rows) ? rows.length : null
      } catch {
        count = null
      }
      out[probe.name] = { status: res.status, count, sample: text.slice(0, 200) }
    } catch (error) {
      out[probe.name] = { error: error instanceof Error ? error.message : String(error) }
    }
  }

  return NextResponse.json({ success: true, probes: out })
}
