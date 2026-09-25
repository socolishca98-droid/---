// app/api/ati/debug-dump/route.ts
import { requireStaffAuth } from "@/lib/api-auth"
import {requireStaffOrganization} from "@/lib/org"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { safeJsonParse } from "@/lib/safe-json"

export async function GET(req: NextRequest) {
  const __auth = await requireStaffAuth(req);
  if (__auth.error) return __auth.error;
  const __org = requireStaffOrganization(__auth.user);
  if (!__org.ok) return __org.response;


  const url = new URL(req.url)
  const mode = url.searchParams.get("mode")

  if (mode === "raw") {
    const last = await prisma.atiCache.findFirst({
      orderBy: { scannedAt: "desc" },
    })

    if (!last?.rawJson) {
      return NextResponse.json({ error: "no rawJson" }, { status: 404 })
    }

    // ✅ ИСПРАВЛЕНО: безопасный парсинг
    const parsed = safeJsonParse(last.rawJson, { error: "Invalid JSON" })
    return NextResponse.json(parsed)
  }

  const items = await prisma.atiCache.findMany({
    take: 50,
    orderBy: { scannedAt: "desc" },
    select: {
      atiLoadId: true,
      routeFrom: true,
      routeFromId: true,
      routeTo: true,
      routeToId: true,
      distance: true,
    },
  })

  return NextResponse.json(items)
}