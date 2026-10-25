// ВРЕМЕННЫЙ диагностический роут: проверка внутреннего API сайта loads.ati.su
// (тот, что использует сам сайт для поиска по ВСЕЙ бирже). Удаляется после
// принятия решения по источнику грузов.
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
  const filter = body?.filter ?? {
    dates: { date_option: "week" },
    sorting_type: 2,
    from: { id: 88, type: 1, radius: 300, exact_only: false },
  }
  const page = Number(body?.page) || 1

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
    body: JSON.stringify({ exclude_geo_dicts: true, page, items_per_page: 50, filter }),
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

  return NextResponse.json({
    status: res.status,
    ok: res.ok,
    totalCount: parsed?.total_count ?? parsed?.totalCount ?? parsed?.count ?? null,
    loadsReturned: Array.isArray(parsed?.loads) ? parsed.loads.length : null,
    keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 20) : null,
    sample: Array.isArray(parsed?.loads)
      ? parsed.loads.slice(0, 3).map((l: any) => ({
          id: l?.id,
          from: l?.loading?.location?.city || l?.loading?.location?.cityName,
          to: l?.unloading?.location?.city || l?.unloading?.location?.cityName,
          weight: l?.load?.weight,
          price: l?.rate?.priceNds || l?.rate?.price,
        }))
      : null,
    rawHead: text.slice(0, 400),
  })
}
