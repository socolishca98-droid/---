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

  // Радиусный поиск от Ярославля (57.6261, 39.8845): грузы, у которых точка
  // погрузки ИЛИ выгрузки ближе N км — именно так ищет сайт ATI.
  const YAR = { lat: 57.6261, lng: 39.8845 }
  const km = (a: any, b: any): number => {
    const R = 6371
    const dLat = ((b.lat - a.lat) * Math.PI) / 180
    const dLng = ((b.lng - a.lng) * Math.PI) / 180
    const la1 = (a.lat * Math.PI) / 180
    const la2 = (b.lat * Math.PI) / 180
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
    return Math.round(2 * R * Math.asin(Math.sqrt(h)))
  }
  const boardRows: any[] = (() => {
    try { return JSON.parse(boardText) } catch { return [] }
  })()
  const radiusMap = await resolveAtiCities(collectCityIds(boardRows))
  const near: any[] = []
  for (const row of boardRows) {
    const sides = [
      { side: "погрузка", loc: row?.Loading },
      { side: "выгрузка", loc: row?.Unloading },
    ]
    for (const { side, loc } of sides) {
      const lat = Number(loc?.Latitude)
      const lng = Number(loc?.Longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      if (lat === 0 && lng === 0) continue
      const d = km(YAR, { lat, lng })
      if (d <= 400) {
        const cid = Number(loc?.CityId) || 0
        const hit = cid ? radiusMap.get(cid) : undefined
        near.push({
          side,
          km: d,
          city: hit ? `${hit.name}, ${hit.region}` : cid ? `Город #${cid}` : "?",
          id: String(row?.Id ?? "").slice(0, 12),
          weight: Number(row?.Cargo?.Weight) || 0,
          price: Number(row?.Payment?.SumWithNDS) || Number(row?.Payment?.RateSum) || 0,
          distance: Number(row?.Distance) || 0,
        })
      }
    }
  }
  const radiusStats = {
    yaroslavlCityId: 88,
    nearCount: near.length,
    nearest: near.sort((a, b) => a.km - b.km).slice(0, 12),
  }

  const out: Record<string, unknown> = { byboardsCities: boardStats, yaroslavlRadius: radiusStats }
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
