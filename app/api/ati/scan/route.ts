// app/api/ati/scan/route.ts
import { requireStaffAuth } from "@/lib/api-auth"
import { NextRequest, NextResponse } from "next/server"
import { scanAtiLoads } from "@/lib/ati-client"

export async function POST(request: NextRequest) {
  const __auth = await requireStaffAuth(request);
  if (__auth.error) return __auth.error;


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