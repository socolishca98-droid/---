// app/api/ati/scan/route.ts
import { NextRequest, NextResponse } from "next/server"
import { scanAtiLoads } from "@/lib/ati-client"

import { requireStaff } from "@/lib/auth/session"

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  try {
    const body = await request.json().catch(() => ({}))
    const result = await scanAtiLoads(body)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error("[ATI Scan] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Scan failed" },
      { status: 500 }
    )
  }
}