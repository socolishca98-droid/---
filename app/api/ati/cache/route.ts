// app/api/ati/cache/route.ts
import { requireStaffAuth } from "@/lib/api-auth"
import { requireStaffOrganization, scopedWhere } from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { getAtiCache, getAtiStats } from "@/lib/ati-client"

export async function GET(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  try {
    const { searchParams } = new URL(request.url)

    // Если запрос статистики
    if (searchParams.get("stats") === "true") {
      const stats = await getAtiStats()
      return NextResponse.json(stats)
    }

    // Иначе — список грузов
    const params = {
      status: searchParams.get("status") || "new",
      search: searchParams.get("search") || undefined,
      limit: Number(searchParams.get("limit")) || 50,
      offset: Number(searchParams.get("offset")) || 0,
      minPrice: searchParams.get("minPrice") || undefined,
      maxPrice: searchParams.get("maxPrice") || undefined,
      minDistance: searchParams.get("minDistance") || undefined,
      maxDistance: searchParams.get("maxDistance") || undefined,
      minPricePerKm: searchParams.get("minPricePerKm") || undefined,
      sortBy: searchParams.get("sortBy") || "scannedAt",
      sortOrder: searchParams.get("sortOrder") || "desc",
    }

    const result = await getAtiCache(params)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error("[ATI Cache] Error:", error)
    return NextResponse.json(
      { error: error.message || "Failed to fetch cache" },
      { status: 500 }
    )
  }
}