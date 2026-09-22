// app/api/m/logout/route.ts - P1-5 clear refresh + revoke
import { NextRequest, NextResponse } from "next/server"
import { requireDriverAuth } from "@/lib/api-auth"
import { clearAllAuthCookies, DRIVER_REFRESH_COOKIE_NAME, verifyRefreshJwt } from "@/lib/auth-server"
import { revokeRefreshToken } from "@/lib/refresh-tokens"

export async function POST(request: NextRequest) {
  const __auth = await requireDriverAuth(request)
  if (__auth.error) return __auth.error

  const refreshToken = request.cookies.get(DRIVER_REFRESH_COOKIE_NAME)?.value
  if (refreshToken) {
    const payload = verifyRefreshJwt(refreshToken)
    if (payload) {
      revokeRefreshToken(payload.jti)
    }
  }

  const res = NextResponse.json({ success: true, message: "Выход выполнен" })
  clearAllAuthCookies(res)
  return res
}
