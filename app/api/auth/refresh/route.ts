// app/api/auth/refresh/route.ts - P1-5 refresh rotation for staff
import { NextRequest, NextResponse } from "next/server"
import {
  verifyRefreshJwt,
  signAccessJwt,
  signRefreshJwt,
  setStaffAuthCookie,
  setStaffRefreshCookie,
  STAFF_REFRESH_EXPIRES_IN,
  STAFF_REFRESH_COOKIE_NAME,
} from "@/lib/auth-server"
import { getRefreshEntry, rotateRefreshToken, generateJti } from "@/lib/refresh-tokens"
import { getClientIp } from "@/lib/rate-limiter"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  try {
    const refreshToken =
      req.cookies.get(STAFF_REFRESH_COOKIE_NAME)?.value ||
      (await req.json().catch(() => ({})))?.refreshToken ||
      req.headers.get("x-refresh-token")

    if (!refreshToken) {
      return NextResponse.json({ success: false, error: "Refresh token missing" }, { status: 401 })
    }

    const payload = verifyRefreshJwt(refreshToken)
    if (!payload || (payload.role !== "admin" && payload.role !== "logist")) {
      return NextResponse.json({ success: false, error: "Invalid refresh token" }, { status: 401 })
    }

    const entry = getRefreshEntry(payload.jti)
    if (!entry || entry.userId !== payload.sub) {
      return NextResponse.json({ success: false, error: "Refresh token revoked or expired" }, { status: 401 })
    }

    // Check user still active
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, role: true, status: true },
    })
    if (!user || user.status !== "active") {
      return NextResponse.json({ success: false, error: "User not active" }, { status: 401 })
    }

    // Rotate: old jti invalidated, new jti created
    const newJti = generateJti()
    const ip = getClientIp(req)
    const newEntry = rotateRefreshToken(payload.jti, newJti, STAFF_REFRESH_EXPIRES_IN * 1000)
    if (!newEntry) {
      return NextResponse.json({ success: false, error: "Rotation failed" }, { status: 401 })
    }
    // Ensure ip updated
    newEntry.ip = ip

    const newAccessToken = signAccessJwt({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name || user.email,
    })

    const newRefreshToken = signRefreshJwt(
      { sub: user.id, role: user.role as "admin" | "logist", jti: newJti },
      STAFF_REFRESH_EXPIRES_IN
    )

    // Need to update store with new jti mapping to new refresh token's jti is already stored,
    // but we created entry with newJti already in rotate, so we need to ensure entry exists
    // rotate already created entry, but we also need to ensure the refresh token's jti matches
    // The rotate function creates entry, so it's ok. However we generated new refresh token with same jti,
    // so entry is valid.

    const response = NextResponse.json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role,
        status: user.status,
      },
    })

    setStaffAuthCookie(response, newAccessToken)
    setStaffRefreshCookie(response, newRefreshToken)

    return response
  } catch (e: any) {
    console.error("[Auth Refresh] Error:", e)
    return NextResponse.json({ success: false, error: e.message || "Refresh failed" }, { status: 500 })
  }
}
