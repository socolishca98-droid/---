// app/api/auth/logout/route.ts - P1-5 clear refresh + revoke
import { NextRequest, NextResponse } from "next/server"
import { clearAllAuthCookies, STAFF_REFRESH_COOKIE_NAME, verifyRefreshJwt } from "@/lib/auth-server"
import { revokeRefreshToken, revokeAllForUser } from "@/lib/refresh-tokens"

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(STAFF_REFRESH_COOKIE_NAME)?.value
  if (refreshToken) {
    const payload = verifyRefreshJwt(refreshToken)
    if (payload) {
      // Revoke specific token and optionally all for user for security
      revokeRefreshToken(payload.jti)
      // For stricter logout, revoke all: revokeAllForUser(payload.sub)
    }
  }

  const res = NextResponse.json({ success: true, message: "Выход выполнен" })
  clearAllAuthCookies(res)
  return res
}
