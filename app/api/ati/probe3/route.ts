// ВРЕМЕННЫЙ диагностический роут. Удаляется после проверки.
import { NextRequest, NextResponse } from "next/server"
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { getActiveAtiToken } from "@/lib/ati/connection"
import { atiFetch } from "@/lib/ati/http"

const EX = "https://loads.ati.su/webapi/v1.0"

export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error
  const __org = requireStaffOrganization(__auth.user)
  if (!__org.ok) return __org.response

  const ati = await getActiveAtiToken(__org.organizationId)
  if (!ati.ok) return NextResponse.json({ error: "no token" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const probe: string = body.probe ?? "all"
  const out: Record<string, unknown> = {}

  const headers = {
    Authorization: `Bearer ${ati.token}`,
    Cookie: `sid=${ati.token};`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
    Referer: "https://loads.ati.su/",
    Origin: "https://loads.ati.su",
    "Content-Type": "application/json",
  }

  // 1. Фильтр по НАЗВАНИЮ города вместо id
  if (probe === "all" || probe === "byname") {
    for (const city of ["Вологда", "Кострома", "Ярославль"]) {
      try {
        const res = await atiFetch(
          `${EX}/loads/search`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              exclude_geo_dicts: true,
              page: 1,
              items_per_page: 5,
              filter: {
                sorting_type: 2,
                from: { name: city, type: 1, radius: 100, exact_only: false },
              },
            }),
          },
          "probe3",
        )
        const text = await res.text()
        let total = null
        try {
          total = JSON.parse(text).totalItems
        } catch {}
        out[`byname:${city}`] = { status: res.status, totalItems: total, body: text.slice(0, 200) }
      } catch (e: any) {
        out[`byname:${city}`] = { error: e?.message }
      }
    }
  }

  // 2. Кандидаты в справочник городов
  if (probe === "all" || probe === "dict") {
    const paths = [
      "/dictionaries/cities?query=вол",
      "/dict/cities?query=вол",
      "/geo/cities?query=вол",
      "/cities?query=вол",
      "/loads/cities?query=вол",
      "/dictionaries/geo?query=вол",
      "/geo/dicts/cities?query=вол",
      "/geo/search?query=вол",
      "/suggest/cities?query=вол",
      "/cities/suggest?query=вол",
    ]
    for (const path of paths) {
      try {
        const res = await atiFetch(`${EX}${path}`, { method: "GET", headers }, "probe3")
        const text = await res.text()
        out[`dict:${path}`] = { status: res.status, body: text.slice(0, 250) }
      } catch (e: any) {
        out[`dict:${path}`] = { error: e?.message }
      }
    }
  }

  return NextResponse.json(out)
}
