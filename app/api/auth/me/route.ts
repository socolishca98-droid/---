// app/api/auth/me/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getStaffSession } from "@/lib/auth-server"

export async function GET(req: NextRequest) {
  try {
    const user = await getStaffSession(req)
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Не авторизован" },
        { status: 401 }
      )
    }

    return NextResponse.json({
      success: true,
      user,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
