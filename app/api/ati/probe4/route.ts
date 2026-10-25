// ВРЕМЕННЫЙ диагностический роут. Удаляется после проверки.
import { NextRequest, NextResponse } from "next/server"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { atiFetch, atiHeaders } from "@/lib/ati/http"

const API = "https://api.ati.su/v1.0"
const EX = "https://loads.ati.su/webapi/v1.0"

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const org = requireStaffOrganization(auth.user)
  if (!org.ok) return org.response

  const ati = await getActiveAtiToken(org.organizationId)
  if (!ati.ok) return NextResponse.json({ error: "no token" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const out: Record<string, unknown> = {}
  const h = atiHeaders(ati.token)

  // Официальный словарь регионов
  const regRes = await atiFetch(`${API}/dictionaries/regions`, { headers: h }, org.organizationId)
  const regions: any[] = regRes.ok ? await regRes.json().catch(() => []) : []
  out["regions:count"] = regions.length
  out["regions:yaroslavl"] = regions.find((r) => /Ярославск/i.test(r.Name ?? "")) ?? null
  out["regions:chelyabinsk"] = regions.find((r) => /Челябинск/i.test(r.Name ?? "")) ?? null

  // Официальный словарь городов
  const cityRes = await atiFetch(`${API}/dictionaries/cities`, { headers: h }, org.organizationId)
  const cities: any[] = cityRes.ok ? await cityRes.json().catch(() => []) : []
  out["cities:count"] = cities.length
  out["cities:yaroslavl"] = cities.find((c) => /^Ярославль$/i.test(c.CityName ?? "")) ?? null
  out["cities:vologda"] = cities.find((c) => /^Вологда$/i.test(c.CityName ?? "")) ?? null

  // Проверяем: сайтовый поиск по RegionId другого региона
  const chel = regions.find((r) => /Челябинск/i.test(r.Name ?? ""))
  if (chel) {
    const res = await atiFetch(
      `${EX}/loads/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ati.token}`,
          Cookie: `sid=${ati.token};`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
          Referer: "https://loads.ati.su/",
          Origin: "https://loads.ati.su",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          exclude_geo_dicts: true,
          page: 1,
          items_per_page: 5,
          filter: {
            sorting_type: 2,
            from: { id: chel.Id, type: 1, radius: 300, exact_only: false },
          },
        }),
      },
      org.organizationId,
    )
    const text = await res.text()
    let total = null
    let sample: string[] = []
    try {
      const parsed = JSON.parse(text)
      total = parsed.totalItems
      sample = (parsed.loads ?? []).slice(0, 3).map((l: any) => l?.loading?.location?.city)
    } catch {}
    out["regionSearch:chelyabinsk"] = { id: chel.Id, status: res.status, totalItems: total, sample }
  }

  // Умеет ли словарь городов искать по названию?
  for (const q of ["Вологда", "Кострома"]) {
    const r = await atiFetch(
      `${API}/dictionaries/cities?cityName=${encodeURIComponent(q)}`,
      { headers: h },
      org.organizationId,
    )
    const t = await r.text()
    let n = null
    let first = null
    try {
      const arr = JSON.parse(t)
      n = Array.isArray(arr) ? arr.length : null
      first = Array.isArray(arr) ? arr[0] : null
    } catch {}
    out[`citiesQuery:${q}`] = { status: r.status, count: n, first }
  }

  return NextResponse.json(out)
}
