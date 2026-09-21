// app/api/ati/import/route.ts
import { NextRequest, NextResponse } from "next/server"
import { importAtiLoadToOrder } from "@/lib/ati-client"

import { requireStaff } from "@/lib/auth/session"

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request)
  if (!auth.ok) return auth.response
  try {
    const body = await request.json().catch(() => ({}))
    const { cacheId, fetchContacts } = body as {
      cacheId?: string
      fetchContacts?: boolean
    }

    if (!cacheId) {
      return NextResponse.json(
        { success: false, error: "cacheId required" },
        { status: 400 }
      )
    }

    const result = await importAtiLoadToOrder(cacheId, {
      fetchContacts: !!fetchContacts,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error("[ATI Import] Error:", error)
    return NextResponse.json(
      { success: false, error: error.message || "Import failed" },
      { status: 500 }
    )
  }
}