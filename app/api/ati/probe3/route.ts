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

  // 3. СЫРОЙ груз общей биржи — все поля, включая возможные id городов
  if (probe === "all" || probe === "raw") {
    try {
      const res = await atiFetch(
        `${EX}/loads/search`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            exclude_geo_dicts: true,
            page: 1,
            items_per_page: 1,
            filter: { sorting_type: 2, from: { id: 88, type: 1, radius: 300, exact_only: false } },
          }),
        },
        "probe3",
      )
      const data = await res.json()
      out["raw:load"] = data?.loads?.[0] ?? null
      out["raw:topLevelKeys"] = data ? Object.keys(data) : []
    } catch (e: any) {
      out["raw:error"] = e?.message
    }
  }

  // 4. Словарь городов на ОФИЦИАЛЬном api.ati.su
  if (probe === "all" || probe === "officialdict") {
    for (const path of [
      "/webapi/v1.0/dictionaries/cities",
      "/webapi/v1.0/dictionaries/cities?query=вол",
    ]) {
      try {
        const res = await atiFetch(`https://api.ati.su${path}`, { method: "GET", headers }, "probe3")
        const text = await res.text()
        out[`official:${path}`] = { status: res.status, body: text.slice(0, 300) }
      } catch (e: any) {
        out[`official:${path}`] = { error: e?.message }
      }
    }
  }

  // 5. Другие формы фильтра «откуда»: вдруг принимается geoCode или город
  if (probe === "all" || probe === "shapes") {
    const shapes: Array<[string, any]> = [
      ["geoCode", { geoCode: "2_290", type: 1, radius: 300, exact_only: false }],
      ["geoCodeNoType", { geoCode: "2_290", radius: 300 }],
      ["idString", { id: "2_290", type: 1, radius: 300, exact_only: false }],
      ["cityId", { cityId: 290, type: 1, radius: 300, exact_only: false }],
      ["type2", { id: 290, type: 2, radius: 300, exact_only: false }],
      ["settlementId", { settlementId: 290, type: 1, radius: 300 }],
    ]
    for (const [label, from] of shapes) {
      try {
        const res = await atiFetch(
          `${EX}/loads/search`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              exclude_geo_dicts: true,
              page: 1,
              items_per_page: 1,
              filter: { sorting_type: 2, from },
            }),
          },
          "probe3",
        )
        const text = await res.text()
        let total = null
        let city = null
        try {
          const parsed = JSON.parse(text)
          total = parsed.totalItems
          city = parsed?.loads?.[0]?.loading?.location?.city
        } catch {}
        out[`shape:${label}`] = { status: res.status, totalItems: total, city, body: text.slice(0, 160) }
      } catch (e: any) {
        out[`shape:${label}`] = { error: e?.message }
      }
    }
  }

  // 6. Подсказки городов по другим путям и базам
  if (probe === "all" || probe === "suggest") {
    const tries: Array<[string, string]> = [
      ["loads:geosuggest", "https://loads.ati.su/webapi/v1.0/geosuggest?query=вол"],
      ["loads:geo/suggest", "https://loads.ati.su/webapi/v1.0/geo/suggest?query=вол"],
      ["loads:settlements", "https://loads.ati.su/webapi/v1.0/settlements?query=вол"],
      ["loads:loads/geo", "https://loads.ati.su/webapi/v1.0/loads/geo?query=вол"],
      ["loads:v2:cities", "https://loads.ati.su/webapi/v2.0/cities?query=вол"],
      ["loads:api:cities", "https://loads.ati.su/api/cities?query=вол"],
      ["api:geo", "https://api.ati.su/webapi/v1.0/geo/cities?query=вол"],
    ]
    for (const [label, url] of tries) {
      try {
        const res = await atiFetch(url, { method: "GET", headers }, "probe3")
        const text = await res.text()
        out[`sug:${label}`] = { status: res.status, body: text.slice(0, 200) }
      } catch (e: any) {
        out[`sug:${label}`] = { error: e?.message }
      }
    }
  }

  return NextResponse.json(out)
}
