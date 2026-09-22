// app/api/m/logout/route.ts
import { NextRequest, NextResponse } from "next/server"
import { requireDriverAuth } from "@/lib/api-auth"
import { clearAuthCookies } from "@/lib/auth-server"

export async function POST(request: NextRequest) {
  const __auth = await requireDriverAuth(request);
  if (__auth.error) return __auth.error;

  const res = NextResponse.json({ success: true, message: "Выход выполнен" })
  clearAuthCookies(res)
  return res
}
