// app/api/ati/import/route.ts
import { NextRequest, NextResponse } from "next/server"
import { importAtiLoadToOrder } from "@/lib/ati-client"

export async function POST(request: NextRequest) {
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