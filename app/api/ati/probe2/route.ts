// ВРЕМЕННЫЙ диагностический роут: разбор внутреннего API сайта loads.ati.su.
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { getActiveAtiToken } from "@/lib/ati/connection"

export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request)
  if (__auth.error) return __auth.error
  const __org = requireStaffOrganization(__auth.user)
  if (!__org.ok) return __org.response

  const ati = await getActiveAtiToken(__org.organizationId)
  if (!ati.ok) return NextResponse.json({ error: "нет токена" }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const filter = body?.filter ?? { sorting_type: 2 }
  const page = Number(body?.page) || 1
  const perPage = Number(body?.items_per_page) || 50

  const res = await fetch("https://loads.ati.su/webapi/v1.0/loads/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ati.token}`,
      Cookie: `sid=${ati.token};`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0",
      Referer: "https://loads.ati.su/",
      Origin: "https://loads.ati.su",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ exclude_geo_dicts: true, page, items_per_page: perPage, filter }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  })

  const text = await res.text()
  let parsed: any = null
  try {
    parsed = JSON.parse(text)
  } catch {
    /* не json */
  }

  const loads: any[] = Array.isArray(parsed?.loads) ? parsed.loads : []
  return NextResponse.json({
    status: res.status,
    topLevelKeys: parsed && typeof parsed === "object" ? Object.keys(parsed) : null,
    counters: parsed
      ? {
          totalItems: parsed.totalItems,
          hiddenItems: parsed.hiddenItems,
          rootCount: parsed.rootCount,
          page: parsed.page,
          itemsPerPage: parsed.items_per_page,
        }
      : null,
    loadsReturned: loads.length,
    firstLoadRaw: loads[0] ? JSON.parse(JSON.stringify(loads[0])) : null,
    citySummary: loads.slice(0, 12).map((l: any) => ({
      id: String(l?.id ?? "").slice(0, 10),
      from: l?.loading?.location?.city ?? l?.loading?.location?.cityName ?? l?.loading?.cityName,
      to: l?.unloading?.location?.city ?? l?.unloading?.location?.cityName ?? l?.unloading?.cityName,
      weight: l?.load?.weight,
      price: l?.rate?.priceNds ?? l?.rate?.price,
      dist: l?.route?.distance,
    })),
  })
}
