// app/api/ati/debug-dump/route.ts
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { safeJsonParse } from "@/lib/safe-json"

import { requireStaff } from "@/lib/auth/session"

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  const url = new URL(request.url)
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