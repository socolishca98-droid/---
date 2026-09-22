// app/api/m/refresh/route.ts - P1-5 refresh rotation for driver
import { NextRequest, NextResponse } from "next/server"
import {
  verifyRefreshJwt,
  signAccessJwt,
  signRefreshJwt,
  setDriverAuthCookie,
  setDriverRefreshCookie,
  DRIVER_REFRESH_EXPIRES_IN,
  DRIVER_REFRESH_COOKIE_NAME,
} from "@/lib/auth-server"
import { getRefreshEntry, rotateRefreshToken, generateJti } from "@/lib/refresh-tokens"
import { getClientIp } from "@/lib/rate-limiter"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  try {
    const refreshToken =
      req.cookies.get(DRIVER_REFRESH_COOKIE_NAME)?.value ||
      (await req.json().catch(() => ({})))?.refreshToken ||
      req.headers.get("x-refresh-token")

    if (!refreshToken) {
      return NextResponse.json({ success: false, error: "Refresh token missing" }, { status: 401 })
    }

    const payload = verifyRefreshJwt(refreshToken)
    if (!payload || payload.role !== "driver") {
      return NextResponse.json({ success: false, error: "Invalid refresh token" }, { status: 401 })
    }

    const entry = getRefreshEntry(payload.jti)
    if (!entry || entry.userId !== payload.sub) {
      return NextResponse.json({ success: false, error: "Refresh token revoked or expired" }, { status: 401 })
    }

    const driver = await prisma.driver.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, phone: true, vehicleType: true, vehiclePlate: true, status: true },
    })
    if (!driver) {
      return NextResponse.json({ success: false, error: "Driver not found" }, { status: 401 })
    }

    const newJti = generateJti()
    const ip = getClientIp(req)
    const newEntry = rotateRefreshToken(payload.jti, newJti, DRIVER_REFRESH_EXPIRES_IN * 1000)
    if (!newEntry) {
      return NextResponse.json({ success: false, error: "Rotation failed" }, { status: 401 })
    }
    newEntry.ip = ip

    const newAccessToken = signAccessJwt({
      sub: driver.id,
      phone: driver.phone,
      role: "driver",
    })

    const newRefreshToken = signRefreshJwt(
      { sub: driver.id, role: "driver", jti: newJti },
      DRIVER_REFRESH_EXPIRES_IN
    )

    const response = NextResponse.json({
      success: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
      driver: {
        id: driver.id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        vehiclePlate: driver.vehiclePlate,
        status: driver.status,
      },
    })

    setDriverAuthCookie(response, newAccessToken)
    setDriverRefreshCookie(response, newRefreshToken)

    return response
  } catch (e: any) {
    console.error("[Driver Refresh] Error:", e)
    return NextResponse.json({ success: false, error: e.message || "Refresh failed" }, { status: 500 })
  }
}
